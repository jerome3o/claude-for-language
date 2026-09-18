/**
 * Anki `.apkg` export — public entry points.
 *
 * Loaded lazily (`import('../services/anki')`) from the export UI so sql.js,
 * JSZip and the SQLite WASM never touch the study path.
 *
 *   exportDeckToAnki(deckId)      → the deck's notes as Vocabulary notes (3 cards each)
 *   exportLessonToAnki(spec)      → a lesson's words and sentences
 *   exportReaderToAnki(reader)    → a reader's pages as Sentence notes + its vocabulary
 *
 * Each returns { blob, filename, stats }; `saveAnkiExport` downloads it.
 */

import { pinyin } from 'pinyin-pro';
import { db, getNotesByDeckId } from '../../db/database';
import { getDeck, getGradedReader } from '../../api/client';
import { downloadBlob } from '../../components/editor/download';
import type { CustomLessonSpec } from '@shared/lesson';
import type { GradedReaderWithPages } from '../../types';
import { buildApkg, type AnkiNote } from './apkg';
import { resolveAudio, audioRefKey } from './media';
import { deckToAnki, lessonToAnki, readerToAnki, type AnkiSource, type AudioRef, type AudioField, type ReaderSource } from './sources';
import { loadSqlJs } from './sqljs-loader';

export type { AnkiNote, AnkiCardProgress, ApkgInput } from './apkg';
export type { AnkiSource, AudioRef, SourceNote } from './sources';
export { deckToAnki, lessonToAnki, readerToAnki } from './sources';
export { buildApkg, readApkg } from './apkg';

export interface AnkiExportProgress {
  stage: 'loading' | 'audio' | 'building';
  done: number;
  total: number;
}

export interface AnkiExportOptions {
  /** Bundle audio clips as media (default true). */
  includeAudio?: boolean;
  /** Decks only: write review state into Anki's scheduling columns (default false). */
  includeProgress?: boolean;
  onProgress?: (progress: AnkiExportProgress) => void;
}

export interface AnkiExportStats {
  notes: number;
  cards: number;
  audioIncluded: number;
  audioMissing: number;
  bytes: number;
}

export interface AnkiExportResult {
  blob: Blob;
  filename: string;
  stats: AnkiExportStats;
}

const AUDIO_FIELDS: AudioField[] = ['Audio', 'SentenceAudio'];

/**
 * `Readers::小猫的一天` → `Readers-xiao-mao-de-yi-tian.apkg`.
 * ASCII only: Chinese is transliterated to toneless pinyin because some
 * browsers drop a non-ASCII `download` name and save a file called
 * "download" with no extension, which Anki then can't open.
 */
export function apkgFilename(title: string): string {
  const transliterated = title
    .replace(/::/g, ' ')
    .replace(/[㐀-鿿]+/g, run => ` ${pinyin(run, { toneType: 'none', type: 'array' }).join('-')} `);
  const base = transliterated
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'anki-export';
  return `${base}.apkg`;
}

/** Resolve audio, fill the sound fields and build the package. */
export async function packageSource(source: AnkiSource, options: AnkiExportOptions = {}): Promise<AnkiExportResult> {
  const includeAudio = options.includeAudio ?? true;
  const report = options.onProgress ?? (() => {});

  // Kick off the WASM load while audio resolves.
  const sqlPromise = loadSqlJs();

  let audioIncluded = 0;
  let audioMissing = 0;
  const notes: AnkiNote[] = [];
  const media = new Map<string, { filename: string; data: Uint8Array }>();

  if (includeAudio) {
    const refs: AudioRef[] = [];
    for (const note of source.notes) {
      for (const field of AUDIO_FIELDS) {
        const ref = note.audio?.[field];
        if (ref) refs.push(ref);
      }
    }
    report({ stage: 'audio', done: 0, total: refs.length });
    const resolved = await resolveAudio(refs, {
      onProgress: (done, total) => report({ stage: 'audio', done, total }),
    });
    audioMissing = resolved.missing;
    for (const note of source.notes) {
      const fields = { ...note.fields };
      for (const field of AUDIO_FIELDS) {
        const ref = note.audio?.[field];
        if (!ref) continue;
        const file = resolved.files.get(audioRefKey(ref));
        if (file) {
          fields[field] = `[sound:${file.filename}]`;
          media.set(file.filename, file);
          audioIncluded++;
        }
      }
      notes.push({ model: note.model, guid: note.guid, fields, tags: note.tags, progress: note.progress });
    }
  } else {
    for (const note of source.notes) {
      notes.push({ model: note.model, guid: note.guid, fields: { ...note.fields }, tags: note.tags, progress: note.progress });
    }
  }

  report({ stage: 'building', done: 0, total: 1 });
  const sql = await sqlPromise;
  const built = await buildApkg(
    { deckName: source.deckName, deckDescription: source.description, notes, media: Array.from(media.values()) },
    { sql },
  );
  report({ stage: 'building', done: 1, total: 1 });

  const blob = new Blob([built.bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
  return {
    blob,
    filename: apkgFilename(source.deckName),
    stats: {
      notes: built.noteCount,
      cards: built.cardCount,
      audioIncluded,
      audioMissing,
      bytes: blob.size,
    },
  };
}

// ============ Decks ============

async function loadDeckSource(deckId: string, includeProgress: boolean): Promise<AnkiSource> {
  // Local first: the study cache has the deck, its notes and the computed
  // card state, and works offline. Fall back to the API for decks that were
  // never synced to this device.
  const localDeck = await db.decks.get(deckId);
  if (localDeck) {
    const notes = await getNotesByDeckId(deckId);
    if (notes.length > 0) {
      const cards = includeProgress ? await db.cards.where('deck_id').equals(deckId).toArray() : [];
      return deckToAnki(localDeck, notes, cards, { progress: includeProgress });
    }
  }
  const deck = await getDeck(deckId);
  const cards = includeProgress ? deck.notes.flatMap(n => n.cards.map(c => ({ ...c, note_id: n.id }))) : [];
  return deckToAnki(deck, deck.notes, cards, { progress: includeProgress });
}

export async function exportDeckToAnki(deckId: string, options: AnkiExportOptions = {}): Promise<AnkiExportResult> {
  options.onProgress?.({ stage: 'loading', done: 0, total: 1 });
  const source = await loadDeckSource(deckId, options.includeProgress ?? false);
  return packageSource(source, options);
}

// ============ Lessons ============

export async function exportLessonToAnki(
  spec: CustomLessonSpec,
  options: AnkiExportOptions & { sourceId?: string } = {},
): Promise<AnkiExportResult> {
  return packageSource(lessonToAnki(spec, { sourceId: options.sourceId }), options);
}

// ============ Readers ============

async function loadReaderSource(readerId: string): Promise<ReaderSource> {
  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      return await getGradedReader(readerId);
    } catch {
      // fall through to the offline cache
    }
  }
  const local = await db.readers.get(readerId);
  if (!local) throw new Error('This reader is not available offline');
  return { ...local, vocabulary_used: [] };
}

export async function exportReaderToAnki(
  reader: GradedReaderWithPages | string,
  options: AnkiExportOptions = {},
): Promise<AnkiExportResult> {
  options.onProgress?.({ stage: 'loading', done: 0, total: 1 });
  const source = typeof reader === 'string' ? await loadReaderSource(reader) : reader;
  return packageSource(readerToAnki(source), options);
}

// ============ Saving ============

export function saveAnkiExport(result: AnkiExportResult): void {
  downloadBlob(result.filename, result.blob);
}
