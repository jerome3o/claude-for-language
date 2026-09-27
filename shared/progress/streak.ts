/**
 * The Home screen's streak card (frontend/src/components/StudyStreak.tsx) as a pure
 * function, so the Lab app's port is parity-tested against it.
 *
 * Dates are compared as `YYYY-MM-DD` strings: an event's is the first 10 characters of its
 * `reviewed_at` (the UTC date of the ISO string), a day's is `toISOString()` of LOCAL
 * midnight N days ago. East of UTC that makes "today" the previous UTC date — kept as the
 * web has it, so both apps show the same streak.
 */

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

function daysAgo(now: Date, n: number): Date {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function dateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function studyStreak(events: readonly StreakEvent[], now: Date = new Date()): StudyStreakSummary {
  const thirtyDaysAgo = dateString(daysAgo(now, 30));
  const byDate = new Map<string, StreakEvent[]>();
  for (const e of events) {
    if (!(e.reviewed_at >= thirtyDaysAgo)) continue;
    const date = e.reviewed_at.slice(0, 10);
    const list = byDate.get(date);
    if (list) list.push(e);
    else byDate.set(date, [e]);
  }

  let streak = 0;
  const today = daysAgo(now, 0);
  for (let i = 0; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (byDate.has(dateString(d))) streak++;
    else if (i === 0) continue; // not studied today yet — count from yesterday
    else break;
  }

  const todayEvents = byDate.get(dateString(today)) ?? [];
  const correct = todayEvents.filter((e) => e.rating === 2 || e.rating === 3).length;

  const heatmap: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = dateString(daysAgo(now, i));
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
