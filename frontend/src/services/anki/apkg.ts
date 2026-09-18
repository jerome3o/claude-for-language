/**
 * Build an Anki `.apkg` package in the browser.
 *
 * An .apkg is a zip holding `collection.anki2` (a SQLite database in the
 * legacy schema every Anki version imports), a `media` JSON index mapping
 * zip entry names ("0", "1", …) to real filenames, and the media files
 * themselves under those numeric names. This module writes exactly that
 * with sql.js (SQLite compiled to WASM) and JSZip. It is pure: the caller
 * hands it notes with their fields already filled and media bytes already
 * fetched, so it can be unit-tested without a browser.
 */

import JSZip from 'jszip';
import type { SqlJsStatic, Database } from 'sql.js';
import { MODELS, type AnkiModel, type AnkiModelKey } from './models';
import { fieldChecksum, stableId, stripHtmlMedia } from './hash';

/** Approximate scheduling state for one card (see `sources.ts`). */
export interface AnkiCardProgress {
  state: 'new' | 'learning' | 'review';
  /** Current interval in days (review cards). */
  intervalDays: number;
  /** Ease factor as a multiplier, e.g. 2.5. */
  ease: number;
  reps: number;
  lapses: number;
  /** Days until due, relative to today (negative = overdue). */
  dueInDays: number;
}

export interface AnkiNote {
  model: AnkiModelKey;
  /** Stable GUID — the same source must always produce the same value. */
  guid: string;
  /** Field values by field name; missing fields are exported empty. */
  fields: Record<string, string>;
  tags?: string[];
  /** Optional scheduling state by template ordinal. */
  progress?: Record<number, AnkiCardProgress>;
}

export interface AnkiMediaFile {
  filename: string;
  data: Uint8Array;
}

export interface ApkgInput {
  deckName: string;
  deckDescription?: string;
  notes: AnkiNote[];
  media: AnkiMediaFile[];
}

export interface ApkgBuildOptions {
  sql: SqlJsStatic;
  /** Clock override for deterministic tests (ms since epoch). */
  now?: number;
}

export interface ApkgBuildResult {
  bytes: Uint8Array;
  noteCount: number;
  cardCount: number;
  mediaCount: number;
  deckId: number;
}

