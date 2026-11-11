/**
 * "New day starts at" on the server (shared/study/studyDay.ts; docs/STUDY_SESSION.md "When
 * does a new day start"): the account's rollover hour (`users.day_rollover_hour`, NULL = 4 am)
 * and the study day of a user — so what the server calls "today" for someone (the tutor
 * dashboard's "studied today" / streak, the review load, `claude_today`, the progress days,
 * homework e-mails) is the day both apps use.
 *
 * Which clock: the user's own time zone (`users.time_zone`, DST-aware) when it is set, else
 * the fixed offset the client sent (`tz_offset`, JS getTimezoneOffset sign: minutes WEST of
 * UTC), else UTC.
 */
import {
  dayRolloverHour,
  isKnownTimeZone,
  studyDayAt,
  studyDayAtOffset,
  studyDayShiftMinutes,
  zoneOffsetMinutes,
  type StudyDay,
} from '../../../shared/study/studyDay';

export interface StudyDayUser {
  time_zone?: string | null;
  day_rollover_hour?: number | null;
}

export async function getDayRolloverHour(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT day_rollover_hour FROM users WHERE id = ?').bind(userId).first<{ day_rollover_hour: number | null }>();
  return dayRolloverHour(row?.day_rollover_hour);
}

/** Store the hour (null = back to the default); returns the hour now in effect. */
export async function setDayRolloverHour(db: D1Database, userId: string, hour: number | null): Promise<number> {
  await db.prepare('UPDATE users SET day_rollover_hour = ? WHERE id = ?').bind(hour, userId).run();
  return dayRolloverHour(hour);
}

/** The user's time zone + hour, for the study-day helpers. */
export async function getStudyDayUser(db: D1Database, userId: string): Promise<StudyDayUser> {
  const row = await db.prepare('SELECT time_zone, day_rollover_hour FROM users WHERE id = ?').bind(userId)
    .first<{ time_zone: string | null; day_rollover_hour: number | null }>().catch(() => null);
  return { time_zone: row?.time_zone ?? null, day_rollover_hour: row?.day_rollover_hour ?? null };
}

/** The user's UTC offset now (minutes, EAST positive): their time zone, else the client's tz_offset (west positive), else 0. */
export function userUtcOffsetMinutes(user: StudyDayUser, nowMs: number, fallbackTzOffset?: number | null): number {
  if (isKnownTimeZone(user.time_zone)) return zoneOffsetMinutes(nowMs, user.time_zone);
  if (typeof fallbackTzOffset === 'number' && Number.isFinite(fallbackTzOffset)) return -Math.round(fallbackTzOffset);
  return 0;
}

/** The study day `nowMs` belongs to for this user. */
export function userStudyDay(user: StudyDayUser, nowMs: number, fallbackTzOffset?: number | null): StudyDay {
  const hour = dayRolloverHour(user.day_rollover_hour);
  if (isKnownTimeZone(user.time_zone)) return studyDayAt(nowMs, hour, user.time_zone);
  return studyDayAtOffset(nowMs, hour, userUtcOffsetMinutes(user, nowMs, fallbackTzOffset));
}

/** The study-day key of any instant for this user (activity rows, "studied today"). */
export function userStudyDayKey(user: StudyDayUser, at: number | string | Date, fallbackTzOffset?: number | null): string {
  const ms = typeof at === 'number' ? at : at instanceof Date ? at.getTime() : Date.parse(at);
  return userStudyDay(user, Number.isFinite(ms) ? ms : 0, fallbackTzOffset).key;
}

/**
 * The progress pages' day shift (shared/progress/daily.ts): the user's offset now minus the
 * rollover — what `date(reviewed_at, '±N minutes')` adds.
 */
export function userProgressShiftMinutes(user: StudyDayUser, nowMs: number, fallbackTzOffset?: number | null): number {
  return studyDayShiftMinutes(userUtcOffsetMinutes(user, nowMs, fallbackTzOffset), dayRolloverHour(user.day_rollover_hour));
}
