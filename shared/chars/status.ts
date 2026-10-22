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
import { isHanCodePoint, noteKey } from '../progress/known';

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

/**
 * A single character's OWN card (docs/LANGUAGE_EXPLORER.md "Character view"): does the learner
 * have a note that IS this character (性 itself — not 性别 or 人性)? Same spelling rule as the
 * "Words with 字" rows (`noteKey`: punctuation / spaces ignored, so a note "性。" counts) and the
 * same statuses (known = a mature card, in_decks = any other card, none = no note).
 */
export interface OwnCard {
  status: CharWordStatus;
  /** The learner's notes that are this character (any deck), in input order. */
  note_ids: string[];
}

/** True for exactly one Han character — the only thing that can have an own card. */
export function isSingleHan(text: string): boolean {
  const cps = [...text];
  return cps.length === 1 && isHanCodePoint(cps[0].codePointAt(0)!);
}

/**
 * The own card of each entry of `chars`, keyed by the entry. Anything that isn't exactly one Han
 * character (a word, Latin, punctuation, '') is `none` with no notes.
 */
export function charOwnCards(chars: readonly string[], notes: readonly CharStatusNote[], cards: readonly CharStatusCard[]): Record<string, OwnCard> {
  const out: Record<string, OwnCard> = {};
  for (const c of chars) out[c] = { status: 'none', note_ids: [] };
  const single = [...new Set(chars)].filter(isSingleHan);
  for (const r of charWordRows(single.map((hanzi) => ({ hanzi })), notes, cards)) {
    out[r.word.hanzi] = { status: r.status, note_ids: r.note_ids };
  }
  return out;
}

/** The deck list in a line: "HSK 5", "HSK 5, Food", else "your decks". */
function deckList(decks: readonly string[]): string {
  const names = [...new Set(decks.map((d) => d.trim()).filter(Boolean))];
  return names.length ? names.join(', ') : 'your decks';
}

/**
 * The Character view's status line: "✓ Known — you have 性 as a card in HSK 5" /
 * "📚 You have 性 as a card in HSK 5"; '' when there is no card (the view offers
 * `addOwnCardLabel` instead). Icon + words, never colour alone.
 */
export function ownCardLine(char: string, status: CharWordStatus, decks: readonly string[]): string {
  if (status === 'known') return `✓ Known — you have ${char} as a card in ${deckList(decks)}`;
  if (status === 'in_decks') return `📚 You have ${char} as a card in ${deckList(decks)}`;
  return '';
}

/** "+ Add 性 as a card" — the Character view's button when the character has no card of its own. */
export function addOwnCardLabel(char: string): string {
  return `+ Add ${char} as a card`;
}

/** The small badge on a Word view character chip whose character has its own card. */
export const OWN_CARD_BADGE: Record<CharWordStatus, string> = { known: '✓', in_decks: '📚', none: '' };

/**
 * A Word view character chip's accessible label: "The character 性, xìng — you have it as a
 * card, known" / "… — you have it as a card" / just the character.
 */
export function charChipLabel(char: string, syllable: string | null | undefined, status: CharWordStatus): string {
  const base = `The character ${char}${syllable ? `, ${syllable}` : ''}`;
  if (status === 'known') return `${base} — you have it as a card, known`;
  if (status === 'in_decks') return `${base} — you have it as a card`;
  return base;
}
