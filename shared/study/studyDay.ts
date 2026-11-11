/**
 * "When does a new day start" — the ONE rule for which study day an instant belongs to.
 *
 * Jerome often studies past midnight. With a plain calendar day the app started a new day at
 * 00:00: the next graded reader, a fresh new-card budget, a new queue and another celebration.
 * Like Anki's "Next day starts at", the study day now turns over at a ROLLOVER HOUR (default
 * 4 am, 0–6, per account — `users.day_rollover_hour`, Settings → Study → "New day starts at"):
 *
 * - **The day**: an instant before the rollover hour (local time) belongs to the previous
 *   calendar day — 01:30 with a 4 am rollover is still "yesterday".
 * - **Its edges**: the day runs from its date's rollover hour to the next date's rollover hour
 *   (`startMs` inclusive, `endMs` exclusive). Usually 24 h; 23 or 25 h across a DST change.
 * - **The day key**: the date as YYYY-MM-DD (what day-keyed totals, marks and "today" params use).
 * - A rollover of 0 is midnight: exactly the old calendar-day behaviour.
 *
 * Local times that don't exist (the spring-forward gap) or exist twice (the fall-back overlap)
 * follow java.time's rules, so the Lab app's port (core/…/StudyDay.kt) agrees to the
 * millisecond: a gap moves the time later by the gap's length, an overlap takes the earlier
 * instant. FSRS itself is untouched — intervals and due timestamps stay as they are; only
 * "which day is it" changes. Parity-tested (android-lab/parity/fixtures/study-day.ts).
 * docs/STUDY_SESSION.md "When does a new day start".
 */

export const DEFAULT_DAY_ROLLOVER_HOUR = 4;
export const MIN_DAY_ROLLOVER_HOUR = 0;
export const MAX_DAY_ROLLOVER_HOUR = 6;
/** The picker's choices, in order: midnight, 1 am … 6 am. */
export const DAY_ROLLOVER_CHOICES: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** A valid rollover hour: an integer 0–6. */
export function isDayRolloverHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_DAY_ROLLOVER_HOUR && value <= MAX_DAY_ROLLOVER_HOUR;
}

/** The hour in effect for a stored value: NULL / missing / invalid = the default (4 am). */
export function dayRolloverHour(stored: unknown): number {
  return isDayRolloverHour(stored) ? stored : DEFAULT_DAY_ROLLOVER_HOUR;
}

/** `PUT /api/profile/day-rollover` body → the value to store (null = back to the default) or problems. */
export function pickDayRolloverUpdate(body: unknown): { value: number | null; problems: string[] } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).day_rollover_hour : undefined;
  if (raw === null) return { value: null, problems: [] };
  if (raw === undefined) return { value: null, problems: ['day_rollover_hour is required (0–6, or null for the default)'] };
  if (!isDayRolloverHour(raw)) return { value: null, problems: ['day_rollover_hour must be a whole hour from 0 (midnight) to 6'] };
  return { value: raw, problems: [] };
}

/** The picker's words: "midnight", "1 am" … "6 am". */
export function dayRolloverLabel(hour: number): string {
  return hour === 0 ? 'midnight' : `${hour} am`;
}

/** The setting as one line: "New day starts at 4 am". */
export function dayRolloverSummary(hour: number): string {
  return `New day starts at ${dayRolloverLabel(hour)}`;
}

/** One study day: its key and its edges. */
export interface StudyDay {
  /** The study day's date, YYYY-MM-DD. */
  key: string;
  /** The day's rollover instant (inclusive). */
  startMs: number;
  /** The next day's rollover instant (exclusive). */
  endMs: number;
}

// ---------------------------------------------------------------- time zones

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

/**
 * The UTC offset (minutes, east positive) of `zone` at instant `ms`. No zone = the device's
 * own (the JS runtime's local time zone).
 */
export function zoneOffsetMinutes(ms: number, zone?: string | null): number {
  if (!zone) return -new Date(ms).getTimezoneOffset();
  const parts = formatterFor(zone).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const whole = Math.floor(ms / 1000) * 1000;
  return Math.round((asUtc - whole) / MINUTE_MS);
}

/** True for an IANA zone the runtime knows. */
export function isKnownTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function keyOfUtcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The instant of local date `y-m-d` at `hour`:00 in `zone` (java.time rules: a time in a
 * spring-forward gap moves later by the gap; a time that happens twice takes the earlier one).
 */
