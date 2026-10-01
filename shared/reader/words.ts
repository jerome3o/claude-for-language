/**
 * Reader word chips: a graded-reader page's Chinese split into words, each
 * with pinyin and a short gloss, so the reading view can show tappable chips
 * (tap a word → what it is → add it as a card).
 *
 * THE INVARIANT: the segments' texts concatenated are exactly the page text —
 * punctuation, quotes, spaces and line breaks included. Everything here keeps
 * it: `alignReaderWords` turns whatever Claude proposed into segments that
 * satisfy it (unmatched stretches fall back to one character per segment),
 * and `parseReaderWords` refuses stored segments that no longer match the
 * page (its text was edited since), so stale chips are never shown.
 *
 * Punctuation and whitespace are segments too, with empty pinyin / gloss;
 * `isTappableWord` decides which segments are chips.
 *
 * Used by the worker (services/reader-words.ts), the web reading views and,
 * ported, the Lab app (`core/…/ReaderWords.kt`, parity-tested).
 */
import { normalizePinyin } from '../import/pinyin';

export interface ReaderWord {
  /** Exactly as it appears in the page text. */
  text: string;
  /** Tone-marked pinyin ('' for punctuation, or when it could not be had). */
  pinyin: string;
  /** A short English gloss in this context ('' for punctuation / unknown). */
  gloss: string;
}

/** What the "More about this word" explanation returns (cached per word + sentence). */
export interface ReaderWordExplanation {
  word: string;
  pinyin: string;
  /** One clear meaning — the one this sentence uses (the card's english). */
  english: string;
  /** 2–4 short lines: what it means here, how the characters build it, usage. */
  explanation: string;
  /** The card-standard explanation for a card made from this word. */
  fun_facts: string;
  /** A short real sentence containing the word exactly (the card's sentence clue). */
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const HAN = /\p{Script=Han}/u;
const SPACE = /\s/u;

/** A segment that is a word (a chip): it holds a letter, digit or hanzi. */
export function isTappableWord(text: string): boolean {
  return LETTER_OR_DIGIT.test(text);
}

function isHan(ch: string): boolean {
  return HAN.test(ch);
}

/** Han characters in a string (for coverage). */
function hanCount(text: string): number {
  let n = 0;
  for (const ch of text) if (isHan(ch)) n++;
  return n;
}

/** True when `words` is a non-empty segmentation of exactly `text`. */
export function wordsMatchText(words: ReadonlyArray<{ text: string }> | null | undefined, text: string): boolean {
  if (!Array.isArray(words) || words.length === 0 || !text) return false;
  let joined = '';
  for (const w of words) {
    if (!w || typeof w.text !== 'string' || w.text.length === 0) return false;
    joined += w.text;
  }
  return joined === text;
}

/**
 * Stored segments (a JSON string from the `reader_pages.words` column, or an
 * array) → clean segments, or null when missing, malformed, or stale (they
 * don't concatenate to the page's current text).
 */
export function parseReaderWords(raw: unknown, text: string): ReaderWord[] | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const words: ReaderWord[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.text !== 'string') return null;
    words.push({
      text: o.text,
      pinyin: typeof o.pinyin === 'string' ? o.pinyin : '',
      gloss: typeof o.gloss === 'string' ? o.gloss : '',
    });
  }
  return wordsMatchText(words, text) ? words : null;
}

/**
 * One segment per hanzi; runs of Latin letters / digits, of punctuation and
 * of whitespace each kept together. No pinyin or gloss — the fallback when a
 * stretch of the page could not be matched to Claude's words.
 */
export function fallbackReaderWords(text: string): ReaderWord[] {
  const out: ReaderWord[] = [];
  let run = '';
  let runKind: 'latin' | 'punct' | 'space' | null = null;
  const flush = () => {
    if (run) out.push({ text: run, pinyin: '', gloss: '' });
    run = '';
    runKind = null;
  };
  for (const ch of text) {
    if (isHan(ch)) {
      flush();
      out.push({ text: ch, pinyin: '', gloss: '' });
      continue;
    }
    const kind = SPACE.test(ch) ? 'space' : LETTER_OR_DIGIT.test(ch) ? 'latin' : 'punct';
    if (kind !== runKind) flush();
    runKind = kind;
    run += ch;
  }
  flush();
  return out;
}

