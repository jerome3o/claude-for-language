/**
 * The card's own example sentence is ONE OF the note's example sentences (docs/STUDY_SESSION.md "Example
 * sentences — one model", migration 0153): a `note_sentences` row flagged `is_card`, with a deterministic id
 * `<note id>-card`, sorted first (position −1). Every reader — the answer side's list, the Sentence round,
 * "Listen in context", the practice history, explain / translation caches, ▶ audio, exports — treats it like
 * any other row; "From the card" is just a badge drawn from `is_card`.
 *
 * Until the deprecated `notes.sentence_clue*` columns are dropped, the API still returns them on notes (a
 * mirror the worker keeps identical to the row — worker/src/db/card-sentence.ts) and still accepts them as the
 * way to write the card sentence. A device may hold a note newer than its rows (it synced notes before the
 * migration, or the learner just edited the sentence): `withCardSentence` makes the card row from the note in
 * that one case, so the sentence is there offline right after a sync. That is the ONLY place a device reads
 * the old fields for display.
 *
 * Pure; the Lab app's port (core `CardSentence.kt`) is parity-tested (parity/fixtures/card-sentence.ts).
 */

/** The id suffix of a note's card row. */
export const CARD_SENTENCE_SUFFIX = '-card';

/** The card row's id for a note (the same on the server, the web and the Lab app). */
export function cardSentenceId(noteId: string): string {
  return `${noteId}${CARD_SENTENCE_SUFFIX}`;
}

/** The legacy practice-history key of the card sentence (events written before migration 0153). */
export const LEGACY_CARD_SENTENCE_KEY = 'clue';
/** The legacy row-key prefix (`clue:<noteId>`) older builds used for the card sentence in lists. */
const LEGACY_ROW_PREFIX = 'clue:';

/** This key / row id is a card sentence (`<note>-card`, or a legacy `clue:<note>` / `clue`). */
export function isCardSentenceKey(key: string): boolean {
  return key.endsWith(CARD_SENTENCE_SUFFIX) || key.startsWith(LEGACY_ROW_PREFIX) || key === LEGACY_CARD_SENTENCE_KEY;
}

/**
 * A sentence key as the history stores it from now on: the row id; a legacy `clue` (events) or
 * `clue:<noteId>` (row keys of older builds) becomes the note's card row id.
 */
export function canonicalSentenceKey(key: string, noteId: string): string {
  if (key === LEGACY_CARD_SENTENCE_KEY) return cardSentenceId(noteId);
  if (key.startsWith(LEGACY_ROW_PREFIX)) return cardSentenceId(key.slice(LEGACY_ROW_PREFIX.length) || noteId);
  return key;
}

/** The fields of a sentence row the helpers below read / make. */
export interface SentenceRowLike {
  id: string;
  note_id: string;
  position: number;
  hanzi: string;
  pinyin: string | null;
  translation: string | null;
  audio_url: string | null;
  focus: string | null;
  focus_note: string | null;
  explanation: string | null;
  /** 1 / true = the card's own sentence. Absent on rows synced before migration 0153. */
  is_card?: number | boolean | null;
  created_at?: string;
  updated_at?: string;
}

/** The note fields (deprecated mirror) a device may hold newer than its card row. */
export interface NoteCardSentenceFields {
  id: string;
  sentence_clue?: string | null;
  sentence_clue_pinyin?: string | null;
  sentence_clue_translation?: string | null;
  sentence_clue_audio_url?: string | null;
}

export function isCardSentenceRow(row: Pick<SentenceRowLike, 'id' | 'is_card'>): boolean {
  return row.is_card === 1 || row.is_card === true || row.id.endsWith(CARD_SENTENCE_SUFFIX);
}

const blank = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

/**
 * A note's sentences as ONE list, the card's own first: `rows` as stored (any order), plus the card row made
 * from the note when the device has none for it yet or holds an older text than the note's. A set row saying
 * exactly the card sentence is dropped (the card row is that sentence). The rest keep their stored order.
 *
 * `note` = null / without the field = trust the rows as they are (no note to compare with).
 */
export function withCardSentence<T extends SentenceRowLike>(
  note: NoteCardSentenceFields | null | undefined,
  rows: readonly T[],
): Array<T | (SentenceRowLike & { is_card: 1 })> {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const stored = sorted.find((r) => isCardSentenceRow(r)) ?? null;
  let card: T | (SentenceRowLike & { is_card: 1 }) | null = stored;
  const hasField = !!note && Object.prototype.hasOwnProperty.call(note, 'sentence_clue');
  const noteText = hasField ? blank(note!.sentence_clue) : null;
  if (hasField && noteText && (!stored || stored.hanzi.trim() !== noteText)) {
    // The note is newer than this device's card row (or there is none yet): the row as the server makes it.
    card = {
      id: cardSentenceId(note!.id),
      note_id: note!.id,
      position: -1,
      hanzi: noteText,
      pinyin: blank(note!.sentence_clue_pinyin),
      translation: blank(note!.sentence_clue_translation),
      audio_url: blank(note!.sentence_clue_audio_url),
      focus: null,
      focus_note: null,
      explanation: null,
      is_card: 1,
    };
  } else if (hasField && !noteText) {
    // The card sentence was removed on the note: a stale card row never shows.
    card = null;
  } else if (stored && hasField && noteText && stored.hanzi.trim() === noteText) {
    // Same text: the row wins, but a translation / pinyin / clip only the note has yet is filled in.
    const fill = {
      pinyin: stored.pinyin ?? blank(note!.sentence_clue_pinyin),
      translation: stored.translation ?? blank(note!.sentence_clue_translation),
      audio_url: stored.audio_url ?? blank(note!.sentence_clue_audio_url),
    };
    card = fill.pinyin === stored.pinyin && fill.translation === stored.translation && fill.audio_url === stored.audio_url
      ? stored
      : { ...stored, ...fill };
  }
  const cardText = card ? card.hanzi.trim() : null;
  const rest = sorted.filter((r) => !isCardSentenceRow(r) && !(cardText && r.hanzi.trim() === cardText));
  return card ? [card, ...rest] : rest;
}

/** The note's card row among these (as `withCardSentence` gives it), or null. */
export function cardSentenceOf<T extends SentenceRowLike>(
  note: NoteCardSentenceFields | null | undefined,
  rows: readonly T[],
): T | (SentenceRowLike & { is_card: 1 }) | null {
  const list = withCardSentence(note, rows);
  return list.length > 0 && isCardSentenceRow(list[0]) ? list[0] : null;
}
