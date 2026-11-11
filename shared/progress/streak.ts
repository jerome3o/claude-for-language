/**
 * The Home screen's streak card (frontend/src/components/StudyStreak.tsx) as a pure
 * function, so the Lab app's port is parity-tested against it.
 *
 * Days are STUDY days (shared/study/studyDay.ts): an event belongs to the study day of its
 * instant in the device's time zone (`zone`; none = the runtime's), which turns over at the
 * account's rollover hour — so a review at 01:30 with "New day starts at 4 am" still counts
 * for yesterday, and the streak doesn't break (or double) when he studies past midnight.
 * (Until Nov 2026 the card compared UTC dates with local midnight's UTC date.)
 */
import { addDayKeys, DEFAULT_DAY_ROLLOVER_HOUR, studyDayKey } from '../study/studyDay';

export interface StreakEvent {
  reviewed_at: string;
  rating: number;
  time_spent_ms?: number | null;
}

export interface StudyStreakSummary {
  /** Consecutive days with reviews counting back from today (today may still be empty). */
  streak: number;
  today: { reviews: number; accuracy: number; time_ms: number };
  /** Oldest first, 30 entries ending today. */
  heatmap: { date: string; count: number }[];
  /** At least 1: the colour scale's top. */
  max_count: number;
}

export function studyStreak(
  events: readonly StreakEvent[],
  now: Date = new Date(),
  rolloverHour: number = DEFAULT_DAY_ROLLOVER_HOUR,
  zone?: string | null,
): StudyStreakSummary {
  const today = studyDayKey(now.getTime(), rolloverHour, zone);
  const thirtyDaysAgo = addDayKeys(today, -30);
  const byDate = new Map<string, StreakEvent[]>();
  for (const e of events) {
    const ms = Date.parse(e.reviewed_at);
    const date = Number.isFinite(ms) ? studyDayKey(ms, rolloverHour, zone) : e.reviewed_at.slice(0, 10);
    if (!(date >= thirtyDaysAgo)) continue;
    const list = byDate.get(date);
    if (list) list.push(e);
    else byDate.set(date, [e]);
  }

  let streak = 0;
  for (let i = 0; i <= 30; i++) {
    if (byDate.has(addDayKeys(today, -i))) streak++;
    else if (i === 0) continue; // not studied today yet — count from yesterday
    else break;
  }

  const todayEvents = byDate.get(today) ?? [];
  const correct = todayEvents.filter((e) => e.rating === 2 || e.rating === 3).length;

  const heatmap: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = addDayKeys(today, -i);
    heatmap.push({ date, count: byDate.get(date)?.length ?? 0 });
  }

  return {
    streak,
    today: {
      reviews: todayEvents.length,
      accuracy: todayEvents.length > 0 ? Math.round((correct / todayEvents.length) * 100) : 0,
      time_ms: todayEvents.reduce((s, e) => s + (e.time_spent_ms || 0), 0),
    },
    heatmap,
    max_count: Math.max(...heatmap.map((d) => d.count), 1),
  };
}

/** The streak card's short time ("12m", "1h 5m"): whole minutes, floored. */
export function formatStreakTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}
