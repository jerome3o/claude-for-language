/**
 * Quick drills from the language explorer (docs/LANGUAGE_EXPLORER.md "Mini drills"): 3–5
 * short questions built from what is on screen — the word / character explored and its
 * related words. Practice only: results go to analytics, never to review events, so card
 * scheduling is untouched. Deterministic for a seed (mulberry32), so the Lab app's port
 * (core/…/explorer/Drill.kt) is parity-tested against this file.
 */
import type { CharWord } from '../chars/types';
import { wordChars } from './word';

export type DrillQuestionKind = 'meaning' | 'listen' | 'reverse' | 'tone' | 'write';

export interface DrillQuestion {
  kind: DrillQuestionKind;
  /** meaning / tone / write: the Chinese shown; listen: the text played; reverse: the English shown. */
  prompt: string;
  /** tone: the word the character sits in (shown with the character marked). */
  context?: string;
  /** Pinyin of the prompt, revealed after answering. */
  pinyin?: string;
  /** Choices (empty for `write`: the stroke-order pad grades it). tone: "1".."5". */
  options: string[];
  /** Index of the right option (-1 for `write`). */
  answer: number;
}

export type DrillTarget = { kind: 'word'; word: CharWord; syllables?: string[] | null } | { kind: 'char'; char: string };

export const DRILL_MAX = 5;
export const DRILL_MIN = 3;
/** Options per multiple-choice question (fewer when the pool is small, never under 3). */
export const DRILL_OPTIONS = 4;

/** mulberry32: a tiny seeded PRNG, the same numbers in TypeScript and Kotlin. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with the given random source (a copy). */
export function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The right answer plus up to DRILL_OPTIONS - 1 distinct distractors, shuffled; null under 3 options. */
function choice(right: string, distractors: readonly string[], rnd: () => number): { options: string[]; answer: number } | null {
  const pool = shuffled([...new Set(distractors.filter((d) => d && d !== right))], rnd).slice(0, DRILL_OPTIONS - 1);
  if (pool.length < 2) return null;
  const options = shuffled([right, ...pool], rnd);
  return { options, answer: options.indexOf(right) };
}

/** The first sense of a gloss ("bank; banking" → "bank"), for short options. */
export function shortGloss(english: string): string {
  return english.split(/[;]/)[0].trim();
}

/**
 * The drill for a Word view (target = the word) or a Character view (target = the character;
 * its first two words carry the word questions). `pool` = the related words / "Words with 字"
 * on screen (distractors). Order: meaning → listen → tone(s) → reverse → write, at most `max`.
 * Fewer than DRILL_MIN questions possible → [] (the button is hidden).
 */
export function buildDrill(target: DrillTarget, pool: readonly CharWord[], seed: number, max = DRILL_MAX): DrillQuestion[] {
  const rnd = seededRandom(seed);
  const usable = pool.filter((w) => w.hanzi && w.english);
  const focus: CharWord[] =
    target.kind === 'word' ? [target.word] : usable.filter((w) => w.hanzi.includes(target.char)).slice(0, 2);
  if (focus.length === 0 || !focus[0].english) return [];
  const focusSet = new Set(focus.map((w) => w.hanzi));
  const others = usable.filter((w) => !focusSet.has(w.hanzi));
  const glosses = (exclude: CharWord) => others.concat(focus).filter((w) => w !== exclude).map((w) => shortGloss(w.english));
  const hanzis = (exclude: CharWord) => others.concat(focus).filter((w) => w !== exclude).map((w) => w.hanzi);

  const out: DrillQuestion[] = [];
  const first = focus[0];

  const meaning = choice(shortGloss(first.english), glosses(first), rnd);
  if (meaning) out.push({ kind: 'meaning', prompt: first.hanzi, pinyin: first.pinyin, ...meaning });

  const heard = focus[1] ?? first;
  const listen = choice(heard.hanzi, hanzis(heard), rnd);
  if (listen) out.push({ kind: 'listen', prompt: heard.hanzi, pinyin: heard.pinyin, ...listen });

  // Tones: the explored character in its first word, or each character of the word (max 2).
  const toneSource = target.kind === 'word' ? target.word : first;
  const chars = wordChars(toneSource.hanzi, toneSource.pinyin, target.kind === 'word' ? target.syllables : null);
  const toneChars = (target.kind === 'char' ? chars.filter((c) => c.char === target.char) : chars).filter((c) => c.tone !== null).slice(0, 2);
  for (const c of toneChars) {
    out.push({ kind: 'tone', prompt: c.char, context: toneSource.hanzi, pinyin: c.syllable ?? undefined, options: ['1', '2', '3', '4', '5'], answer: (c.tone ?? 5) - 1 });
  }

  // Reverse: a related word on screen, English → which word?
  const back = others[0];
  if (back) {
    const reverse = choice(back.hanzi, hanzis(back), rnd);
    if (reverse) out.push({ kind: 'reverse', prompt: shortGloss(back.english), pinyin: back.pinyin, ...reverse });
  }

  const writeChar = target.kind === 'char' ? target.char : [...target.word.hanzi][0];
  out.push({ kind: 'write', prompt: writeChar, options: [], answer: -1 });

  const picked = out.length > max ? [...out.slice(0, max - 1), out[out.length - 1]] : out;
  return picked.length >= DRILL_MIN ? picked : [];
}

/** "4 / 5 — 很好！" — the line at the end of a drill. */
export function drillScoreLine(correct: number, total: number): string {
  const ratio = total > 0 ? correct / total : 0;
  const cheer = ratio === 1 ? '完美！Perfect' : ratio >= 0.6 ? '很好！Nice' : '加油！Keep going';
  return `${correct} / ${total} — ${cheer}`;
}