export function localTimeToInstant(y: number, m: number, d: number, hour: number, zone?: string | null): number {
  const asUtc = Date.UTC(y, m - 1, d, hour);
  const before = zoneOffsetMinutes(asUtc - DAY_MS, zone);
  const after = zoneOffsetMinutes(asUtc + DAY_MS, zone);
  let best: number | null = null;
  for (const off of before === after ? [before] : [before, after]) {
    const instant = asUtc - off * MINUTE_MS;
    if (zoneOffsetMinutes(instant, zone) !== off) continue;
    if (best === null || instant < best) best = instant;
  }
  // No candidate fits: the local time is in a gap — read it with the offset before the gap.
  return best ?? asUtc - before * MINUTE_MS;
}

/**
 * The study day that instant `ms` belongs to, in `zone` (an IANA name; none = the device's),
 * with the day turning over at `rolloverHour` (0–6; anything else = the default 4).
 */
export function studyDayAt(ms: number, rolloverHour: number, zone?: string | null): StudyDay {
  const hour = dayRolloverHour(rolloverHour);
  const local = new Date(ms + zoneOffsetMinutes(ms, zone) * MINUTE_MS);
  // Before the rollover hour = the previous calendar day.
  const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (local.getUTCHours() < hour ? 1 : 0)));
  const next = new Date(date.getTime() + DAY_MS);
  return {
    key: keyOfUtcDate(date),
    startMs: localTimeToInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, zone),
    endMs: localTimeToInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour, zone),
  };
}

/** Just the key of `studyDayAt` (cheaper: no edges). */
export function studyDayKey(ms: number, rolloverHour: number, zone?: string | null): string {
  const local = new Date(ms + zoneOffsetMinutes(ms, zone) * MINUTE_MS);
  const back = local.getUTCHours() < dayRolloverHour(rolloverHour) ? 1 : 0;
  return keyOfUtcDate(new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - back)));
}

/** The YYYY-MM-DD key `days` days after `key` (negative = before). */
export function addDayKeys(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return keyOfUtcDate(d);
}

/**
 * The study day of a FIXED UTC offset (minutes, east positive) — for the server when it only
 * has the client's `tz_offset`, and the one SQL can express (`studyDayShiftMinutes`).
 */
export function studyDayAtOffset(ms: number, rolloverHour: number, utcOffsetMinutes: number): StudyDay {
  const hour = dayRolloverHour(rolloverHour);
  const shifted = new Date(ms + utcOffsetMinutes * MINUTE_MS - hour * HOUR_MS);
  const dayUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const startMs = dayUtc + hour * HOUR_MS - utcOffsetMinutes * MINUTE_MS;
  return { key: keyOfUtcDate(shifted), startMs, endMs: startMs + DAY_MS };
}

/**
 * "Due today": the end of the study day (its last millisecond), or one hour from now if that
 * is later — so studying just before the rollover still picks up cards due just after it.
 * With a rollover of 0 this is the old `getStudyCutoff` (local 23:59:59.999).
 */
export function studyCutoffMs(nowMs: number, day: StudyDay): number {
  return Math.max(day.endMs - 1, nowMs + HOUR_MS);
}

/**
 * The minutes to add to a UTC instant so its UTC date is the study day of a fixed offset:
 * offset − rollover × 60. SQLite: `date(reviewed_at, sqliteDayModifier(shift))`.
 */
export function studyDayShiftMinutes(utcOffsetMinutes: number, rolloverHour: number): number {
  return Math.round(utcOffsetMinutes) - dayRolloverHour(rolloverHour) * 60;
}

/** The SQLite date modifier for a shift: "+60 minutes" / "-240 minutes". */
export function sqliteDayModifier(shiftMinutes: number): string {
  const m = Math.round(shiftMinutes);
  return `${m >= 0 ? '+' : '-'}${Math.abs(m)} minutes`;
}

/** The YYYY-MM-DD day of an instant after a shift (minutes): the UTC date of ms + shift. */
export function shiftedDayKey(ms: number, shiftMinutes: number): string {
  return keyOfUtcDate(new Date(ms + shiftMinutes * MINUTE_MS));
}
