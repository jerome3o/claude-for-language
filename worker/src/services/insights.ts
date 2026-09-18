/**
 * Student Insights — pure aggregation over a student's review events.
 *
 * Everything in this file is a plain function over rows so it can be unit
 * tested without a database. The route layer fetches the rows
 * (db/insights-queries.ts) and hands them here.
 *
 * Tutor-facing wording: "forgot", not "lapse"; "attempt", not "review event".
 */

import type { CardType } from '../types';

// ---------- Inputs ----------

/** One review event joined to its card, note and deck. */
export interface InsightReviewRow {
  event_id: string;
  card_id: string;
  card_type: CardType;
  note_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  rating: number; // 0 again, 1 hard, 2 good, 3 easy
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
  reviewed_at: string; // ISO
}

/** Cached scheduling state of a card (an approximation — never recomputed here). */
export interface InsightCardState {
  note_id: string;
  card_type: CardType;
  queue: number; // 0 new, 1 learning, 2 review, 3 relearning
  interval: number; // days
}

export interface RecordingMark {
  review_event_id: string;
  status: 'listened' | 'needs_work';
  comment: string | null;
  updated_at: string;
}

// ---------- Outputs ----------

export interface InsightNoteRef {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface CardTypeStats {
  attempts: number;
  again_count: number;
  accuracy: number; // 0..1, share of ratings >= good
}

export interface InsightTotals {
  reviews: number;
  unique_cards: number;
  unique_notes: number;
  days_active: number;
  accuracy: number; // 0..1
  again_rate: number; // 0..1
  time_ms: number;
  by_card_type: Partial<Record<CardType, CardTypeStats>>;
  new_words_introduced: number;
}

export interface InsightAttempt {
  event_id: string;
  card_type: CardType;
  rating: number;
  reviewed_at: string;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
}

export interface StrugglingNote {
  note: InsightNoteRef;
  score: number;
  attempts: number;
  again_count: number;
  again_rate: number;
  hard_count: number;
  /** Times the word was forgotten after having been answered correctly earlier in the range. */
  forgot_count: number;
  avg_time_ms: number | null;
  last_reviewed_at: string;
  by_card_type: Partial<Record<CardType, CardTypeStats>>;
  /** Distinct typed answers that differ from the hanzi, most recent first (max 5). */
  wrong_answers: string[];
  wrong_typed_count: number;
  recordings_count: number;
  /** Every attempt in the range, newest first, so the UI can expand a row inline. */
  events: InsightAttempt[];
}

export interface GoingWellNote {
  note: InsightNoteRef;
  attempts: number;
  easy_count: number;
  /** consistent: good/easy on every attempt; graduated: now scheduled a week or more out */
  reason: 'consistent' | 'graduated';
  max_interval_days: number | null;
  last_reviewed_at: string;
}

export interface InsightRecording {
  event_id: string;
  note: InsightNoteRef;
  card_type: CardType;
  rating: number;
  reviewed_at: string;
  recording_url: string;
  user_answer: string | null;
  mark: RecordingMark | null;
}

export interface InsightActivity {
  lessons: Array<{ lesson_id: string; title: string; rating: number | null; completed_at: string }>;
  readers: Array<{ reader_id: string; title_chinese: string; title_english: string; rating: number; reviewed_at: string }>;
  quests: Array<{ quest_id: string; title: string; completed_at: string; best_moves: number | null }>;
}

export interface InsightsReport {
  totals: InsightTotals;
  struggling: StrugglingNote[];
  going_well: GoingWellNote[];
  activity: InsightActivity;
  recordings: InsightRecording[];
}

// ---------- Helpers ----------

const PUNCTUATION_RE = /[\s。，！？、；：,.!?;:'"“”‘’…—·\-()（）]/g;

/** Typed-answer equivalence: whitespace and punctuation don't count as mistakes. */
export function normalizeAnswer(s: string): string {
  return s.replace(PUNCTUATION_RE, '').toLowerCase();
}

function noteRef(r: InsightReviewRow): InsightNoteRef {
  return {
    id: r.note_id,
    hanzi: r.hanzi,
    pinyin: r.pinyin,
    english: r.english,
    deck_id: r.deck_id,
    deck_name: r.deck_name,
  };
}

function toAttempt(r: InsightReviewRow): InsightAttempt {
  return {
    event_id: r.event_id,
    card_type: r.card_type,
    rating: r.rating,
    reviewed_at: r.reviewed_at,
    time_spent_ms: r.time_spent_ms,
    user_answer: r.user_answer,
    recording_url: r.recording_url,
  };
}

function byNewestFirst(a: { reviewed_at: string }, b: { reviewed_at: string }): number {
  return a.reviewed_at < b.reviewed_at ? 1 : a.reviewed_at > b.reviewed_at ? -1 : 0;
}

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function cardTypeStats(rows: InsightReviewRow[]): Partial<Record<CardType, CardTypeStats>> {
  const out: Partial<Record<CardType, CardTypeStats>> = {};
  for (const r of rows) {
    const s = out[r.card_type] ?? { attempts: 0, again_count: 0, accuracy: 0 };
    s.attempts++;
    if (r.rating === 0) s.again_count++;
    out[r.card_type] = s;
  }
  for (const s of Object.values(out)) {
    s.accuracy = s.attempts ? round((s.attempts - s.again_count) / s.attempts) : 0;
  }
  return out;
}

/** Group rows by note, each group sorted newest first. */
export function groupByNote(rows: InsightReviewRow[]): Map<string, InsightReviewRow[]> {
  const map = new Map<string, InsightReviewRow[]>();
  for (const r of rows) {
    const list = map.get(r.note_id);
    if (list) list.push(r);
    else map.set(r.note_id, [r]);
  }
  for (const list of map.values()) list.sort(byNewestFirst);
  return map;
}

// ---------- Totals ----------

export function computeTotals(rows: InsightReviewRow[], newWordsIntroduced: number): InsightTotals {
  const cards = new Set<string>();
  const notes = new Set<string>();
  const days = new Set<string>();
  let again = 0;
  let time = 0;
  for (const r of rows) {
    cards.add(r.card_id);
    notes.add(r.note_id);
    days.add(r.reviewed_at.slice(0, 10));
    if (r.rating === 0) again++;
    time += r.time_spent_ms ?? 0;
  }
  const n = rows.length;
  return {
    reviews: n,
    unique_cards: cards.size,
    unique_notes: notes.size,
    days_active: days.size,
    accuracy: n ? round((n - again) / n) : 0,
    again_rate: n ? round(again / n) : 0,
    time_ms: time,
    by_card_type: cardTypeStats(rows),
    new_words_introduced: newWordsIntroduced,
  };
}

// ---------- Struggling ----------

/**
 * Times a card was rated Again after an earlier Good/Easy on the same card
 * within the range — "knew it, then forgot it".
 */
export function countForgotAfterCorrect(noteRows: InsightReviewRow[]): number {
  const byCard = new Map<string, InsightReviewRow[]>();
  for (const r of noteRows) {
    const list = byCard.get(r.card_id);
    if (list) list.push(r);
    else byCard.set(r.card_id, [r]);
  }
  let forgot = 0;
  for (const list of byCard.values()) {
    const chrono = [...list].sort((a, b) => -byNewestFirst(a, b));
    let knewIt = false;
    for (const r of chrono) {
      if (r.rating >= 2) knewIt = true;
      else if (r.rating === 0 && knewIt) {
        forgot++;
        knewIt = false;
      }
    }
  }
  return forgot;
}

/** Distinct typed answers that differ from the hanzi, most recent first. */
export function collectWrongAnswers(noteRows: InsightReviewRow[], hanzi: string, max = 5): { answers: string[]; count: number } {
  const target = normalizeAnswer(hanzi);
  const seen = new Set<string>();
  const answers: string[] = [];
  let count = 0;
  for (const r of [...noteRows].sort(byNewestFirst)) {
    const a = r.user_answer?.trim();
    if (!a) continue;
    if (normalizeAnswer(a) === target) continue;
    count++;
    const key = normalizeAnswer(a);
    if (seen.has(key)) continue;
    seen.add(key);
    if (answers.length < max) answers.push(a);
  }
  return { answers, count };
}

/**
 * Struggle score: Again-rate scaled by how often the word was seen (one bad
 * attempt out of one is weaker evidence than three out of six), plus a heavy
 * weight on "knew it then forgot it", plus each wrong typed answer, plus a
 * small weight on Hard.
 */
export function struggleScore(s: {
  attempts: number;
  again_count: number;
  hard_count: number;
  forgot_count: number;
  wrong_typed_count: number;
}): number {
  if (s.attempts === 0) return 0;
  const againRate = s.again_count / s.attempts;
  return round(
    againRate * Math.sqrt(s.attempts) * 3 +
      s.forgot_count * 2 +
      s.wrong_typed_count * 1 +
      s.hard_count * 0.25,
    3
  );
}

export function rankStruggling(rows: InsightReviewRow[], limit = 25): StrugglingNote[] {
  const out: StrugglingNote[] = [];
  for (const [, noteRows] of groupByNote(rows)) {
    const first = noteRows[0];
    const attempts = noteRows.length;
    const again_count = noteRows.filter((r) => r.rating === 0).length;
    const hard_count = noteRows.filter((r) => r.rating === 1).length;
    const { answers, count: wrong_typed_count } = collectWrongAnswers(noteRows, first.hanzi);
    if (again_count === 0 && hard_count === 0 && wrong_typed_count === 0) continue;
    const forgot_count = countForgotAfterCorrect(noteRows);
    const timed = noteRows.filter((r) => r.time_spent_ms != null && r.time_spent_ms > 0);
    const avg_time_ms = timed.length
      ? Math.round(timed.reduce((sum, r) => sum + (r.time_spent_ms ?? 0), 0) / timed.length)
      : null;
    const score = struggleScore({ attempts, again_count, hard_count, forgot_count, wrong_typed_count });
    out.push({
      note: noteRef(first),
      score,
      attempts,
      again_count,
      again_rate: round(again_count / attempts),
      hard_count,
      forgot_count,
      avg_time_ms,
      last_reviewed_at: first.reviewed_at,
      by_card_type: cardTypeStats(noteRows),
      wrong_answers: answers,
      wrong_typed_count,
      recordings_count: noteRows.filter((r) => !!r.recording_url).length,
      events: noteRows.map(toAttempt),
    });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      b.again_count - a.again_count ||
      byNewestFirst({ reviewed_at: a.last_reviewed_at }, { reviewed_at: b.last_reviewed_at })
  );
  return out.slice(0, limit);
}

// ---------- Going well ----------

export function pickGoingWell(
  rows: InsightReviewRow[],
  cardStates: InsightCardState[],
  limit = 25
): GoingWellNote[] {
  const graduatedInterval = new Map<string, number>();
  for (const c of cardStates) {
    if (c.queue === 2 && c.interval >= 7) {
      const prev = graduatedInterval.get(c.note_id) ?? 0;
      if (c.interval > prev) graduatedInterval.set(c.note_id, c.interval);
    }
  }

  const out: GoingWellNote[] = [];
  for (const [noteId, noteRows] of groupByNote(rows)) {
    const first = noteRows[0];
    const attempts = noteRows.length;
    const allCorrect = noteRows.every((r) => r.rating >= 2);
    const anyCorrect = noteRows.some((r) => r.rating >= 2);
    const easy_count = noteRows.filter((r) => r.rating === 3).length;
    const interval = graduatedInterval.get(noteId) ?? null;

    let reason: GoingWellNote['reason'] | null = null;
    if (allCorrect && attempts >= 2) reason = 'consistent';
    else if (interval != null && anyCorrect && !noteRows.some((r) => r.rating === 0)) reason = 'graduated';
    if (!reason) continue;

    out.push({
      note: noteRef(first),
      attempts,
      easy_count,
      reason,
      max_interval_days: interval,
      last_reviewed_at: first.reviewed_at,
    });
  }
  out.sort(
    (a, b) =>
      (b.max_interval_days ?? 0) - (a.max_interval_days ?? 0) ||
      b.attempts - a.attempts ||
      b.easy_count - a.easy_count ||
      byNewestFirst({ reviewed_at: a.last_reviewed_at }, { reviewed_at: b.last_reviewed_at })
  );
  return out.slice(0, limit);
}

// ---------- Recordings ----------

export function listRecordings(rows: InsightReviewRow[], marks: RecordingMark[]): InsightRecording[] {
  const markById = new Map(marks.map((m) => [m.review_event_id, m]));
  return rows
    .filter((r): r is InsightReviewRow & { recording_url: string } => !!r.recording_url)
    .sort(byNewestFirst)
    .map((r) => ({
      event_id: r.event_id,
      note: noteRef(r),
      card_type: r.card_type,
      rating: r.rating,
      reviewed_at: r.reviewed_at,
      recording_url: r.recording_url,
      user_answer: r.user_answer,
      mark: markById.get(r.event_id) ?? null,
    }));
}

// ---------- Whole report ----------

export function computeInsights(input: {
  rows: InsightReviewRow[];
  cardStates: InsightCardState[];
  newWordsIntroduced: number;
  activity: InsightActivity;
  marks: RecordingMark[];
}): InsightsReport {
  return {
    totals: computeTotals(input.rows, input.newWordsIntroduced),
    struggling: rankStruggling(input.rows),
    going_well: pickGoingWell(input.rows, input.cardStates),
    activity: input.activity,
    recordings: listRecordings(input.rows, input.marks),
  };
}

// ---------- Range parsing ----------

export const MAX_RANGE_DAYS = 400;
export const DEFAULT_RANGE_DAYS = 14;

/**
 * Resolve the requested range. `sinceLessonAt` is the latest logged lesson
 * for the relationship; with no explicit `from` it is the default start,
 * else the last 14 days. Ranges are capped at MAX_RANGE_DAYS.
 */
export function resolveRange(
  params: { from?: string | null; to?: string | null },
  sinceLessonAt: string | null,
  now: Date = new Date()
): { from: string; to: string; used_since_lesson: boolean } {
  const to = parseIso(params.to) ?? now;
  let from = parseIso(params.from);
  let used_since_lesson = false;
  if (!from) {
    const lesson = parseIso(sinceLessonAt);
    if (lesson && lesson.getTime() < to.getTime()) {
      from = lesson;
      used_since_lesson = true;
    } else {
      from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
    }
  }
  const minFrom = to.getTime() - MAX_RANGE_DAYS * 86_400_000;
  if (from.getTime() < minFrom) from = new Date(minFrom);
  if (from.getTime() > to.getTime()) from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), used_since_lesson };
}

function parseIso(s: string | null | undefined): Date | null {
  if (!s) return null;
  // A bare date means the whole day: from = start of day, to = end of day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** For `to` given as a bare date, extend to the end of that day. */
export function endOfDayIfBare(s: string | null | undefined): string | null | undefined {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59.999Z`;
  return s;
}
