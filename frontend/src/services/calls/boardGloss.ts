/**
 * The text board's tab-complete, client side: the per-user on/off setting, a small LRU of
 * glosses already fetched (a lesson repeats words, so a repeat is instant and free), the
 * server lookup and the device's own gloss. The rules — when, which text, what gets inserted,
 * how long to wait after a failure — are shared/calls/gloss.ts.
 *
 * Reliability (23 Oct 2026: it worked now and then for Jerome, not at all for Minghui):
 * - a request is never aborted by the board: the caller's signal only stops WAITING for it, so
 *   a reply that comes after the next keystroke still lands in the LRU, and the same text asked
 *   again joins the request already running (one per text);
 * - after a failure only new lookups wait, and for seconds (glossBackoffMs; a 429's Retry-After)
 *   — it used to be a minute of silence after any 429 / 502 / 503;
 * - the device's own gloss (localBoardGloss: the segmenter's pinyin + a dictionary meaning)
 *   shows while the server's is on its way, or when it can't come.
 */

import {
  cleanChineseGloss,
  cleanGloss,
  glossBackoffMs,
  glossCacheKey,
  glossLookupWord,
  glossOutcomeForStatus,
  glossStoreKey,
  isHanChar,
  localGloss,
  type AnyGloss,
  type Gloss,
  type GlossDirection,
  type GlossOutcome,
} from '@shared/calls';
import { glossBoardText } from '../../api/calls';
import { loadSegmenter, segmentNow } from '../chineseSegmenter';
import { lookupWord } from '../wordDict';
import { lookupChar } from '../charDict';
import { autoPinyin } from '../../utils/autoPinyin';

const LRU_SIZE = 300;
/** A request that never comes back is given up after this long (the server's own calls end sooner). */
const REQUEST_TIMEOUT_MS = 15_000;
/** The device's dictionary lookups (IndexedDB, else a static file) get this long. */
const LOCAL_LOOKUP_TIMEOUT_MS = 1_500;
const lru = new Map<string, AnyGloss>();

/** Keyed by rules version + direction + text (glossStoreKey): a gloss from older rules is never reused. */
export function cachedBoardGloss(segment: string, direction: GlossDirection = 'zh'): AnyGloss | null {
  const key = glossStoreKey(segment, direction);
  const hit = lru.get(key);
  if (!hit) return null;
  lru.delete(key);
  lru.set(key, hit);
  return hit;
}

export function rememberBoardGloss(segment: string, gloss: AnyGloss, direction: GlossDirection = 'zh'): void {
  const key = glossStoreKey(segment, direction);
  lru.set(key, gloss);
  while (lru.size > LRU_SIZE) lru.delete(lru.keys().next().value as string);
}

/** One lookup's answer: the gloss (null = none) and what happened, for the analytics event. */
export interface BoardGlossResult {
  gloss: AnyGloss | null;
  outcome: GlossOutcome;
  /** The HTTP status of a failed request (0 = none / a network failure). */
  status: number;
}

/** New lookups wait until then after a failure (cached and device glosses still show). */
let quietUntil = 0;
const inflight = new Map<string, Promise<BoardGlossResult>>();

