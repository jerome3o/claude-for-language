/**
 * The study session's own numbers, published as they change, so Home can paint them the moment
 * Study is left — 0 after "All done" — instead of the counts it had worked out before the session
 * (shared/study/homeCounts.ts; docs/STUDY_SESSION.md "Back on Home"). In memory, plus a
 * localStorage copy for a reload / an app restart on the same study day.
 */
import { useSyncExternalStore } from 'react';
import type { SessionCounts } from '@shared/study';

const KEY = 'session-queue-counts-v1';
let memory: SessionCounts | null | undefined;
const listeners = new Set<() => void>();

function load(): SessionCounts | null {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as SessionCounts) : null;
    return parsed && typeof parsed.at === 'number' && typeof parsed.day === 'string' && parsed.remaining ? parsed : null;
  } catch {
    return null;
  }
}

export function readSessionCounts(): SessionCounts | null {
  if (memory === undefined) memory = load();
  return memory;
}

/** The session's numbers changed (a rating, a card added / taken out, the queue loaded). */
export function publishSessionCounts(counts: SessionCounts): void {
  memory = counts;
  try {
    localStorage.setItem(KEY, JSON.stringify(counts));
  } catch {
    // storage full / private mode: memory is enough for this page load
  }
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSessionCounts(): SessionCounts | null {
  return useSyncExternalStore(subscribe, readSessionCounts, readSessionCounts);
}

/** Tests: forget everything. */
export function resetSessionCountsForTests(): void {
  memory = undefined;
  listeners.clear();
}
