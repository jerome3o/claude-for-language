/**
 * ONE live count of today's queue for every view that shows it (Home, the tab bar's due count,
 * the Decks list, Up next) — and it outlives the page that asked for it.
 *
 * Each view used to run its own `useLiveQuery(getRawQueueCounts)`, which starts from nothing on
 * every mount: back on Home after a study session the count took a moment on a phone (every
 * card, the budget, "Order new cards by"), and Home painted the numbers it had shown BEFORE the
 * session meanwhile (Jerome, Nov 2026). Now the last result stays in memory with when it was
 * worked out (`at` = when the computation read the data, `day` = that study day), so a view
 * mounting paints it at once; every new view still asks for a fresh count (a setting may have
 * changed without a database write), which replaces it when done. The subscription lingers
 * {@link KEEP_ALIVE_MS} after the last view leaves, so going from one page to the next never
 * restarts it from scratch. Home picks between this and the study session's own numbers with
 * shared/study/homeCounts.ts (newest wins).
 */
import { liveQuery, type Subscription } from 'dexie';
import { getRawQueueCounts, type RawQueueCounts } from '../db/database';
import { studyToday } from './studyDay';

export interface RawCountsSnapshot {
  raw: RawQueueCounts;
  /** When the computation read the data (epoch ms). */
  at: number;
  /** The study day it was worked out for. */
  day: string;
}

/** How long the live count keeps running after the last view using it has gone. */
export const KEEP_ALIVE_MS = 60_000;

let current: RawCountsSnapshot | null = null;
let subscription: Subscription | null = null;
let subscribers = 0;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let restartQueued = false;
/** Counts being worked out right now (each started after every write before it). */
let running = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of [...listeners]) fn();
}

function start() {
  subscription?.unsubscribe();
  subscription = liveQuery(async () => {
    const at = Date.now();
    running++;
    try {
      const raw = await getRawQueueCounts();
      return { raw, at, day: studyToday(at) } satisfies RawCountsSnapshot;
    } finally {
      running--;
    }
  }).subscribe({
    next: (value) => {
      // A recount that read the data earlier than the one shown never replaces it.
      if (current && value.at < current.at) return;
      current = value;
      emit();
    },
    error: (err) => console.error('[queueCounts] count failed', err),
  });
}

/**
 * Work the counts out again now (the last result stays on screen meanwhile). Several calls in
 * the same tick make one recount, and a count already under way is left to finish (any write
 * since it started restarts it by itself): views mounting one after another never keep
 * cancelling it.
 */
export function refreshQueueCounts(): void {
  if (restartQueued) return;
  restartQueued = true;
  queueMicrotask(() => {
    restartQueued = false;
    if (subscription && running > 0) return;
    if (subscribers > 0 || subscription) start();
  });
}

/** A view starts showing the counts: it gets the last result at once and a fresh count follows. */
export function subscribeQueueCounts(listener: () => void): () => void {
  listeners.add(listener);
  subscribers++;
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  refreshQueueCounts();
  return () => {
    listeners.delete(listener);
    subscribers--;
    if (subscribers > 0) return;
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      stopTimer = null;
      if (subscribers > 0) return;
      subscription?.unsubscribe();
      subscription = null;
    }, KEEP_ALIVE_MS);
  };
}

/** The last count worked out (null before the first one this page load). */
export function queueCountsSnapshot(): RawCountsSnapshot | null {
  return current;
}

/** Tests: forget everything. */
export function resetQueueCountsForTests(): void {
  subscription?.unsubscribe();
  subscription = null;
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  subscribers = 0;
  current = null;
  restartQueued = false;
  running = 0;
  listeners.clear();
}
