/**
 * "How many characters and words do I (ostensibly) know?" — the Progress page's
 * Characters / Words tiles and their history chart, as pure functions over the notes, the
 * cards and the review events on the device (so it works offline). The Lab app's Kotlin
 * port (`core/…/Known.kt`) is parity-tested against this file.
 *
 * Definitions (the "?" on the Progress page says the same in words):
 * - A **card** is *known* when its state computed from its review events is mature: in
 *   Review with stability > 21 days — the deck page's "mastered" (`masteryLevel`), i.e.
 *   remembered for 3+ weeks. Any reviewed card that is not mature is *learning*.
 * - A **note** takes the best of its cards: known if any card is known, learning if any
 *   card has been reviewed.
 * - A note is a **word** when its hanzi has 1–4 Han characters and no sentence punctuation
 *   (`noteKind`); longer or punctuated notes are **sentences**; notes with no Han
 *   characters count for nothing. Words (and sentences) are counted once per spelling
 *   (`noteKey`), so the same word in two decks is one word, known if either copy is.
 * - A **character** is every distinct Han character in any note's hanzi (words and
 *   sentences): known if it appears in a known note, learning if it only appears in
 *   learning notes.
 * - "learning" counts never include what is already known.
 *
 * Card state is always replayed from the events (`computeCardTimeline`), never read from
 * the cached columns, so the history is exact: a card that lapses stops being known on
 * the day it lapsed.
 */
import { computeCardTimeline, type ReviewEvent, type Rating } from '../scheduler/compute-state';
import { masteryLevel } from './mastery';

export const MAX_WORD_CHARACTERS = 4;
export const RECENT_CHARACTERS = 12;
export const HISTORY_POINTS = 60;

const DAY_MS = 86_400_000;

/** Han ideographs: CJK Unified (+ extensions A–I) and the compatibility blocks. */
export function isHanCodePoint(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2ebef) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f) ||
    (cp >= 0x30000 && cp <= 0x323af);
}

function codePoints(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) out.push(ch.codePointAt(0)!);
  return out;
}

