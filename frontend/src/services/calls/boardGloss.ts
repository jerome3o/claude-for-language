/**
 * The text board's tab-complete, client side: the per-user on/off setting, a
 * small LRU of glosses already fetched (a lesson repeats words, so a repeat is
 * instant and free), and the fetch itself (the board aborts it on new input).
 * The rules — when, which text, what gets inserted — are shared/calls/gloss.ts.
 */

import { cleanGloss, glossCacheKey, type Gloss } from '@shared/calls';
import { glossBoardText } from '../../api/calls';

const LRU_SIZE = 300;
const lru = new Map<string, Gloss>();

export function cachedBoardGloss(segment: string): Gloss | null {
  const key = glossCacheKey(segment);
  const hit = lru.get(key);
  if (!hit) return null;
  lru.delete(key);
  lru.set(key, hit);
  return hit;
}

export function rememberBoardGloss(segment: string, gloss: Gloss): void {
  const key = glossCacheKey(segment);
  lru.set(key, gloss);
  while (lru.size > LRU_SIZE) lru.delete(lru.keys().next().value as string);
}

/** After a 503 / 502 / 429 (no key, Claude down, too many) stay quiet for a minute. */
let quietUntil = 0;

/**
 * The gloss for a segment: cache first, else the worker. null when offline,
 * paused, aborted or failed — the board then simply shows nothing.
 */
export async function fetchBoardGloss(callId: string, segment: string, signal: AbortSignal): Promise<Gloss | null> {
  const hit = cachedBoardGloss(segment);
  if (hit) return hit;
  if (Date.now() < quietUntil || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  try {
    const res = await glossBoardText(callId, glossCacheKey(segment), signal);
    // Cleaned again here: whatever arrives, the suggestion is one line.
    const gloss = cleanGloss(res);
    if (gloss) rememberBoardGloss(segment, gloss);
    return gloss;
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 503 || status === 502 || status === 429) quietUntil = Date.now() + 60_000;
    return null;
  }
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
  quietUntil = 0;
}
