/**
 * The Sentence Coach's "⚡ Study … today" chip: which of the learner's notes a
 * sentence offers to bump (shared/decks/bumps.ts). Pure; the web app
 * (frontend/src/services/studyBumps.ts findSentenceBumps) and the Lab app
 * (core SentenceBumps.kt, parity-tested through parity/fixtures/sentence-bumps.ts)
 * both call it with their local notes.
 *
 * One tap must never silently bump a pile of words:
 *   - the whole sentence (normalised: spaces / punctuation ignored) IS one of the
 *     notes → `exact`: "⚡ Study this today" bumps only that note;
 *   - otherwise the notes whose hanzi appears inside it → `words`: "⚡ Study words
 *     from this today…" opens a picker with nothing ticked. Longer words first
 *     (then where they first appear, then the hanzi), single characters last; a
 *     single character every occurrence of which sits inside a longer matched word
 *     (吃 in 小吃) is left out; one row per spelling (the first note given wins);
 *     at most MAX_SENTENCE_BUMP_WORDS;
 *   - nothing matches → no chip.
 */

import { normalizeHanzi } from '../import/parse';

export const MAX_SENTENCE_BUMP_WORDS = 20;

export interface SentenceBumpNote {
  id: string;
  hanzi: string;
}

export interface SentenceBumps<N extends SentenceBumpNote> {
  /** The sentence itself is this note (bump only it). */
  exact: N | null;
  /** Else the notes found inside it, in picker order (empty when `exact`). */
  words: N[];
}

/** Which notes a sentence offers to bump. `notes` in preference order (first note per spelling wins). */
export function sentenceBumps<N extends SentenceBumpNote>(
  text: string,
  notes: ReadonlyArray<N>,
  max = MAX_SENTENCE_BUMP_WORDS
): SentenceBumps<N> {
  const whole = normalizeHanzi(text ?? '');
  if (!whole) return { exact: null, words: [] };
  const byKey = new Map<string, N>();
  for (const n of notes) {
    const key = normalizeHanzi(n.hanzi ?? '');
    if (key && !byKey.has(key)) byKey.set(key, n);
  }
  const exact = byKey.get(whole);
  if (exact) return { exact, words: [] };

  const hits: Array<{ key: string; note: N; first: number }> = [];
  for (const [key, note] of byKey) {
    const first = whole.indexOf(key);
    if (first >= 0) hits.push({ key, note, first });
  }
  // Positions covered by a longer (2+ character) matched word.
  const covered = new Array<boolean>(whole.length).fill(false);
  for (const h of hits) {
    if (h.key.length < 2) continue;
    for (let i = whole.indexOf(h.key); i >= 0; i = whole.indexOf(h.key, i + 1)) {
      for (let j = i; j < i + h.key.length; j++) covered[j] = true;
    }
  }
  const partOfLonger = (key: string) => {
    for (let i = whole.indexOf(key); i >= 0; i = whole.indexOf(key, i + 1)) if (!covered[i]) return false;
    return true;
  };
  const words = hits
    .filter(h => h.key.length >= 2 || !partOfLonger(h.key))
    .sort((a, b) => b.key.length - a.key.length || a.first - b.first || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, Math.max(0, max))
    .map(h => h.note);
  return { exact: null, words };
}

/** The chip when the sentence is one of the notes. */
export const SENTENCE_BUMP_EXACT_LABEL = '⚡ Study this today';
/** …once it is in today's pocket. */
export const SENTENCE_BUMP_DONE_LABEL = '⚡ In today’s study';
/** The chip when some of its words are notes (opens the picker). */
export const SENTENCE_BUMP_WORDS_LABEL = '⚡ Study words from this today…';
/** The picker's title. */
export const SENTENCE_BUMP_SHEET_TITLE = 'You already have these words';

/** The picker's pinned button: "⚡ Add 2 to today". */
export function addToTodayLabel(count: number): string {
  return count > 0 ? `⚡ Add ${count} to today` : '⚡ Add to today';
}
