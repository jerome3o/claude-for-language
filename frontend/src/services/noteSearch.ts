/**
 * The Decks tab card search: which notes match a query. Pure, so the same
 * rule is unit-tested and shared by the results list.
 */

export interface SearchableNote {
  hanzi: string | null | undefined;
  pinyin: string | null | undefined;
  english: string | null | undefined;
  sentence_clue?: string | null;
}

/** Lower-case and drop tone marks, so "yinhang" finds "yínháng". */
export function stripTones(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Hanzi, English and the card sentence by substring; pinyin with or without
 * tone marks. `q` is the trimmed lower-case query, `qStripped` its tone-free
 * form. Null-safe: a note with a missing field never throws (one bad row
 * must not take the whole list down).
 */
export function noteMatches(note: SearchableNote, q: string, qStripped: string = stripTones(q)): boolean {
  if (!q) return false;
  if ((note.hanzi || '').toLowerCase().includes(q)) return true;
  if ((note.english || '').toLowerCase().includes(q)) return true;
  const pinyin = (note.pinyin || '').toLowerCase();
  if (pinyin.includes(q)) return true;
  if (qStripped && stripTones(pinyin).includes(qStripped)) return true;
  if (note.sentence_clue && note.sentence_clue.toLowerCase().includes(q)) return true;
  return false;
}