function request(callId: string, segment: string, direction: GlossDirection): Promise<BoardGlossResult> {
  const key = glossStoreKey(segment, direction);
  const running = inflight.get(key);
  if (running) return running;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const p = glossBoardText(callId, glossCacheKey(segment), direction, timeout.signal)
    .then((res): BoardGlossResult => {
      // Cleaned again here: whatever arrives, the suggestion is one line.
      const gloss: AnyGloss | null = direction === 'en' ? cleanChineseGloss(res) : cleanGloss(res);
      if (gloss) rememberBoardGloss(segment, gloss, direction);
      return gloss ? { gloss, outcome: 'server', status: 0 } : { gloss: null, outcome: 'failed', status: 200 };
    })
    .catch((err): BoardGlossResult => {
      const e = err as { status?: number; retryAfter?: number } | null;
      const status = typeof e?.status === 'number' ? e.status : null;
      const wait = glossBackoffMs(status, e?.retryAfter ?? null);
      if (wait > 0) quietUntil = Math.max(quietUntil, Date.now() + wait);
      return { gloss: null, outcome: glossOutcomeForStatus(status), status: status ?? 0 };
    })
    .finally(() => {
      clearTimeout(timer);
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Resolves with the request's answer, or as 'superseded' as soon as `signal` aborts. */
function untilAborted(p: Promise<BoardGlossResult>, signal: AbortSignal): Promise<BoardGlossResult> {
  if (signal.aborted) return Promise.resolve({ gloss: null, outcome: 'superseded', status: 0 });
  return new Promise((resolve) => {
    const onAbort = () => resolve({ gloss: null, outcome: 'superseded', status: 0 });
    signal.addEventListener('abort', onAbort, { once: true });
    void p.then((r) => {
      signal.removeEventListener('abort', onAbort);
      resolve(r);
    });
  });
}

/**
 * The server's gloss for a segment: the LRU first, else the worker (one request per text,
 * never aborted — `signal` only stops waiting). 'zh' → { pinyin, english }; 'en' (English
 * typed) → { chinese, pinyin }. Never throws.
 */
export async function fetchBoardGloss(callId: string, segment: string, signal: AbortSignal, direction: GlossDirection = 'zh'): Promise<BoardGlossResult> {
  const hit = cachedBoardGloss(segment, direction);
  if (hit) return { gloss: hit, outcome: 'cached', status: 0 };
  const key = glossStoreKey(segment, direction);
  if (!inflight.has(key)) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { gloss: null, outcome: 'offline', status: 0 };
    if (Date.now() < quietUntil) return { gloss: null, outcome: 'backoff', status: 0 };
  }
  return untilAborted(request(callId, segment, direction), signal);
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/** The dictionary's pinyin + meaning of the segment's only word (a character: the reading the device's pinyin picked). */
async function dictEntry(word: string): Promise<{ pinyin?: string; english: string } | null> {
  const chars = Array.from(word);
  if (chars.length === 1) {
    const r = await lookupChar(word);
    if (r.status !== 'ok') return null;
    const p = autoPinyin(word).trim();
    const reading = r.record.readings.find((x) => x.pinyin === p) ?? r.record.readings[0];
    return { english: reading?.english || r.record.meaning };
  }
  const r = await lookupWord(word);
  return r.status === 'ok' ? { pinyin: r.record.pinyin, english: r.record.english } : null;
}

/**
 * The device's own gloss for Chinese: the segmenter's pinyin (pinyin-pro + 一 / 不) and, when the
 * segment is one word the dictionary knows (on the device, else its static file), its pinyin and
 * first meaning. null when the word lists can't load. Works offline for words seen before.
 */
export async function localBoardGloss(segment: string): Promise<Gloss | null> {
  if (!Array.from(segment).some(isHanChar)) return null;
  const dict = await withTimeout(loadSegmenter(), LOCAL_LOOKUP_TIMEOUT_MS, null);
  if (!dict) return null;
  const words = segmentNow(glossCacheKey(segment));
  if (!words) return null;
  const word = glossLookupWord(words);
  const entry = word ? await withTimeout(dictEntry(word), LOCAL_LOOKUP_TIMEOUT_MS, null) : null;
  return localGloss(words, entry);
}

const settingKey = (userId: string) => `call-board-gloss:${userId}`;

/** On by default; remembered per user on this device. */
export function boardGlossEnabled(userId: string): boolean {
  try {
    return localStorage.getItem(settingKey(userId)) !== 'off';
  } catch {
    return true;
  }
}

export function setBoardGlossEnabled(userId: string, on: boolean): void {
  try {
    localStorage.setItem(settingKey(userId), on ? 'on' : 'off');
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

/** Test seam. */
export function resetBoardGlossCache(): void {
  lru.clear();
  inflight.clear();
  quietUntil = 0;
}
