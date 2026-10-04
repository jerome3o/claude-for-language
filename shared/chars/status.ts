/**
 * The character sheet's "Words with 字" list (docs/STUDY_SESSION.md "Character sheet"):
 * which of the dictionary's frequent words the learner already has, from their own notes and
 * cards on the device (offline). The Lab app's port (`core/…/CharWords.kt`) is parity-tested
 * against this file (android-lab/parity/fixtures/char-words.ts).
 *
 * - **known**: a note with the same spelling (`noteKey`) has a mature card — in Review with
 *   stability > 21 days, the deck page's "mastered" and the Progress page's "known"
 *   (`masteryLevel`, shared/progress/known.ts).
 * - **in_decks**: they have the word but no card of it is mature yet (new or learning).
 * - **none**: no note with that spelling.
 *
 * Order: the word(s) of the card on screen first (highlighted), then the dictionary's
 * frequency order — known words stay in place, the sheet only dims them.
 */
import { masteryLevel } from '../progress/mastery';
import { noteKey } from '../progress/known';

export type CharWordStatus = 'known' | 'in_decks' | 'none';

export interface CharStatusNote {
  id: string;
  hanzi: string;
}

export interface CharStatusCard {
  note_id: string;
  /** 0 NEW, 1 LEARNING, 2 REVIEW, 3 RELEARNING. */
  queue: number;
  stability: number;
}

export interface CharWordRow<W extends { hanzi: string }> {
  word: W;
  status: CharWordStatus;
  /** The learner's notes with this spelling (any deck), oldest input order. */
  note_ids: string[];
  /** The card on screen is (or contains) this word. */
  current: boolean;
}

/** The card on screen "is" the word when the word's spelling occurs in the card's hanzi. */
export function wordInCard(wordHanzi: string, cardHanzi: string | null | undefined): boolean {
  if (!cardHanzi) return false;
  const w = noteKey(wordHanzi);
  return w.length > 0 && noteKey(cardHanzi).includes(w);
}

export function charWordRows<W extends { hanzi: string }>(
  words: readonly W[],
  notes: readonly CharStatusNote[],
  cards: readonly CharStatusCard[],
  cardHanzi?: string | null,
): CharWordRow<W>[] {
  const wanted = new Set(words.map((w) => noteKey(w.hanzi)).filter(Boolean));
  const notesByKey = new Map<string, string[]>();
  const keyOfNote = new Map<string, string>();
  for (const n of notes) {
    const k = noteKey(n.hanzi);
    if (!k || !wanted.has(k)) continue;
    keyOfNote.set(n.id, k);
    const list = notesByKey.get(k);
    if (list) {
      if (!list.includes(n.id)) list.push(n.id);
    } else notesByKey.set(k, [n.id]);
  }
  const knownKeys = new Set<string>();
  for (const c of cards) {
    const k = keyOfNote.get(c.note_id);
    if (k && masteryLevel(c.queue, c.stability) === 'mastered') knownKeys.add(k);
  }

  const seen = new Set<string>();
  const rows: CharWordRow<W>[] = [];
  for (const word of words) {
    const k = noteKey(word.hanzi);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const ids = notesByKey.get(k) ?? [];
    rows.push({
      word,
      status: knownKeys.has(k) ? 'known' : ids.length > 0 ? 'in_decks' : 'none',
      note_ids: [...ids],
      current: wordInCard(word.hanzi, cardHanzi),
    });
  }
  // Stable: the card's own word(s) first, everything else in frequency order.
  return [...rows.filter((r) => r.current), ...rows.filter((r) => !r.current)];
}

/** "3 of 20 known · 2 in your decks" — the line under the "Words with 字" heading. */
export function charWordsSummary(rows: readonly { status: CharWordStatus }[]): string {
  const known = rows.filter((r) => r.status === 'known').length;
  const inDecks = rows.filter((r) => r.status === 'in_decks').length;
  const parts = [`${known} of ${rows.length} known`];
  if (inDecks > 0) parts.push(`${inDecks} in your decks`);
  return parts.join(' · ');
}

export const CHAR_STATUS_LABEL: Record<CharWordStatus, string> = {
  known: '✓ Known',
  in_decks: '📚 In your decks',
  none: '',
};
