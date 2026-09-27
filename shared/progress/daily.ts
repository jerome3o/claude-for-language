/**
 * "My Progress" numbers, as pure functions over review events.
 *
 * The web's Progress page gets these from the server (`GET /api/progress/daily`,
 * `/api/progress/day/:date` — `getMyDailyProgress` / `getMyDayCards` in
 * worker/src/services/relationships.ts, plain SQL). The Lab app computes them from the
 * review events on the phone so the tab works offline. This module is the one written-down
 * definition both follow, and android-lab parity-tests its Kotlin port against it:
 *
 * - Days are **UTC dates** (SQLite `date(reviewed_at)`).
 * - The 30-day window is `reviewed_at >= datetime('now', '-30 days')`, a STRING comparison
 *   between an ISO timestamp ("2026-08-28T01:00:00.000Z") and "2026-08-28 13:00:00": the
 *   'T' sorts after the space, so the whole boundary day is in. [windowStart] reproduces it.
 * - A day's accuracy is the share of ratings ≥ 2 (Good / Easy) × 100, rounded per day; the
 *   summary's accuracy is the rounded mean of the unrounded day accuracies.
 */

export interface ProgressEvent {
  id?: string;
  card_id: string;
  rating: number;
  /** ISO string as stored. */
  reviewed_at: string;
  time_spent_ms?: number | null;
  user_answer?: string | null;
}

export interface DailyProgressDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  reviews_count: number;
  unique_cards: number;
  /** Rounded percentage of Good / Easy ratings. */
  accuracy: number;
  time_spent_ms: number;
}

export interface DailyProgress {
  summary: {
    total_reviews_30d: number;
    total_days_active: number;
    average_accuracy: number;
    total_time_ms: number;
  };
  /** Newest first. */
  days: DailyProgressDay[];
}

const DAY_MS = 86_400_000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** SQLite `datetime(nowMs / 1000, 'unixepoch', '-30 days')`: "YYYY-MM-DD HH:MM:SS" (UTC). */
export function windowStart(nowMs: number, days = 30): string {
  const d = new Date(nowMs - days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** SQLite `date(reviewed_at)` for the ISO timestamps clients write: the UTC date. */
export function utcDate(reviewedAt: string): string {
  const ms = Date.parse(reviewedAt);
  if (Number.isNaN(ms)) return reviewedAt.slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Port of the `/api/progress/daily` SQL over events already on the device. */
export function dailyProgress(events: readonly ProgressEvent[], nowMs: number): DailyProgress {
  const start = windowStart(nowMs);
  const byDate = new Map<string, { count: number; cards: Set<string>; correct: number; time: number }>();
  for (const e of events) {
    if (!(e.reviewed_at >= start)) continue;
    const date = utcDate(e.reviewed_at);
    let day = byDate.get(date);
    if (!day) {
      day = { count: 0, cards: new Set(), correct: 0, time: 0 };
      byDate.set(date, day);
    }
    day.count++;
    day.cards.add(e.card_id);
    if (e.rating >= 2) day.correct++;
    day.time += e.time_spent_ms ?? 0;
  }

  const rows = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, d]) => ({
      date,
      reviews_count: d.count,
      unique_cards: d.cards.size,
      accuracy: (d.correct / d.count) * 100,
      time_spent_ms: d.time,
    }));

  const totalReviews = rows.reduce((sum, d) => sum + d.reviews_count, 0);
  const totalTime = rows.reduce((sum, d) => sum + d.time_spent_ms, 0);
  const averageAccuracy = rows.length > 0
    ? Math.round(rows.reduce((sum, d) => sum + d.accuracy, 0) / rows.length)
    : 0;

  return {
    summary: {
      total_reviews_30d: totalReviews,
      total_days_active: rows.length,
      average_accuracy: averageAccuracy,
      total_time_ms: totalTime,
    },
    days: rows.map((d) => ({ ...d, accuracy: Math.round(d.accuracy) })),
  };
}

export interface ProgressCardInfo {
  card_id: string;
  card_type: string;
  note_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface DayCard {
  card_id: string;
  card_type: string;
  note: { id: string; hanzi: string; pinyin: string; english: string };
  review_count: number;
  /** In the order the reviews happened. */
  ratings: number[];
  average_rating: number;
  total_time_ms: number;
  has_answers: boolean;
}

export interface DayCards {
  date: string;
  summary: { total_reviews: number; unique_cards: number; accuracy: number; time_spent_ms: number };
  /** Most difficult first: most reviews, then lowest average rating. */
  cards: DayCard[];
}

/**
 * Port of `/api/progress/day/:date`: the cards reviewed on one UTC date. Events of cards
 * the device no longer has are left out (the SQL joins cards and notes). The SQL leaves
 * ties in the "most difficult first" order unspecified; here they go by the time of the
 * card's first review that day, then card id.
 */
export function dayCards(events: readonly ProgressEvent[], cards: readonly ProgressCardInfo[], date: string): DayCards {
  const info = new Map(cards.map((c) => [c.card_id, c]));
  const dayEvents = events
    .filter((e) => info.has(e.card_id) && utcDate(e.reviewed_at) === date)
    .slice()
    .sort((a, b) => (a.reviewed_at < b.reviewed_at ? -1 : a.reviewed_at > b.reviewed_at ? 1 : 0));

  const byCard = new Map<string, { first: string; ratings: number[]; time: number; answers: boolean }>();
  for (const e of dayEvents) {
    let c = byCard.get(e.card_id);
    if (!c) {
      c = { first: e.reviewed_at, ratings: [], time: 0, answers: false };
      byCard.set(e.card_id, c);
    }
    c.ratings.push(e.rating);
    c.time += e.time_spent_ms ?? 0;
    if (e.user_answer != null && e.user_answer !== '') c.answers = true;
  }

  const rows = [...byCard.entries()].map(([cardId, c]) => {
    const card = info.get(cardId)!;
    return {
      first: c.first,
      card: {
        card_id: cardId,
        card_type: card.card_type,
        note: { id: card.note_id, hanzi: card.hanzi, pinyin: card.pinyin, english: card.english },
        review_count: c.ratings.length,
        ratings: c.ratings,
        average_rating: c.ratings.reduce((s, r) => s + r, 0) / c.ratings.length,
        total_time_ms: c.time,
        has_answers: c.answers,
      } satisfies DayCard,
    };
  });
  rows.sort((a, b) =>
    b.card.review_count - a.card.review_count ||
    a.card.average_rating - b.card.average_rating ||
    (a.first < b.first ? -1 : a.first > b.first ? 1 : 0) ||
    (a.card.card_id < b.card.card_id ? -1 : a.card.card_id > b.card.card_id ? 1 : 0),
  );
  const list = rows.map((r) => r.card);

  const allRatings = list.flatMap((c) => c.ratings);
  return {
    date,
    summary: {
      total_reviews: list.reduce((s, c) => s + c.review_count, 0),
      unique_cards: list.length,
      accuracy: allRatings.length > 0
        ? Math.round((allRatings.filter((r) => r >= 2).length / allRatings.length) * 100)
        : 0,
      time_spent_ms: list.reduce((s, c) => s + c.total_time_ms, 0),
    },
    cards: list,
  };
}

/**
 * Study time for stat tiles (the web's `formatTime` in components/DeckProgress.tsx).
 * Never "0m" for time actually spent: under a minute is "< 1 min", minutes are rounded.
 */
export function formatStudyTime(ms: number): string {
  if (!ms || ms <= 0) return '0 min';
  if (ms < 60000) return '< 1 min';
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}