/** How far ahead (in characters) a proposed word may be found and still be accepted. */
const MAX_GAP = 4;

export interface AlignedWords {
  words: ReaderWord[];
  /** Share of the page's hanzi covered by Claude's words (1 when the page has none). */
  coverage: number;
}

function cleanGloss(gloss: unknown): string {
  return typeof gloss === 'string' ? gloss.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
}

function cleanPinyin(pinyin: unknown): string {
  return typeof pinyin === 'string' ? normalizePinyin(pinyin).slice(0, 60) : '';
}

/**
 * Claude's proposed words → a segmentation that satisfies the invariant.
 *
 * Walks the page text: each proposal is looked for at the current position
 * (or a few characters ahead — the skipped stretch is filled per character);
 * a proposal that isn't in the text there (a changed character, a word it
 * invented or dropped) is ignored. Punctuation stuck to a word ("好。") is
 * split off so the chip holds only the word. Whatever is left at the end is
 * filled per character. Whitespace in the page (line breaks) survives as its
 * own segments even though Claude is never asked to return it.
 */
export function alignReaderWords(
  text: string,
  proposed: ReadonlyArray<{ text?: unknown; pinyin?: unknown; gloss?: unknown }>,
): AlignedWords {
  const out: ReaderWord[] = [];
  let pos = 0;
  let covered = 0;
  const fill = (to: number) => {
    if (to > pos) out.push(...fallbackReaderWords(text.slice(pos, to)));
    pos = to;
  };
  for (const p of proposed) {
    if (!p || typeof p.text !== 'string') continue;
    const t = p.text.trim();
    if (!t) continue;
    const idx = text.indexOf(t, pos);
    if (idx < 0 || idx - pos > MAX_GAP) continue;
    fill(idx);
    // Split leading / trailing non-word characters off the word.
    const chars = Array.from(t);
    let start = 0;
    let end = chars.length;
    while (start < end && !LETTER_OR_DIGIT.test(chars[start])) start++;
    while (end > start && !LETTER_OR_DIGIT.test(chars[end - 1])) end--;
    const lead = chars.slice(0, start).join('');
    const core = chars.slice(start, end).join('');
    const trail = chars.slice(end).join('');
    if (lead) out.push(...fallbackReaderWords(lead));
    if (core) {
      out.push({ text: core, pinyin: cleanPinyin(p.pinyin), gloss: cleanGloss(p.gloss) });
      covered += hanCount(core);
    }
    if (trail) out.push(...fallbackReaderWords(trail));
    pos = idx + t.length;
  }
  fill(text.length);
  const total = hanCount(text);
  return { words: out, coverage: total === 0 ? 1 : covered / total };
}

/** Start offset (in UTF-16 units, as `String.slice`) of each segment. */
export function wordOffsets(words: ReadonlyArray<{ text: string }>): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const w of words) {
    offsets.push(at);
    at += w.text.length;
  }
  return offsets;
}

const TERMINAL = /[。！？!?\n]/;
const CLOSERS = /[”"』」’'）)]/;

/**
 * The sentence of `text` that holds the stretch [start, end): from after the
 * previous terminal (。！？!? or a line break, a closing quote kept with it)
 * to the next one, trimmed. What the word explanation and the card's sentence
 * clue are written from.
 */
export function sentenceAround(text: string, start: number, end: number = start + 1): string {
  let from = start;
  while (from > 0) {
    const prev = text[from - 1];
    if (TERMINAL.test(prev)) break;
    if (CLOSERS.test(prev) && from - 2 >= 0 && /[。！？!?]/.test(text[from - 2])) break;
    from--;
  }
  let to = Math.max(end, start);
  while (to < text.length && !TERMINAL.test(text[to])) to++;
  if (to < text.length && text[to] !== '\n') {
    to++;
    while (to < text.length && /[。！？!?]/.test(text[to])) to++;
    if (to < text.length && CLOSERS.test(text[to])) to++;
  }
  return text.slice(from, to).trim();
}
