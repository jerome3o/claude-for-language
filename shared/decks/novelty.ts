/**
 * "New characters first": which brand-new (primary, blue) notes a deck introduces
 * today. The deck queue and the budget decide HOW MANY cards each deck gives
 * (budget.ts); this decides WHICH of a deck's unseen notes they are.
 *
 * Seen = the Han characters (and the Han text, for words) of every note with a
 * card past NEW (reviewed at least once). Only the note's hanzi counts — not its
 * example sentence, which would mark characters as "seen" that were only glanced
 * at on a card back.
 *
 * Ranking of a deck's candidates (best first), applied greedily — every pick
 * marks its characters / text as seen before the next pick, across decks too, so
 * two notes sharing one new character aren't both front-loaded:
 *   1. never-seen Han characters in the hanzi, counted up to NEW_CHARACTER_RANK_CAP
 *      (2): a note teaching a new character first, but a long sentence with five
 *      new characters doesn't beat a word with two;
 *   2. the note's Han text never seen as part of a seen note (an unseen word, e.g.
 *      学生 when only 大学生 was studied counts as seen);
 *   3. fewer Han characters (words before sentences, short sentences first);
 *   4. the existing order (card id).
 *
 * Shared by the web (frontend/src/db/database.ts via study-queue.ts) and the Lab
 * app (android-lab/core Novelty.kt, parity-tested through android-lab/parity).
 */
import { hanCharacters, isHanCodePoint } from '../progress/known';

/** New characters beyond this many don't rank a note higher. */
export const NEW_CHARACTER_RANK_CAP = 2;

/** What the learner has seen: characters, and the Han text of each seen note ('\n'-separated). */
export interface SeenText {
  chars: Set<string>;
  words: string;
}

/** Every Han character of a text, in order (non-Han characters dropped). */
export function hanText(text: string): string {
  let out = '';
  for (const ch of text) if (isHanCodePoint(ch.codePointAt(0)!)) out += ch;
  return out;
}

export function emptySeen(): SeenText {
  return { chars: new Set(), words: '' };
}

/** Mark a note's hanzi as seen (mutates). */
export function markSeen(seen: SeenText, hanzi: string): void {
  for (const c of hanCharacters(hanzi)) seen.chars.add(c);
  const text = hanText(hanzi);
  if (text) seen.words += text + '\n';
}

export function seenFrom(hanzi: Iterable<string>): SeenText {
  const seen = emptySeen();
  for (const h of hanzi) markSeen(seen, h);
  return seen;
}

export interface Novelty {
  /** Distinct Han characters not seen yet. */
  newChars: number;
  /** The note's Han text never appeared in a seen note. */
  unseenWord: boolean;
  /** Han characters in the hanzi (with repeats). */
  length: number;
}

export function noveltyOf(hanzi: string, seen: SeenText): Novelty {
  const text = hanText(hanzi);
  let newChars = 0;
  for (const c of hanCharacters(hanzi)) if (!seen.chars.has(c)) newChars++;
  return { newChars, unseenWord: text !== '' && !seen.words.includes(text), length: [...text].length };
}

/** < 0 when `a` should be introduced before `b`; 0 = keep the existing order. */
export function compareNovelty(a: Novelty, b: Novelty): number {
  const ca = Math.min(a.newChars, NEW_CHARACTER_RANK_CAP);
  const cb = Math.min(b.newChars, NEW_CHARACTER_RANK_CAP);
  if (ca !== cb) return cb - ca;
  if (a.unseenWord !== b.unseenWord) return a.unseenWord ? -1 : 1;
  return a.length - b.length;
}

/**
 * Pick `take` items (in pick order) from `candidates` (in their existing order),
 * best novelty first, each pick marking its hanzi as seen (mutates `seen`).
 * Ties keep the existing order.
 */
export function pickByNovelty<T>(
  candidates: readonly T[],
  take: number,
  hanziOf: (item: T) => string,
  seen: SeenText
): T[] {
  const rest = candidates.map(item => {
    const hanzi = hanziOf(item);
    const text = hanText(hanzi);
    return {
      item,
      hanzi,
      chars: hanCharacters(hanzi),
      text,
      length: [...text].length,
      // Once seen a word stays seen; while unseen only newly picked text can change that.
      unseenWord: text !== '' && !seen.words.includes(text),
    };
  });
  const out: T[] = [];
  while (out.length < take && rest.length > 0) {
    let best = -1;
    let bestN: Novelty | null = null;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i];
      let newChars = 0;
      for (const c of r.chars) if (!seen.chars.has(c)) newChars++;
      const n: Novelty = { newChars, unseenWord: r.unseenWord, length: r.length };
      if (bestN === null || compareNovelty(n, bestN) < 0) {
        best = i;
        bestN = n;
      }
    }
    const [picked] = rest.splice(best, 1);
    out.push(picked.item);
    markSeen(seen, picked.hanzi);
    if (picked.text) for (const r of rest) if (r.unseenWord && picked.text.includes(r.text)) r.unseenWord = false;
  }
  return out;
}
