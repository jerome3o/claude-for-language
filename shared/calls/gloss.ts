/**
 * Tab-complete on the call's text board: after someone types Chinese and
 * pauses, a grey suggestion ` - pīnyīn - meaning` appears right after the
 * caret; Tab (or the chip on a phone) types it in like any other edit.
 * After ENGLISH (a word or short phrase) it goes the other way:
 * ` - 中文 - pīnyīn` (direction 'en'). On a mixed line the run that ends at
 * the caret decides: Han → pinyin + meaning, Latin letters → Chinese + pinyin.
 *
 * This module is the pure part — WHEN to suggest and WHAT the inserted text
 * looks like. The web board (components/calls/TextBoard.tsx) and the Lab app
 * (core CallGloss.kt, parity-tested against this file) both call it; the
 * worker (POST /api/calls/:id/gloss) cleans Claude's reply with cleanGloss /
 * cleanChineseGloss.
 *
 * Indexes are CHARACTERS (code points), like the text board's CRDT.
 */

import { normalizePinyin } from '../import/pinyin';

/** Typing must have stopped this long (and no IME composition open) before we ask. */
export const GLOSS_DEBOUNCE_MS = 500;
/** The phrase glossed is the trailing Chinese run, at most this many characters. */
export const GLOSS_MAX_SEGMENT = 40;
/** Between the typed text and the two parts of the gloss. */
export const GLOSS_SEPARATOR = ' - ';
/**
 * The English is cut to this many words — a safety net only: a sentence (up to
 * GLOSS_MAX_SEGMENT characters) gets its whole translation. It used to be 8,
 * which cut Minghui's sentence translations off mid-sentence (2 Oct 2026).
 */
export const GLOSS_MAX_ENGLISH_WORDS = 30;
export const GLOSS_MAX_PINYIN_CHARS = 240;

/** 'zh' = Chinese typed → pinyin + English; 'en' = English typed → Chinese + pinyin. */
export type GlossDirection = 'zh' | 'en';

/** An English run is at most this many words… */
export const GLOSS_MAX_EN_WORDS = 8;
/** …and this many characters ("a word or short phrase", not a paragraph)… */
export const GLOSS_MAX_EN_CHARS = 60;
/** …and has at least this many Latin letters: "a" / "I" / "3" alone are never glossed, "OK" / "TV" are. */
export const GLOSS_MIN_EN_LETTERS = 2;
/**
 * Bumped when the server's gloss rules change (model, prompt, pinyin checks).
 * It is part of every cache key (glossStoreKey), so an old — possibly wrong —
 * gloss is never served again. 2 = the better model + the dictionary pinyin
 * check + English → Chinese (Oct 2026).
 */
export const GLOSS_CACHE_VERSION = 2;

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

/** ASCII letters only: pinyin with tone marks (nǐ hǎo) is never taken for English. */
export function isLatinLetter(ch: string): boolean {
  return /^[A-Za-z]$/.test(ch);
}

const isAsciiAlnum = (ch: string) => /^[A-Za-z0-9]$/.test(ch);

