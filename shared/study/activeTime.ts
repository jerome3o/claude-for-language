/**
 * Active study time — "how long was I actually studying today", with no sessions.
 *
 * Time accrues while the study screen is in front and the learner is interacting: every
 * interaction (a tap, a key, a scroll, coming back to the screen) credits the time since the
 * previous one, but never more than ACTIVE_IDLE_MS of it — so walking away pauses the clock
 * after ~75 s, and nothing accrues once the screen is backgrounded, the phone is locked or
 * the learner leaves Study ([activePause]). Totals are kept per LOCAL date on each device
 * (web: localStorage, Lab app: SharedPreferences) and each device reports its own per-day
 * total to `PUT /api/me/study-time`; a day's total is the sum over devices.
 *
 * Pure, integer-only (ms), so the Lab app's port (core/ActiveTime.kt) is parity-tested
 * against it (android-lab/parity/fixtures/study.ts). docs/STUDY_SESSION.md.
 */

/** An interaction credits at most this much time after it (the idle cut-off). */
export const ACTIVE_IDLE_MS = 75_000;

/** Days of per-day totals a device keeps locally (the server keeps them all). */
export const ACTIVE_KEEP_DAYS = 14;

export interface ActiveTimeState {
  /** Local date (YYYY-MM-DD) → active ms on this device. */
  totals: Record<string, number>;
  /**
   * The last interaction while studying, whose time is not credited yet, and the local date
   * it happened on (the interval after it is credited to that date). null = paused.
   */
  last: { at: number; day: string } | null;
}

export function emptyActiveTime(): ActiveTimeState {
  return { totals: {}, last: null };
}

/** The time the pending interval is worth at [now]: 0…ACTIVE_IDLE_MS (0 if the clock went back). */
export function pendingActiveMs(state: ActiveTimeState, now: number): number {
  if (!state.last) return 0;
  const gap = now - state.last.at;
  if (!(gap > 0)) return 0;
  return Math.min(gap, ACTIVE_IDLE_MS);
}

function credited(state: ActiveTimeState, now: number): Record<string, number> {
  const add = pendingActiveMs(state, now);
  if (!state.last || add === 0) return state.totals;
  const day = state.last.day;
  return { ...state.totals, [day]: (state.totals[day] ?? 0) + add };
}

/** The learner did something on the study screen (or it came to the front) at [now] on local date [day]. */
export function activeInteract(state: ActiveTimeState, now: number, day: string): ActiveTimeState {
  return { totals: credited(state, now), last: { at: now, day } };
}

/** The study screen went to the background / the screen went off / the learner left Study. */
export function activePause(state: ActiveTimeState, now: number): ActiveTimeState {
  if (!state.last) return state;
  return { totals: credited(state, now), last: null };
}

/** This device's active ms on [day], including the pending interval as of [now]. */
export function activeTotal(state: ActiveTimeState, day: string, now: number): number {
  const base = state.totals[day] ?? 0;
  return state.last && state.last.day === day ? base + pendingActiveMs(state, now) : base;
}

/** Drops days before [firstKept] (YYYY-MM-DD; dates compare as strings). */
export function pruneActiveTime(state: ActiveTimeState, firstKept: string): ActiveTimeState {
  const totals: Record<string, number> = {};
  for (const [day, ms] of Object.entries(state.totals)) if (day >= firstKept) totals[day] = ms;
  return { totals, last: state.last };
}

/**
 * A day's total across devices: what the server knows for everyone else plus this device's
 * own (local, always the freshest). [serverTotal] = every device as last reported,
 * [serverThisDevice] = this device's share of it.
 */
export function dayTotalAcrossDevices(localMs: number, serverTotal: number, serverThisDevice: number): number {
  return Math.max(0, serverTotal - serverThisDevice) + Math.max(0, localMs);
}

/** "23 min", "1 h 5 min", "<1 min" (nothing yet: "0 min"). */
export function formatActiveMinutes(ms: number): string {
  if (!(ms > 0)) return '0 min';
  if (ms < 60_000) return '<1 min';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The one line where the old session recap was: "Today: 23 min · 142 reviews". */
export function todayStudyLine(activeMs: number, reviews: number): string {
  return `Today: ${formatActiveMinutes(activeMs)} · ${reviews} review${reviews === 1 ? '' : 's'}`;
}

/** Valid per-day report rows for `PUT /api/me/study-time` (the server re-validates). */
export const STUDY_TIME_MAX_DAY_MS = 86_400_000;
export const STUDY_TIME_MAX_DAYS = 60;

export interface StudyTimeDay {
  date: string;
  active_ms: number;
}

/** Keeps well-formed rows (YYYY-MM-DD, 0 ≤ ms ≤ one day, integer), one per date (the larger), sorted. */
export function pickStudyTimeDays(input: unknown): { days: StudyTimeDay[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(input)) return { days: [], problems: ['days must be an array'] };
  if (input.length > STUDY_TIME_MAX_DAYS) problems.push(`at most ${STUDY_TIME_MAX_DAYS} days per report`);
  const byDate = new Map<string, number>();
  input.slice(0, STUDY_TIME_MAX_DAYS).forEach((row, i) => {
    const r = row as { date?: unknown; active_ms?: unknown } | null;
    const date = r?.date;
    const ms = r?.active_ms;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      problems.push(`days[${i}].date must be YYYY-MM-DD`);
      return;
    }
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > STUDY_TIME_MAX_DAY_MS) {
      problems.push(`days[${i}].active_ms must be 0–${STUDY_TIME_MAX_DAY_MS}`);
      return;
    }
    byDate.set(date, Math.max(byDate.get(date) ?? 0, Math.round(ms)));
  });
  const days = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, active_ms]) => ({ date, active_ms }));
  return { days, problems };
}
