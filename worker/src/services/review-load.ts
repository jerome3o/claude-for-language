/**
 * "Pause new cards on heavy days" for the tutor's view of a student: the same rule the
 * apps apply on the device (shared/decks/review-load.ts `reviewLoadToday` /
 * `reviewLoadState`) over the server's card rows, so the student card and the student
 * page can say "⏸ New cards paused today · 124 reviews due". The device decides what
 * the learner actually studies; this is the tutor's read of it (the server's card state
 * is recomputed from the same review events on every sync).
 *
 * Today's review load = cards past NEW due by today's cutoff + cards reviewed today,
 * minus cards whose first-ever review is today. "Today" is the STUDENT's study day
 * (users.time_zone, else the tutor's tz_offset; turning over at the student's "New day starts
 * at", users.day_rollover_hour — services/study-day.ts).
 */
import { reviewLoadState, type ReviewLoadState } from '@shared/decks';
import { studyCutoffMs, studyDayAtOffset } from '../../../shared/study/studyDay';
import { userStudyDay } from './study-day';

/**
 * A zone's offset in Date.getTimezoneOffset() minutes (UTC − local; London summer = −60)
 * at `at`; null when the zone is not a valid IANA name.
 */
export function tzOffsetMinutesIn(timeZone: string | null | undefined, at: Date): number | null {
  if (!timeZone) return null;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    const whole = Math.floor(at.getTime() / 1000) * 1000;
    const minutes = Math.round((whole - wall) / 60_000);
    return Number.isFinite(minutes) ? minutes : null;
  } catch {
    return null;
  }
}

/**
 * The study day's start and the "due today" cutoff (the apps' getStudyCutoff: the later of the
 * study day's last millisecond and now + 1 hour) in a zone given as getTimezoneOffset()
 * minutes, the day turning over at `rolloverHour` (0 = local midnight).
 */
export function studyDayBounds(nowMs: number, tzOffsetMinutes: number, rolloverHour = 0): { dayStartMs: number; cutoffMs: number } {
  const day = studyDayAtOffset(nowMs, rolloverHour, -tzOffsetMinutes);
  return { dayStartMs: day.startMs, cutoffMs: studyCutoffMs(nowMs, day) };
}

/** The review load of a user's cards today (SQL form of `reviewLoadToday`). */
export async function fetchReviewLoad(db: D1Database, userId: string, dayStartMs: number, cutoffMs: number): Promise<number> {
  const dayStartIso = new Date(dayStartMs).toISOString();
  const cutoffIso = new Date(cutoffMs).toISOString();
  const row = await db
    .prepare(
      `WITH today AS (
         SELECT card_id FROM review_events WHERE user_id = ?1 AND reviewed_at >= ?2 GROUP BY card_id
       )
       SELECT COUNT(*) AS load
       FROM cards c
       JOIN notes n ON n.id = c.note_id
       JOIN decks d ON d.id = n.deck_id
       LEFT JOIN today t ON t.card_id = c.id
       WHERE d.user_id = ?1 AND COALESCE(c.queue, 0) != 0
         AND (
           t.card_id IS NOT NULL
           OR (c.queue IN (1, 3) AND COALESCE(c.due_timestamp, CAST((julianday(c.next_review_at) - 2440587.5) * 86400000 AS INTEGER), 0) <= ?3)
           OR (c.queue NOT IN (1, 3) AND (c.next_review_at IS NULL OR c.next_review_at <= ?4))
         )
         AND (t.card_id IS NULL OR EXISTS (SELECT 1 FROM review_events p WHERE p.card_id = c.id AND p.reviewed_at < ?2))`
    )
    .bind(userId, dayStartIso, cutoffMs, cutoffIso)
    .first<{ load: number }>();
  return row?.load ?? 0;
}

/**
 * The student's state today, or null when their limit is off (nothing to compute).
 * `fallbackTzOffset`: the tutor's zone, used when the student has none.
 */
export async function studentReviewLoad(
  db: D1Database,
  student: { id: string; pause_new_when_reviews_over?: number | null; time_zone?: string | null; day_rollover_hour?: number | null },
  fallbackTzOffset: number,
  now: Date = new Date()
): Promise<ReviewLoadState | null> {
  const threshold = student.pause_new_when_reviews_over;
  if (typeof threshold !== 'number') return null;
  const day = userStudyDay(student, now.getTime(), fallbackTzOffset);
  const load = await fetchReviewLoad(db, student.id, day.startMs, studyCutoffMs(now.getTime(), day));
  return reviewLoadState(load, threshold);
}