/** What an English run may contain: letters, digits, spaces, apostrophes, hyphens (ice-cream, don't, COVID-19). */
function isEnglishRunChar(ch: string): boolean {
  return /^[A-Za-z0-9 \t'’-]$/.test(ch);
}

const DASHES = new Set(['-', '–', '—']);

/** A Latin-script letter outside ASCII (ǎ, é, ü) or a combining mark (a decomposed tone mark). */
function isAccentedLetterOrMark(ch: string): boolean {
  return /^(\p{Script=Latin}|\p{M})$/u.test(ch);
}

export type GlossSkip =
  /** An IME (pinyin) composition is open. */
  | 'composing'
  /** Text is selected (not a plain caret). */
  | 'selection'
  /** Nothing to gloss just before the caret (a space, punctuation, pinyin with tone marks, nothing). */
  | 'no_text'
  /** An English run with fewer than GLOSS_MIN_EN_LETTERS letters ("a", "I", "3"). */
  | 'too_short'
  /** An English run over GLOSS_MAX_EN_WORDS words or GLOSS_MAX_EN_CHARS characters. */
  | 'too_long'
  /** The line already has ` - …` after the text, or the English is the tail of a gloss. */
  | 'already_glossed'
  /** More text follows on the line — the ghost would sit on top of it. */
  | 'not_at_line_end';

export type GlossCheck =
  | { ok: true; segment: string; start: number; end: number; direction: GlossDirection }
  | { ok: false; reason: GlossSkip };

/**
 * Should the board suggest a gloss at this caret? `start`/`end` are the
 * selection in characters (equal for a caret).
 *
 * After Chinese (direction 'zh'): the segment is the run of Chinese characters
 * (Chinese punctuation allowed) that ends at the caret on the current line,
 * without leading punctuation, cut to its last GLOSS_MAX_SEGMENT characters (at
 * a clause break when there is one).
 *
 * After an ASCII letter or digit (direction 'en'): the run of letters, digits,
 * spaces, apostrophes and hyphens that ends at the caret — it stops at a line
 * break, any other punctuation (. , ! ? ; : …), Chinese and accented letters
 * (so pinyin like "nǐ hǎo" is never English) — without leading spaces. Skipped
 * when it has fewer than GLOSS_MIN_EN_LETTERS letters, more than
 * GLOSS_MAX_EN_WORDS words or GLOSS_MAX_EN_CHARS characters, or is the tail of
 * a gloss (a dash after a space in it, or a dash just before it:
 * "你好 - nǐ hǎo - hello", "的 - de").
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

  if (caret > 0 && isAsciiAlnum(chars[caret - 1])) return findEnglishRun(chars, caret);

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
  if (!seg.some(isHanChar)) return { ok: false, reason: 'no_text' };
  return { ok: true, segment: seg.join(''), start, end: caret, direction: 'zh' };
}

/** The English run ending at `caret` (the character before it is an ASCII letter or digit). */
function findEnglishRun(chars: string[], caret: number): GlossCheck {
  let start = caret;
  while (start > 0 && isEnglishRunChar(chars[start - 1])) start--;
  // The tail of a gloss: a dash at the run's start or after a space inside it…
  for (let i = start; i < caret; i++) {
    if (DASHES.has(chars[i]) && (i === start || chars[i - 1] === ' ' || chars[i - 1] === '\t')) return { ok: false, reason: 'already_glossed' };
  }
  // …or a dash (– —) just before it, spaces aside.
  let b = start;
  while (b > 0 && (chars[b - 1] === ' ' || chars[b - 1] === '\t' || chars[b - 1] === '　')) b--;
  if (b > 0 && DASHES.has(chars[b - 1])) return { ok: false, reason: 'already_glossed' };
  // Inside a word with accents — pinyin (xiǎng → "ng", nǐ hǎo → "o") or French — never English.
  if (start > 0 && isAccentedLetterOrMark(chars[start - 1])) return { ok: false, reason: 'no_text' };
  // No leading spaces / apostrophes / hyphens.
  while (start < caret && !isAsciiAlnum(chars[start])) start++;
  const seg = chars.slice(start, caret);
  if (seg.filter(isLatinLetter).length < GLOSS_MIN_EN_LETTERS) return { ok: false, reason: 'too_short' };
  const text = seg.join('');
  if (seg.length > GLOSS_MAX_EN_CHARS || text.split(/[ \t]+/).length > GLOSS_MAX_EN_WORDS) return { ok: false, reason: 'too_long' };
  return { ok: true, segment: text, start, end: caret, direction: 'en' };
}

/** The direction of a text sent without one: any Chinese character → 'zh', else 'en'. */
export function glossDirectionOf(text: string): GlossDirection {
  return Array.from(text).some(isHanChar) ? 'zh' : 'en';
}

/** Chinese typed → its pinyin and meaning (direction 'zh'). */
export interface Gloss {
  pinyin: string;
  english: string;
}

/** English typed → the Chinese for it and that Chinese's pinyin (direction 'en'). */
export interface ChineseGloss {
  chinese: string;
  pinyin: string;
}

export type AnyGloss = Gloss | ChineseGloss;

export function isChineseGloss(g: AnyGloss): g is ChineseGloss {
  return typeof (g as ChineseGloss).chinese === 'string';
}

/** One line, single spaces: a suggestion must never put a line break into the board. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The parts after the typed text: [pinyin, english] after Chinese, [chinese, pinyin] after
 * English — an empty part left out (the device's own gloss may have pinyin and no meaning).
 */
function glossParts(g: AnyGloss): string[] {
  const parts = isChineseGloss(g) ? [oneLine(g.chinese), oneLine(g.pinyin)] : [oneLine(g.pinyin), oneLine(g.english)];
  return parts.filter((p) => p !== '');
}

/**
 * What Tab inserts after the typed text — always exactly one line:
 * " - nǐ hǎo - hello" after Chinese, " - 苹果 - píngguǒ" after English,
 * " - nǐ hǎo" for pinyin without a meaning.
 */
export function formatGloss(g: AnyGloss): string {
  return glossParts(g)
    .map((p) => `${GLOSS_SEPARATOR}${p}`)
    .join('');
}

/** The chip on a touch screen: "⇥ nǐ hǎo - hello" / "⇥ 苹果 - píngguǒ" / "⇥ nǐ hǎo". */
export function glossChipLabel(g: AnyGloss): string {
  return `⇥ ${glossParts(g).join(GLOSS_SEPARATOR)}`;
}

/** The text of a segment as sent to the server: trimmed NFC. */
export function glossCacheKey(segment: string): string {
  return segment.normalize('NFC').trim();
}

/** The key a gloss is cached under (client LRU and the worker's cache): rules version + direction + text. */
export function glossStoreKey(segment: string, direction: GlossDirection): string {
  return `v${GLOSS_CACHE_VERSION}:${direction}:${glossCacheKey(segment)}`;
}

/** Pinyin from Claude → one line of tone-marked pinyin without separators, or '' when unusable. */
function cleanPinyin(raw: string): string {
  const flat = oneLine(normalizePinyin(raw)).replace(/ [-–—] /g, ', ').replace(/^[-–—]+\s*|\s*[-–—]+$/g, '').trim();
  if (!flat || flat.length > GLOSS_MAX_PINYIN_CHARS || Array.from(flat).some(isHanChar)) return '';
  return flat;
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
  // \s covers \n, \r and the Unicode line separators: whatever the model sends, the result is one line.
  const flat = (s: string) => oneLine(s).replace(/ [-–—] /g, ', ').replace(/^[-–—]+\s*|\s*[-–—]+$/g, '').trim();
  const pinyin = cleanPinyin(o.pinyin);
  if (!pinyin) return null;
  let english = flat(o.english).replace(/^["'“‘]+|["'”’]+$/g, '').replace(/[.。]+$/, '').trim();
  const words = english.split(' ');
  if (words.length > GLOSS_MAX_ENGLISH_WORDS) english = words.slice(0, GLOSS_MAX_ENGLISH_WORDS).join(' ').replace(/[,;:]+$/, '');
  if (!english || Array.from(english).some(isHanChar)) return null;
  return { pinyin, english };
}

/** The longest Chinese an English gloss may give (a short phrase's translation). */
export const GLOSS_MAX_CHINESE = GLOSS_MAX_SEGMENT + 10;

/**
 * Claude's reply for English → { chinese, pinyin }, or null. Chinese: one line
 * of simplified characters (Chinese punctuation and digits allowed; no Latin
 * letters, spaces, dashes or trailing 。), at most GLOSS_MAX_CHINESE
 * characters; pinyin cleaned as in cleanGloss.
 */
export function cleanChineseGloss(input: unknown): ChineseGloss | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (typeof o.chinese !== 'string' || typeof o.pinyin !== 'string') return null;
  const chinese = o.chinese
    .normalize('NFC')
    .replace(/\s+/g, '')
    .replace(/^["'“‘「]+|["'”’」]+$/g, '')
    .replace(/[。.]+$/, '');
  const cc = Array.from(chinese);
  if (!cc.some(isHanChar) || cc.length > GLOSS_MAX_CHINESE) return null;
  if (!cc.every((ch) => (isHanChar(ch) || isChinesePunct(ch) || /^[0-9]$/.test(ch)) && !DASHES.has(ch))) return null;
  const pinyin = cleanPinyin(o.pinyin);
  if (!pinyin) return null;
  return { chinese, pinyin };
}

// ---------- reliability: the device's own gloss, and how long to wait after a failure

/**
 * A pinyin-only suggestion from the device waits this long for the server's gloss (which has
 * the meaning) before it is shown; one with a dictionary meaning shows at once. Either is
 * replaced as soon as the server's arrives (Oct 2026: a slow or failed model call used to
 * mean no suggestion at all).
 */
export const GLOSS_LOCAL_AFTER_MS = 900;
/** After a 502 / 503 / 5xx or a network failure: the next new lookup waits this long. */
export const GLOSS_RETRY_AFTER_FAILURE_MS = 3_000;
/** After a 429 without a usable Retry-After. */
export const GLOSS_RATE_LIMIT_WAIT_MS = 10_000;
/** A Retry-After is honoured up to this long (never "a minute of silence" again). */
export const GLOSS_MAX_WAIT_MS = 30_000;
/** The words of the device's meaning, at most. */
export const GLOSS_LOCAL_MAX_WORDS = 8;

/**
 * How long the board stays quiet (no new lookups; cached and device glosses still show) after
 * a failed one. `status` = the HTTP status, null for a network failure / timeout; 4xx other
 * than 429 concern that text only → 0. It used to be 60 s after any 429 / 502 / 503, so one
 * blip — or a tutor typing a lot — switched the feature off for a minute at a time.
 */
export function glossBackoffMs(status: number | null, retryAfterSeconds?: number | null): number {
  if (status === 429) {
    if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.min(GLOSS_MAX_WAIT_MS, Math.max(1_000, Math.round(retryAfterSeconds * 1000)));
    }
    return GLOSS_RATE_LIMIT_WAIT_MS;
  }
  if (status === null || status >= 500) return GLOSS_RETRY_AFTER_FAILURE_MS;
  return 0;
}

/** A word of the typed segment as the device's segmenter cut it (shared/chinese/segment.ts). */
export interface GlossWord {
  text: string;
  pinyin: string;
}

/** Chinese punctuation → what the pinyin line shows for it (nothing for the rest). */
const PINYIN_PUNCT: Record<string, string> = { '，': ',', '、': ',', '？': '?', '！': '!', '；': ';', '：': ':' };

/**
 * The device's pinyin for a segment from its words: one word = its syllables joined
 * (yínháng), words spaced, ，→ , ？→ ? ！→ ! after the word before, the rest of the
 * punctuation left out. '' when a Chinese word has no pinyin.
 */
export function localGlossPinyin(words: readonly GlossWord[]): string {
  const out: string[] = [];
  for (const w of words) {
    const chars = Array.from(w.text);
    if (chars.some(isHanChar)) {
      const p = oneLine(w.pinyin).replace(/ /g, '');
      if (!p) return '';
      out.push(p);
    } else if (out.length > 0) {
      const mark = chars.map((ch) => PINYIN_PUNCT[ch] ?? '').join('');
      if (mark) out[out.length - 1] += mark;
    }
  }
  return out.join(' ');
}

/**
 * The one word to look up in the device's dictionary for a segment: its only Chinese word
 * ("你好！" → 你好), or null for a phrase of several words (the server's translation is needed).
 */
export function glossLookupWord(words: readonly GlossWord[] | null): string | null {
  if (!words) return null;
  const han = words.filter((w) => Array.from(w.text).some(isHanChar));
  return han.length === 1 ? han[0].text : null;
}

/**
 * A dictionary gloss → one short meaning: its first sense ("to like; to be fond of" →
 * "to like"), one line, no " - ", no trailing ellipsis / full stop, at most
 * GLOSS_LOCAL_MAX_WORDS words, '' when it holds Chinese.
 */
export function shortDictMeaning(raw: string): string {
  let s = oneLine(raw.split(';')[0] ?? '')
    .replace(/ [-–—] /g, ', ')
    .replace(/[….。]+$/, '')
    .trim();
  const words = s.split(' ').filter(Boolean);
  if (words.length > GLOSS_LOCAL_MAX_WORDS) s = words.slice(0, GLOSS_LOCAL_MAX_WORDS).join(' ').replace(/[,;:]+$/, '');
  if (!s || Array.from(s).some(isHanChar)) return '';
  return s;
}

/**
 * The device's own gloss for a Chinese segment — shown while the server's contextual one is
 * on its way, or when it can't come (offline, slow, failed). `words` = the segment as the
 * device's segmenter cut it (with the app's auto-pinyin + the 一 / 不 tone changes);
 * `dict` = the dictionary entry of its only word (glossLookupWord), when the device has one:
 * its pinyin (a word's, words joined) replaces the segmenter's, its meaning is shortened.
 * null when there is no pinyin.
 */
export function localGloss(words: readonly GlossWord[] | null, dict?: { pinyin?: string | null; english?: string | null } | null): Gloss | null {
  if (!words || words.length === 0) return null;
  const dictPinyin = dict?.pinyin ? oneLine(dict.pinyin) : '';
  const pinyin = dictPinyin && !Array.from(dictPinyin).some(isHanChar) ? withTrailingMarks(dictPinyin, words) : localGlossPinyin(words);
  if (!pinyin || pinyin.length > GLOSS_MAX_PINYIN_CHARS) return null;
  return { pinyin, english: shortDictMeaning(dict?.english ?? '') };
}

/** A word's dictionary pinyin with the segment's trailing punctuation ("你好！" → "nǐhǎo!"). */
function withTrailingMarks(pinyin: string, words: readonly GlossWord[]): string {
  let tail = '';
  for (let i = words.length - 1; i >= 0; i--) {
    const chars = Array.from(words[i].text);
    if (chars.some(isHanChar)) break;
    tail = chars.map((ch) => PINYIN_PUNCT[ch] ?? '').join('') + tail;
  }
  return pinyin + tail;
}

/** What became of one lookup — the `outcome` of the `call.board_gloss_lookup` analytics event. */
export type GlossOutcome =
  /** The server answered (a model call or its cache). */
  | 'server'
  /** This device had it already (no request). */
  | 'cached'
  /** 429: asked too often. */
  | 'rate_limited'
  /** 503: no key / the model busy or down. */
  | 'unavailable'
  /** 502 / another HTTP error / an unusable reply. */
  | 'failed'
  /** No connection, or the request never came back. */
  | 'offline'
  /** Not asked: waiting after an earlier failure. */
  | 'backoff'
  /** The text changed before the answer came (the request still finishes and is cached). */
  | 'superseded';

/** The HTTP status of a failed lookup → its outcome. */
export function glossOutcomeForStatus(status: number | null): GlossOutcome {
  if (status === null) return 'offline';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  return 'failed';
}
