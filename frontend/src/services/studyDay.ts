/**
 * "New day starts at" on this device: the account's rollover hour (`users.day_rollover_hour`,
 * NULL = 4 am; `/api/auth/me` and `/api/sync/changes` carry it as `day_rollover_hour`,
 * `PUT /api/profile/day-rollover` changes it), mirrored to localStorage so the study day is
 * right offline — and the ONE place the web app asks "which study day is it?" (the rule:
 * shared/study/studyDay.ts). Every "today" of study — the queue's cutoff, introduced-today
 * and the budget, Study more, the review load, the daily reader, the celebration, active time,
 * the resume point, homework's `today`, Home's counts, the streak — reads it from here.
 * docs/STUDY_SESSION.md "When does a new day start".
 */
import {
  DEFAULT_DAY_ROLLOVER_HOUR,
  dayRolloverHour,
  isDayRolloverHour,
  studyCutoffMs,
  studyDayAt,
  type StudyDay,
} from '@shared/study/studyDay';

const KEY = 'day-rollover-hour-v1';
/** Fired on window when the cached hour changed (Home / Study recount). */
export const DAY_ROLLOVER_CHANGED = 'day-rollover-changed';

let cached: number | null = null;

/** The rollover hour in effect on this device (0–6; default 4 until the server says). */
export function readDayRolloverHour(): number {
  if (cached !== null) return cached;
  let hour = DEFAULT_DAY_ROLLOVER_HOUR;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) hour = dayRolloverHour(Number(raw));
  } catch { /* storage unavailable */ }
  cached = hour;
  return hour;
}

/**
 * Store the server's value: a number, null (= the default), or a user / sync payload carrying
 * `day_rollover_hour`. A payload without the field leaves the cache alone (an older server).
 */
export function writeDayRolloverHour(src: number | null | { day_rollover_hour?: number | null } | undefined): void {
  let value: number | null | undefined;
  if (src === null || typeof src === 'number') value = src;
  else if (src && typeof src === 'object' && 'day_rollover_hour' in src) value = src.day_rollover_hour ?? null;
  else return;
  const hour = isDayRolloverHour(value) ? value : DEFAULT_DAY_ROLLOVER_HOUR;
  const before = readDayRolloverHour();
  cached = hour;
  try { localStorage.setItem(KEY, String(hour)); } catch { /* storage unavailable */ }
  if (before !== hour && typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(DAY_ROLLOVER_CHANGED, { detail: hour })); } catch { /* no window events */ }
  }
}

/** Tests: forget the in-memory copy. */
export function resetDayRolloverCacheForTests(): void {
  cached = null;
}

/** The study day `now` belongs to, in the device's time zone. */
export function studyDayNow(now: number = Date.now()): StudyDay {
  return studyDayAt(now, readDayRolloverHour());
}

/** Today's study-day key, YYYY-MM-DD (the "today" every day-keyed rule and param uses). */
export function studyToday(now: number | Date = Date.now()): string {
  return studyDayNow(typeof now === 'number' ? now : now.getTime()).key;
}

/** When today's study day started (epoch ms): introduced-today, today's reviews. */
export function studyDayStartMs(now: number = Date.now()): number {
  return studyDayNow(now).startMs;
}

/** "Due today": the end of the study day, or an hour from now if later. */
export function studyCutoffNow(now: number = Date.now()): number {
  return studyCutoffMs(now, studyDayNow(now));
}

/** Whether instant `ms` (or an ISO string) is in today's study day. */
export function isInStudyToday(at: number | string | null | undefined, now: number = Date.now()): boolean {
  if (at === null || at === undefined) return false;
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return false;
  const day = studyDayNow(now);
  return ms >= day.startMs && ms < day.endMs;
}

/** The study-day key `days` days before today (0 = today). */
export function studyDayKeyDaysAgo(days: number, now: number = Date.now()): string {
  const today = studyToday(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