/** The distinct Han characters of a text, in order of first appearance. */
export function hanCharacters(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cp of codePoints(text)) {
    if (!isHanCodePoint(cp)) continue;
    const ch = String.fromCodePoint(cp);
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

/** Punctuation that makes a note a sentence (full-width and ASCII). */
const SENTENCE_PUNCTUATION = new Set(
  [...'。？！，、；：…,.?!;:'].map((c) => c.codePointAt(0)!),
);

export type NoteKind = 'word' | 'sentence' | 'none';

/** word = 1–4 Han characters and no sentence punctuation; sentence = longer or punctuated. */
export function noteKind(hanzi: string): NoteKind {
  let han = 0;
  let punctuated = false;
  for (const cp of codePoints(hanzi)) {
    if (isHanCodePoint(cp)) han++;
    else if (SENTENCE_PUNCTUATION.has(cp)) punctuated = true;
  }
  if (han === 0) return 'none';
  if (punctuated || han > MAX_WORD_CHARACTERS) return 'sentence';
  return 'word';
}

/** What makes two notes "the same word": their Han characters and ASCII letters / digits, in order. */
export function noteKey(hanzi: string): string {
  let out = '';
  for (const cp of codePoints(hanzi)) {
    const ascii = (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
    if (ascii || isHanCodePoint(cp)) out += String.fromCodePoint(cp);
  }
  return out;
}

export interface KnownNoteInput { id: string; hanzi: string }
export interface KnownCardInput { id: string; note_id: string }
export interface KnownEventInput { id?: string; card_id: string; rating: number; reviewed_at: string }

export interface KnownCounts { known: number; learning: number }

export interface KnownPoint {
  at_ms: number;
  characters: KnownCounts;
  words: KnownCounts;
}

export interface RecentCharacter {
  char: string;
  /** reviewed_at of the review that made it known. */
  known_at: string;
}

export interface KnownProgress {
  characters: KnownCounts;
  words: KnownCounts;
  sentences: KnownCounts;
  /** Characters currently known, most recently learned first. */
  recent_characters: RecentCharacter[];
  /** Counts as of each requested point (events at or before it), oldest first. */
  history: KnownPoint[];
}

/** 0 = never reviewed, 1 = learning, 2 = known. */
type Tier = 0 | 1 | 2;

/**
 * Where the history chart samples: `nowMs` and steps of whole days back from it, at most
 * `maxPoints`, the oldest at or before the first review (so the line starts at 0). Days
 * per step = ceil(span in days / (maxPoints − 1)), at least 1. No events → [].
 */
export function historyPoints(events: readonly KnownEventInput[], nowMs: number, maxPoints = HISTORY_POINTS): number[] {
  let first = Infinity;
  for (const e of events) {
    const ms = Date.parse(e.reviewed_at);
    if (!Number.isNaN(ms) && ms < first) first = ms;
  }
  if (first === Infinity) return [];
  if (first >= nowMs) return [nowMs];
  const spanDays = Math.ceil((nowMs - first) / DAY_MS);
  const stepDays = Math.max(1, Math.ceil(spanDays / Math.max(1, maxPoints - 1)));
  const stepMs = stepDays * DAY_MS;
  const steps = Math.ceil((nowMs - first) / stepMs);
  const out: number[] = [];
  for (let k = steps; k >= 0; k--) out.push(nowMs - k * stepMs);
  return out;
}

class Group {
  known = 0;
  seen = 0;
  tier(): Tier {
    return this.known > 0 ? 2 : this.seen > 0 ? 1 : 0;
  }
}

class Tally {
  known = 0;
  learning = 0;
  move(from: Tier, to: Tier): void {
    if (from === to) return;
    if (from === 2) this.known--;
    else if (from === 1) this.learning--;
    if (to === 2) this.known++;
    else if (to === 1) this.learning++;
  }
  counts(): KnownCounts {
    return { known: this.known, learning: this.learning };
  }
}

interface Change { ms: number; card: string; seq: number; tier: Tier; at: string }

/**
 * The counts now (after every event), the most recently known characters, and the counts
 * at each of `points` (epoch ms; see `historyPoints`).
 */
export function knownProgress(
  notes: readonly KnownNoteInput[],
  cards: readonly KnownCardInput[],
  events: readonly KnownEventInput[],
  points: readonly number[] = [],
  recentLimit = RECENT_CHARACTERS,
): KnownProgress {
  const noteById = new Map<string, KnownNoteInput>();
  for (const n of notes) noteById.set(n.id, n);
  const cardNote = new Map<string, string>();
  const noteCards = new Map<string, string[]>();
  for (const c of cards) {
    if (!noteById.has(c.note_id) || cardNote.has(c.id)) continue;
    cardNote.set(c.id, c.note_id);
    const list = noteCards.get(c.note_id);
    if (list) list.push(c.id);
    else noteCards.set(c.note_id, [c.id]);
  }

  // Each card's tier changes, replayed from its own events.
  const byCard = new Map<string, KnownEventInput[]>();
  for (const e of events) {
    if (!cardNote.has(e.card_id) || Number.isNaN(Date.parse(e.reviewed_at))) continue;
    const list = byCard.get(e.card_id);
    if (list) list.push(e);
    else byCard.set(e.card_id, [e]);
  }
  const changes: Change[] = [];
  for (const [cardId, list] of byCard) {
    list.sort((a, b) => cmp(a.reviewed_at, b.reviewed_at) || cmp(a.id ?? '', b.id ?? ''));
    const timeline = computeCardTimeline(list.map((e): ReviewEvent => ({
      id: e.id ?? '', card_id: e.card_id, rating: e.rating as Rating, reviewed_at: e.reviewed_at,
    })));
    let prev: Tier = 0;
    timeline.forEach((p, seq) => {
      const tier: Tier = masteryLevel(p.queue, p.stability) === 'mastered' ? 2 : 1;
      if (tier !== prev) changes.push({ ms: Date.parse(p.reviewed_at), card: cardId, seq, tier, at: p.reviewed_at });
      prev = tier;
    });
  }
  changes.sort((a, b) => (a.ms - b.ms) || cmp(a.card, b.card) || (a.seq - b.seq));

  const noteInfo = new Map<string, { kind: NoteKind; key: string; chars: string[] }>();
  const info = (noteId: string) => {
    let i = noteInfo.get(noteId);
    if (!i) {
      const hanzi = noteById.get(noteId)!.hanzi;
      i = { kind: noteKind(hanzi), key: noteKey(hanzi), chars: hanCharacters(hanzi) };
      noteInfo.set(noteId, i);
    }
    return i;
  };

  const cardTier = new Map<string, Tier>();
  const noteTier = new Map<string, Tier>();
  const words = new Map<string, Group>();
  const sentences = new Map<string, Group>();
  const chars = new Map<string, Group>();
  const wordTally = new Tally();
  const sentenceTally = new Tally();
  const charTally = new Tally();
  const knownAt = new Map<string, { ms: number; at: string }>();

  const bump = (groups: Map<string, Group>, key: string, tally: Tally, from: Tier, to: Tier): Tier[] => {
    let g = groups.get(key);
    if (!g) { g = new Group(); groups.set(key, g); }
    const before = g.tier();
    if (from >= 1) g.seen--;
    if (from === 2) g.known--;
    if (to >= 1) g.seen++;
    if (to === 2) g.known++;
    const after = g.tier();
    tally.move(before, after);
    return [before, after];
  };

  const sorted = [...points].sort((a, b) => a - b);
  const history: KnownPoint[] = [];
  let pi = 0;
  const record = (upTo: number) => {
    while (pi < sorted.length && sorted[pi] < upTo) {
      history.push({ at_ms: sorted[pi], characters: charTally.counts(), words: wordTally.counts() });
      pi++;
    }
  };

  for (const ch of changes) {
    record(ch.ms);
    cardTier.set(ch.card, ch.tier);
    const noteId = cardNote.get(ch.card)!;
    let tier: Tier = 0;
    for (const c of noteCards.get(noteId)!) {
      const t = cardTier.get(c) ?? 0;
      if (t > tier) tier = t;
    }
    const old = noteTier.get(noteId) ?? 0;
    if (tier === old) continue;
    noteTier.set(noteId, tier);
    const i = info(noteId);
    if (i.kind === 'word') bump(words, i.key, wordTally, old, tier);
    else if (i.kind === 'sentence') bump(sentences, i.key, sentenceTally, old, tier);
    for (const c of i.chars) {
      const [before, after] = bump(chars, c, charTally, old, tier);
      if (after === 2 && before !== 2) knownAt.set(c, { ms: ch.ms, at: ch.at });
      else if (after !== 2 && before === 2) knownAt.delete(c);
    }
  }
  record(Infinity);

  const recent = [...knownAt.entries()]
    .sort((a, b) => (b[1].ms - a[1].ms) || cmp(a[0], b[0]))
    .slice(0, Math.max(0, recentLimit))
    .map(([char, k]) => ({ char, known_at: k.at }));

  return {
    characters: charTally.counts(),
    words: wordTally.counts(),
    sentences: sentenceTally.counts(),
    recent_characters: recent,
    history,
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The headline counts from each note's best card tier, already known (the server's
 * cached card state, for the tutor's student page) — the same grouping as
 * `knownProgress`, without a replay. `tier`: 0 never reviewed, 1 learning, 2 known.
 */
export function knownCountsFromTiers(notes: readonly { hanzi: string; tier: number }[]): {
  characters: KnownCounts; words: KnownCounts; sentences: KnownCounts;
} {
  const words = new Map<string, number>();
  const sentences = new Map<string, number>();
  const chars = new Map<string, number>();
  const best = (m: Map<string, number>, k: string, t: number) => m.set(k, Math.max(m.get(k) ?? 0, t));
  for (const n of notes) {
    const tier = n.tier >= 2 ? 2 : n.tier >= 1 ? 1 : 0;
    if (tier === 0) continue;
    const kind = noteKind(n.hanzi);
    if (kind === 'word') best(words, noteKey(n.hanzi), tier);
    else if (kind === 'sentence') best(sentences, noteKey(n.hanzi), tier);
    for (const c of hanCharacters(n.hanzi)) best(chars, c, tier);
  }
  const count = (m: Map<string, number>): KnownCounts => {
    let known = 0;
    let learning = 0;
    for (const t of m.values()) {
      if (t === 2) known++;
      else learning++;
    }
    return { known, learning };
  };
  return { characters: count(chars), words: count(words), sentences: count(sentences) };
}