// Anki's legacy schema (collection version 11) — what genanki writes and
// every Anki client since 2.0 can import.
const SCHEMA = `
CREATE TABLE col (
  id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null,
  conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
);
CREATE TABLE notes (
  id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null,
  csum integer not null, flags integer not null, data text not null
);
CREATE TABLE cards (
  id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null,
  due integer not null, ivl integer not null, factor integer not null, reps integer not null,
  lapses integer not null, left integer not null, odue integer not null, odid integer not null,
  flags integer not null, data text not null
);
CREATE TABLE revlog (
  id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null,
  type integer not null
);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

/** Collection creation time. Fixed (like genanki) so review due-days are
 * relative to a known epoch; Anki rebases them onto the target collection. */
const COLLECTION_CRT = 1411124400; // 2014-09-19, seconds

const DECK_ID_NAMESPACE = 'chinese-learning-app:deck';

const LATEX_PRE = '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';
const LATEX_POST = '\\end{document}';

function modelJson(model: AnkiModel, deckId: number, modSecs: number) {
  return {
    id: model.id,
    name: model.name,
    type: 0,
    mod: modSecs,
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls: model.templates.map((t, ord) => ({
      name: t.name,
      ord,
      qfmt: t.qfmt,
      afmt: t.afmt,
      bqfmt: '',
      bafmt: '',
      did: null,
      bfont: '',
      bsize: 0,
    })),
    flds: model.fields.map((name, ord) => ({
      name,
      ord,
      sticky: false,
      rtl: false,
      font: 'Arial',
      size: 20,
      media: [],
    })),
    css: model.css,
    latexPre: LATEX_PRE,
    latexPost: LATEX_POST,
    latexsvg: false,
    // Which fields each template needs: [ord, "all", [field ords]].
    req: model.templates.map((t, ord) => [ord, 'all', t.requires.map(f => model.fields.indexOf(f))]),
    tags: [],
    vers: [],
  };
}

function deckJson(id: number, name: string, desc: string, modSecs: number) {
  return {
    id,
    name,
    desc,
    mod: modSecs,
    usn: -1,
    collapsed: false,
    browserCollapsed: false,
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
    dyn: 0,
    extendNew: 0,
    extendRev: 0,
    conf: 1,
  };
}

const DEFAULT_DCONF = {
  1: {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    dyn: false,
  },
};

/** Whether a template's required fields are all filled — the same rule as
 * Anki's `req` table, so we never write a card Anki would show blank. */
export function templateApplies(model: AnkiModel, ord: number, fields: Record<string, string>): boolean {
  const t = model.templates[ord];
  return t.requires.every(name => stripHtmlMedia(fields[name] ?? '').length > 0 || /\[sound:/.test(fields[name] ?? ''));
}

/** Deterministic Anki deck id for a deck name. */
export function ankiDeckId(deckName: string): number {
  return stableId(DECK_ID_NAMESPACE, deckName);
}

interface CardRow {
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
}

function cardRow(progress: AnkiCardProgress | undefined, newPosition: number, todayDays: number): CardRow {
  if (!progress || progress.state === 'new') {
    return { type: 0, queue: 0, due: newPosition, ivl: 0, factor: 0, reps: progress?.reps ?? 0, lapses: progress?.lapses ?? 0 };
  }
  // Learning cards are approximated as reviews due today with a 1-day interval:
  // the app's sub-day learning steps have no faithful equivalent in a foreign
  // collection, and this keeps them in Anki's review queue rather than lost.
  const ivl = Math.max(1, Math.round(progress.intervalDays));
  const due = todayDays + Math.round(progress.state === 'learning' ? 0 : progress.dueInDays);
  return {
    type: 2,
    queue: 2,
    due,
    ivl,
    factor: Math.max(1300, Math.round(progress.ease * 1000)),
    reps: progress.reps,
    lapses: progress.lapses,
  };
}

/** Write the collection.anki2 SQLite database and return its bytes. */
export function buildCollection(input: ApkgInput, options: ApkgBuildOptions): { bytes: Uint8Array; noteCount: number; cardCount: number; deckId: number } {
  const now = options.now ?? Date.now();
  const nowSecs = Math.floor(now / 1000);
  const todayDays = Math.floor((nowSecs - COLLECTION_CRT) / 86400);
  const deckId = ankiDeckId(input.deckName);

  const usedModels = new Map<AnkiModelKey, AnkiModel>();
  for (const note of input.notes) usedModels.set(note.model, MODELS[note.model]);
  if (usedModels.size === 0) usedModels.set('vocabulary', MODELS.vocabulary);

  const models: Record<string, unknown> = {};
  for (const m of usedModels.values()) models[String(m.id)] = modelJson(m, deckId, nowSecs);

  const decks = {
    1: deckJson(1, 'Default', '', nowSecs),
    [deckId]: deckJson(deckId, input.deckName, input.deckDescription ?? '', nowSecs),
  };

  const conf = {
    activeDecks: [deckId],
    curDeck: deckId,
    curModel: String(usedModels.values().next().value?.id ?? MODELS.vocabulary.id),
    nextPos: input.notes.length + 1,
    addToCur: true,
    collapseTime: 1200,
    dueCounts: true,
    estTimes: true,
    newBury: true,
    newSpread: 0,
    sortBackwards: false,
    sortType: 'noteFld',
    timeLim: 0,
  };

  const db: Database = new options.sql.Database();
  try {
    db.run(SCHEMA);
    db.run('INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      1, COLLECTION_CRT, now, now, 11, 0, 0, 0,
      JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(DEFAULT_DCONF), '{}',
    ]);

    const insertNote = db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const insertCard = db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let noteCount = 0;
    let cardCount = 0;
    const seenGuids = new Set<string>();
    try {
      input.notes.forEach((note, i) => {
        if (seenGuids.has(note.guid)) return; // adapters dedupe, but never write a duplicate GUID
        seenGuids.add(note.guid);
        const model = MODELS[note.model];
        const values = model.fields.map(f => note.fields[f] ?? '');
        const noteId = now + i;
        const tags = note.tags?.length ? ` ${note.tags.map(t => t.replace(/\s+/g, '_')).join(' ')} ` : '';
        insertNote.run([
          noteId, note.guid, model.id, nowSecs, -1, tags,
          values.join('\u001f'), stripHtmlMedia(values[0]), fieldChecksum(values[0]), 0, '',
        ]);
        noteCount++;
        model.templates.forEach((_t, ord) => {
          if (!templateApplies(model, ord, note.fields)) return;
          const row = cardRow(note.progress?.[ord], i + 1, todayDays);
          insertCard.run([
            now + 1_000_000 + cardCount, noteId, deckId, ord, nowSecs, -1,
            row.type, row.queue, row.due, row.ivl, row.factor, row.reps, row.lapses, 0, 0, 0, 0, '',
          ]);
          cardCount++;
        });
      });
    } finally {
      insertNote.free();
      insertCard.free();
    }
    return { bytes: db.export(), noteCount, cardCount, deckId };
  } finally {
    db.close();
  }
}

/** Build the complete .apkg (zip) bytes. */
export async function buildApkg(input: ApkgInput, options: ApkgBuildOptions): Promise<ApkgBuildResult> {
  const collection = buildCollection(input, options);
  const zip = new JSZip();
  zip.file('collection.anki2', collection.bytes);
  const mediaIndex: Record<string, string> = {};
  const seen = new Set<string>();
  let n = 0;
  for (const file of input.media) {
    if (seen.has(file.filename)) continue;
    seen.add(file.filename);
    mediaIndex[String(n)] = file.filename;
    zip.file(String(n), file.data);
    n++;
  }
  zip.file('media', JSON.stringify(mediaIndex));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, noteCount: collection.noteCount, cardCount: collection.cardCount, mediaCount: n, deckId: collection.deckId };
}

/** Read an .apkg back (tests, the inspector). */
export async function readApkg(bytes: Uint8Array, sql: SqlJsStatic): Promise<{
  db: Database;
  media: Record<string, string>;
  files: Record<string, Uint8Array>;
}> {
  const zip = await JSZip.loadAsync(bytes);
  const collectionFile = zip.file('collection.anki2');
  if (!collectionFile) throw new Error('Not an .apkg: collection.anki2 missing');
  const db = new sql.Database(await collectionFile.async('uint8array'));
  const mediaFile = zip.file('media');
  const media: Record<string, string> = mediaFile ? JSON.parse(await mediaFile.async('string')) : {};
  const files: Record<string, Uint8Array> = {};
  for (const [entry, name] of Object.entries(media)) {
    const f = zip.file(entry);
    if (f) files[name] = await f.async('uint8array');
  }
  return { db, media, files };
}
