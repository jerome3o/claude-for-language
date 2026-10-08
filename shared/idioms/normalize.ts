/**
 * Idiom keys and the explorer link rule (docs/IDIOMS.md). Ported to the Lab app
 * (android-lab/core/…/idioms/Idioms.kt) and parity-tested (android-lab/parity/fixtures/idioms.ts).
 */
import { toSimplified } from '../picture-hunt/match';
import { isStarterIdiom } from './starter';

const HAN = /\p{Script=Han}/u;
/** Whitespace, punctuation, symbols and the "ideographic" marks people paste around a phrase. */
const STRIP = /[\s\p{P}\p{S}]/gu;

export const IDIOM_MIN_CHARS = 3;
export const IDIOM_MAX_CHARS = 12;

/**
 * The cache key of an idiom: NFKC, whitespace / punctuation / symbols stripped, traditional →
 * simplified for the characters in the shared table. "《画蛇添足》 " → "画蛇添足".
 */
export function normalizeIdiomHanzi(text: string): string {
  return toSimplified(String(text ?? '').normalize('NFKC').replace(STRIP, ''));
}

/** Why `text` can't be looked up as a 成语 (null = it can, after normalizeIdiomHanzi). */
export function idiomKeyProblem(text: string): string | null {
  const key = normalizeIdiomHanzi(text);
  if (!key) return 'Type a 成语 in Chinese characters';
  for (const ch of key) if (!HAN.test(ch)) return 'Type the 成语 in Chinese characters only';
  const n = Array.from(key).length;
  if (n < IDIOM_MIN_CHARS) return `A 成语 has at least ${IDIOM_MIN_CHARS} characters`;
  if (n > IDIOM_MAX_CHARS) return `That is longer than a 成语 (at most ${IDIOM_MAX_CHARS} characters)`;
  return null;
}

/** Exactly four Han characters — the shape of almost every 成语. */
export function isIdiomShaped(text: string): boolean {
  const chars = Array.from(text ?? '');
  return chars.length === 4 && chars.every((c) => HAN.test(c));
}

/** CC-CEDICT marks idioms "(idiom)"; some glosses say "idiom" / "proverb" / "saying". */
const IDIOM_GLOSS = /\(idiom\)|\bidiom\b|\bchengyu\b/i;

/**
 * Should the explorer's Word view show "📜 Story & usage" for this word? Four Han characters AND
 * (in the starter list, or an entry already generated on this device / server, or the
 * dictionary calls it an idiom).
 */
export function showIdiomLink(hanzi: string, opts: { known?: boolean; senses?: readonly string[] } = {}): boolean {
  if (!isIdiomShaped(hanzi)) return false;
  if (isStarterIdiom(hanzi) || opts.known) return true;
  return (opts.senses ?? []).some((s) => IDIOM_GLOSS.test(s));
}

/** The "Try it" score line. */
export function idiomQuizScoreLine(correct: number, total: number): string {
  if (total <= 0) return '';
  if (correct === total) return `${correct} / ${total} — 太棒了! You’ve got this one.`;
  if (correct * 2 >= total) return `${correct} / ${total} — nearly there.`;
  return `${correct} / ${total} — read the story once more and try again.`;
}
