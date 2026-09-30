/**
 * Tab-complete on the call's text board: after someone types Chinese and
 * pauses, a grey suggestion ` - pīnyīn - meaning` appears right after the
 * caret; Tab (or the chip on a phone) types it in like any other edit.
 *
 * This module is the pure part — WHEN to suggest and WHAT the inserted text
 * looks like. The web board (components/calls/TextBoard.tsx) and the Lab app
 * (core CallGloss.kt, parity-tested against this file) both call it; the
 * worker (POST /api/calls/:id/gloss) cleans Claude's reply with cleanGloss.
 *
 * Indexes are CHARACTERS (code points), like the text board's CRDT.
 */

import { normalizePinyin } from '../import/pinyin';

/** Typing must have stopped this long (and no IME composition open) before we ask. */
export const GLOSS_DEBOUNCE_MS = 500;
/** The phrase glossed is the trailing Chinese run, at most this many characters. */
export const GLOSS_MAX_SEGMENT = 40;
/** Between the Chinese, the pinyin and the English. */
export const GLOSS_SEPARATOR = ' - ';
/** The English is cut to this many words. */
export const GLOSS_MAX_ENGLISH_WORDS = 8;
export const GLOSS_MAX_PINYIN_CHARS = 240;

/** CJK ideographs (unified, ext. A–F, compatibility) and 〇. */
export function isHanChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f) ||
    cp === 0x3007
  );
}

/** Punctuation that may sit inside or at the end of a Chinese phrase. */
const CHINESE_PUNCT = new Set(Array.from('，。！？、；：“”‘’（）《》〈〉【】「」『』〔〕…—～·．﹏'));

export function isChinesePunct(ch: string): boolean {
  return CHINESE_PUNCT.has(ch);
}

/** Punctuation after which a long run may be cut (a new clause starts). */
const CLAUSE_BREAK = new Set(Array.from('，。！？、；：…'));

export type GlossSkip =
  /** An IME (pinyin) composition is open. */
  | 'composing'
  /** Text is selected (not a plain caret). */
  | 'selection'
  /** The text just before the caret isn't Chinese. */
  | 'no_chinese'
  /** The line already has ` - …` after the Chinese. */
  | 'already_glossed'
  /** More text follows on the line — the ghost would sit on top of it. */
  | 'not_at_line_end';

export type GlossCheck =
  | { ok: true; segment: string; start: number; end: number }
  | { ok: false; reason: GlossSkip };

/**
 * Should the board suggest a gloss at this caret? `start`/`end` are the
 * selection in characters (equal for a caret). The segment is the run of
 * Chinese characters (Chinese punctuation allowed) that ends at the caret on
 * the current line, without leading punctuation, cut to its last
 * GLOSS_MAX_SEGMENT characters (at a clause break when there is one).
 */
export function findGlossSegment(text: string, selStart: number, selEnd: number, composing = false): GlossCheck {
  if (composing) return { ok: false, reason: 'composing' };
  if (selStart !== selEnd) return { ok: false, reason: 'selection' };
  const chars = Array.from(text);
  const caret = Math.max(0, Math.min(selEnd, chars.length));

  let lineEnd = caret;
  while (lineEnd < chars.length && chars[lineEnd] !== '\n') lineEnd++;
  const rest = chars.slice(caret, lineEnd).join('');
  const restTrim = rest.replace(/^[ \t　]+/, '');
  if (/^[-–—]/.test(restTrim)) return { ok: false, reason: 'already_glossed' };
  if (restTrim.trim() !== '') return { ok: false, reason: 'not_at_line_end' };

  let start = caret;
  while (start > 0 && chars[start - 1] !== '\n' && (isHanChar(chars[start - 1]) || isChinesePunct(chars[start - 1]))) start--;
  while (start < caret && isChinesePunct(chars[start])) start++;
  if (caret - start > GLOSS_MAX_SEGMENT) {
    let cut = caret - GLOSS_MAX_SEGMENT;
    for (let i = cut; i < caret - 1; i++) {
      if (CLAUSE_BREAK.has(chars[i])) {
        cut = i + 1;
        break;
      }
    }
    start = cut;
    while (start < caret && isChinesePunct(chars[start])) start++;
  }
  const seg = chars.slice(start, caret);
  if (!seg.some(isHanChar)) return { ok: false, reason: 'no_chinese' };
  return { ok: true, segment: seg.join(''), start, end: caret };
}

export interface Gloss {
  pinyin: string;
  english: string;
}

/** One line, single spaces: a suggestion must never put a line break into the board. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** What Tab inserts after the Chinese: " - nǐ hǎo - hello" — always exactly one line. */
export function formatGloss(g: Gloss): string {
  return `${GLOSS_SEPARATOR}${oneLine(g.pinyin)}${GLOSS_SEPARATOR}${oneLine(g.english)}`;
}

/** The chip on a touch screen: "⇥ nǐ hǎo - hello". */
export function glossChipLabel(g: Gloss): string {
  return `⇥ ${oneLine(g.pinyin)}${GLOSS_SEPARATOR}${oneLine(g.english)}`;
}

/** The cache key of a segment (client LRU and the worker's cache). */
export function glossCacheKey(segment: string): string {
  return segment.normalize('NFC').trim();
}

/**
 * Claude's reply → a gloss we can put on the board, or null. Pinyin: tone
 * marks (digits converted), one line, no characters; English: one line, no
 * trailing full stop, at most GLOSS_MAX_ENGLISH_WORDS words; neither may
 * contain the " - " separator (it would break the line's shape).
 */
export function cleanGloss(input: unknown): Gloss | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (typeof o.pinyin !== 'string' || typeof o.english !== 'string') return null;
  // \s covers \n, \r, \u2028/\u2029: whatever the model sends, the result is one line.
  const flat = (s: string) => oneLine(s).replace(/ [-–—] /g, ', ').replace(/^[-–—]+\s*|\s*[-–—]+$/g, '').trim();
  const pinyin = flat(normalizePinyin(o.pinyin));
  if (!pinyin || pinyin.length > GLOSS_MAX_PINYIN_CHARS || Array.from(pinyin).some(isHanChar)) return null;
  let english = flat(o.english).replace(/^["'“‘]+|["'”’]+$/g, '').replace(/[.。]+$/, '').trim();
  const words = english.split(' ');
  if (words.length > GLOSS_MAX_ENGLISH_WORDS) english = words.slice(0, GLOSS_MAX_ENGLISH_WORDS).join(' ').replace(/[,;:]+$/, '');
  if (!english || Array.from(english).some(isHanChar)) return null;
  return { pinyin, english };
}
