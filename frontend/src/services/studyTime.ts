/**
 * Active study time on this device (docs/STUDY_SESSION.md "Time"): the rules are the pure
 * `shared/study/activeTime.ts`; this file keeps the state in localStorage, feeds it from the
 * study screen (useActiveStudyTime) and reports it to `PUT /api/me/study-time` during sync.
 * Everything is best-effort: storage can be missing (private window) and the report can fail
 * — the in-memory state still counts the time while the page is open.
 */

import {
  ACTIVE_KEEP_DAYS,
  activeInteract,
  activePause,
  activeTotal,
  dayTotalAcrossDevices,
  emptyActiveTime,
  pruneActiveTime,
  type ActiveTimeState,
} from '@shared/study';
import { getLocalDateString, putStudyTime, type StudyTimeDayTotal } from '../api/client';

const STATE_KEY = 'study-active-time-v1';
const SERVER_KEY = 'study-active-time-server-v1';
const DEVICE_KEY = 'study-device-id';
/** Writes to localStorage at most this often while interactions stream in. */
const SAVE_EVERY_MS = 5_000;
const REPORT_EVERY_MS = 10 * 60 * 1000;

let state: ActiveTimeState | null = null;
let lastSavedAt = 0;
let lastReportedAt = 0;
const listeners = new Set<() => void>();

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the in-memory state still counts
  }
}

function current(): ActiveTimeState {
  if (!state) {
    const saved = read<ActiveTimeState>(STATE_KEY);
    state = saved && typeof saved === 'object' && saved.totals ? saved : emptyActiveTime();
  }
  return state;
}

function firstKeptDay(): string {
  const d = new Date();
  d.setDate(d.getDate() - ACTIVE_KEEP_DAYS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function update(next: ActiveTimeState, force: boolean): void {
  state = next;
  const now = Date.now();
  if (force || now - lastSavedAt >= SAVE_EVERY_MS) {
    lastSavedAt = now;
    write(STATE_KEY, pruneActiveTime(next, firstKeptDay()));
  }
  listeners.forEach((l) => l());
}

/** This device's id for the per-device rows (random, kept in localStorage). */
export function studyDeviceId(): string {
  const saved = read<string>(DEVICE_KEY);
  if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  const id = `web-${(crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
  write(DEVICE_KEY, id);
  return id;
}

/** A tap / key / scroll on the study screen, or the screen coming back to the front. */
export function noteStudyInteraction(now = Date.now()): void {
  update(activeInteract(current(), now, getLocalDateString()), false);
}

/** Backgrounded, screen off, or left Study: stop the clock now. */
export function pauseStudyTime(now = Date.now()): void {
  const s = current();
  if (!s.last) return;
  update(activePause(s, now), true);
}

/** This device's active ms today (live). */
export function deviceActiveMsToday(now = Date.now()): number {
  return activeTotal(current(), getLocalDateString(), now);
}

/** Today's active ms over every device: the server's other devices + this device's own. */
export function activeMsToday(now = Date.now()): number {
  const day = getLocalDateString();
  const server = (read<StudyTimeDayTotal[]>(SERVER_KEY) ?? []).find((d) => d.date === day);
  return dayTotalAcrossDevices(activeTotal(current(), day, now), server?.active_ms ?? 0, server?.device_ms ?? 0);
}

export function subscribeStudyTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Sends this device's per-day totals (last ACTIVE_KEEP_DAYS days) and caches the server's
 * totals for "Today: N min". Called from sync (throttled) and when leaving Study (forced).
 */
export async function reportStudyTimeIfDue(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastReportedAt < REPORT_EVERY_MS) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const s = current();
  const today = getLocalDateString();
  const days = Object.entries(s.totals)
    .filter(([date]) => date >= firstKeptDay())
    .map(([date]) => ({ date, active_ms: Math.round(activeTotal(s, date, now)) }));
  if (s.last && !(today in s.totals)) days.push({ date: today, active_ms: Math.round(activeTotal(s, today, now)) });
  lastReportedAt = now;
  try {
    const totals = await putStudyTime(studyDeviceId(), days.filter((d) => d.active_ms > 0));
    write(SERVER_KEY, totals);
    listeners.forEach((l) => l());
  } catch (err) {
    lastReportedAt = 0;
    console.warn('[StudyTime] report failed:', err instanceof Error ? err.message : err);
  }
}

/** Test hook: forget the in-memory state and throttles. */
export function _resetStudyTime(): void {
  state = null;
  lastSavedAt = 0;
  lastReportedAt = 0;
}
