/**
 * Tutor dashboard — pure aggregation for one student card.
 *
 * Everything here is a plain function over rows so it can be unit tested
 * without a database. db/tutor-dashboard-queries.ts fetches the rows and
 * routes/tutor-dashboard.ts hands them to buildStudentOverview().
 *
 * Tutor-facing wording only (see services/insights.ts for the same rule).
 */

import type { User } from '../types';
import { DEFAULT_STUDY_BUDGET, daysToIntroduce, type StudyBudget } from '@shared/decks';
import {
  rankStruggling,
  listRecordings,
  type InsightReviewRow,
  type InsightNoteRef,
  type RecordingMark,
  type StrugglingNote,
  type InsightRecording,
} from './insights';

// ---------- Inputs ----------

export type UserSummary = Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;

/** Lightweight review row for the 30-day activity/streak window. */
export interface ActivityRow {
  reviewed_at: string; // ISO
  rating: number;
  time_spent_ms: number | null;
}

/** One deck the tutor shared with this student, with the student's copy state. */
export interface HomeworkDeckInput {
  shared_deck_id: string;
  source_deck_id: string;
  target_deck_id: string;
  source_deck_name: string;
  target_deck_name: string | null;
  shared_at: string;
  cards_total: number;
  cards_started: number; // queue != NEW
  cards_mastered: number; // stability > 21 days
  /** Notes in the tutor's source deck that the student's copy does not have yet. */
  notes_missing: number;
  /** Words in the student's copy, and how many have been introduced (any card reviewed). */
  notes_total: number;
  notes_introduced: number;
  /** The copy's place in the student's queue (higher = sooner). */
  study_priority?: number;
}

/** One lesson the tutor assigned to this student. */
export interface HomeworkLessonInput {
  lesson_id: string;
  title: string;
  icon: string | null;
  created_at: string;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
}

export interface StudentUserRow extends UserSummary {
  last_login_at: string | null;
  /** Daily new-card budget (NULL = default). */
  new_cards_per_day?: number | null;
  secondary_cards_per_day?: number | null;
  install_kind: 'pwa' | 'android' | 'browser' | null;
  cached_audio_count: number | null;
  last_opened_at: string | null;
  created_at: string;
}

export interface InviteRef {
  id: string;
  url: string;
  status: string;
  redeemed_at: string | null;
}

export interface StudentOverviewInput {
  relationship_id: string;
  student: StudentUserRow;
  joined_at: string;
  /** Review rows in the last 30 days (newest first is fine, order is not assumed). */
  activity_rows: ActivityRow[];
  /** Full insight rows for the last 7 days (feed rankStruggling / listRecordings). */
  week_rows: InsightReviewRow[];
  week_marks: RecordingMark[];
  /** All-time count of the student's recordings the tutor has not marked yet. */
  unheard_recordings: number;
  first_review_at: string | null;
  total_reviews: number;
  homework_decks: HomeworkDeckInput[];
  homework_lessons: HomeworkLessonInput[];
  /** The student's deck queue in study order (ids), for queue positions on the homework rows. */
  deck_queue?: { id: string }[];
  /** Notes with audio in the student's decks (what a full prefetch would cache). */
  audio_total: number;
  invite: InviteRef | null;
  last_conversation_id: string | null;
  /** Client's Date.getTimezoneOffset() in minutes; days are bucketed in that zone. */
  tz_offset_minutes: number;
  now?: Date;
}

// ---------- Outputs ----------

export interface StudyStatus {
  last_studied_at: string | null;
  studied_today: boolean;
  streak_days: number;
  active_days_30: number;
  today: { reviews: number; accuracy: number | null; time_ms: number };
}

export interface NeedsAttentionItem {
  note: InsightNoteRef;
  attempts: number;
  again_count: number;
  hard_count: number;
  /** Distinct wrong typed answers, most recent first (max 5). */
  wrong_answers: string[];
  wrong_typed_count: number;
  last_reviewed_at: string;
  /** The newest unheard recording for this word in the window, if any. */
  recording: { event_id: string; recording_url: string } | null;
  recordings_unheard: number;
}

export interface HomeworkDeck extends HomeworkDeckInput {
  percent_started: number;
  percent_mastered: number;
  /** Words still to be introduced and roughly how many days that takes at the student's daily budget. */
  words_to_go: number;
  days_to_go: number;
  /** 1-based place of the student's copy in their deck queue (first = studied first); null when the copy is gone. */
  queue_position: number | null;
  queue_total: number;
}

export interface HomeworkSummary {
  /** Blended progress 0..100, null when nothing has been assigned. See homeworkPercent(). */
  percent: number | null;
  cards_total: number;
  cards_started: number;
  cards_mastered: number;
  lessons_total: number;
  lessons_completed: number;
  decks: HomeworkDeck[];
  lessons: HomeworkLessonInput[];
}

export type SetupStepKey = 'signed_in' | 'homework' | 'installed' | 'first_session';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  done: boolean;
  detail: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  done_count: number;
  install_kind: 'pwa' | 'android' | 'browser' | null;
  audio: { cached: number | null; total: number };
  last_opened_at: string | null;
  invite: InviteRef | null;
}

export interface ActivityDay {
  day: string; // YYYY-MM-DD in the client's zone
  reviews: number;
  accuracy: number | null;
  time_ms: number;
}

export interface StudentOverview {
  relationship_id: string;
  student: UserSummary;
  joined_at: string;
  joined_via_invite: boolean;
  /** No review events yet — the dashboard shows the "Getting set up" card. */
  is_new: boolean;
  status: StudyStatus;
  pills: {
    struggling_words: number;
    recordings_to_hear: number;
    homework_percent: number | null;
  };
  needs_attention: NeedsAttentionItem[];
  homework: HomeworkSummary;
  setup: SetupStatus;
  /** Most recent days with activity (up to 2). */
  activity: ActivityDay[];
  last_conversation_id: string | null;
}

// ---------- Days & streaks ----------

/** YYYY-MM-DD of an instant in a zone given as Date.getTimezoneOffset() minutes. */
export function dayKey(iso: string | Date, tzOffsetMinutes: number): string {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  const shifted = new Date(t - tzOffsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive days with activity ending today or yesterday (a day that is not
 * over yet does not break the streak).
 */
export function computeStreak(dayKeys: Iterable<string>, today: string): number {
  const days = new Set(dayKeys);
  let cursor = days.has(today) ? today : addDays(today, -1);
  if (!days.has(cursor)) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function computeStudyStatus(rows: ActivityRow[], tzOffsetMinutes: number, now: Date = new Date()): StudyStatus {
  const today = dayKey(now, tzOffsetMinutes);
  const byDay = new Map<string, ActivityRow[]>();
  let last: string | null = null;
  for (const r of rows) {
    const k = dayKey(r.reviewed_at, tzOffsetMinutes);
    const list = byDay.get(k) ?? [];
    list.push(r);
    byDay.set(k, list);
    if (!last || r.reviewed_at > last) last = r.reviewed_at;
  }
  const todayRows = byDay.get(today) ?? [];
  const correct = todayRows.filter((r) => r.rating >= 2).length;
  return {
    last_studied_at: last,
    studied_today: todayRows.length > 0,
    streak_days: computeStreak(byDay.keys(), today),
    active_days_30: byDay.size,
    today: {
      reviews: todayRows.length,
      accuracy: todayRows.length ? round(correct / todayRows.length) : null,
      time_ms: todayRows.reduce((s, r) => s + (r.time_spent_ms ?? 0), 0),
    },
  };
}

/** Per-day activity, newest first, at most `limit` days. */
export function recentActivityDays(rows: ActivityRow[], tzOffsetMinutes: number, limit = 2): ActivityDay[] {
  const byDay = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const k = dayKey(r.reviewed_at, tzOffsetMinutes);
    const list = byDay.get(k) ?? [];
    list.push(r);
    byDay.set(k, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .slice(0, limit)
    .map(([day, list]) => ({
      day,
      reviews: list.length,
      accuracy: round(list.filter((r) => r.rating >= 2).length / list.length),
      time_ms: list.reduce((s, r) => s + (r.time_spent_ms ?? 0), 0),
    }));
}

// ---------- Homework ----------

/**
 * Blended homework progress. Each card counts 0 (new), ½ (started) or 1
 * (mastered, stability > 21 days); each assigned lesson counts 1 once it has
 * been completed at least once. Pure mastery would read 0% for weeks after a
 * student started, which tells the tutor nothing, so "started" earns half.
 */
export function homeworkPercent(s: {
  cards_total: number;
  cards_started: number;
  cards_mastered: number;
  lessons_total: number;
  lessons_completed: number;
}): number | null {
  const denominator = s.cards_total + s.lessons_total;
  if (denominator === 0) return null;
  const startedNotMastered = Math.max(0, s.cards_started - s.cards_mastered);
  const score = s.cards_mastered + startedNotMastered * 0.5 + s.lessons_completed;
  return Math.round((100 * score) / denominator);
}

export function summarizeHomework(
  decks: HomeworkDeckInput[],
  lessons: HomeworkLessonInput[],
  budget: Pick<StudyBudget, 'new_cards_per_day'> = DEFAULT_STUDY_BUDGET,
  deckQueue: { id: string }[] = []
): HomeworkSummary {
  const queueIndex = new Map(deckQueue.map((d, i) => [d.id, i + 1]));
  const cards_total = decks.reduce((s, d) => s + d.cards_total, 0);
  const cards_started = decks.reduce((s, d) => s + d.cards_started, 0);
  const cards_mastered = decks.reduce((s, d) => s + d.cards_mastered, 0);
  const lessons_completed = lessons.filter((l) => l.completions > 0).length;
  const totals = { cards_total, cards_started, cards_mastered, lessons_total: lessons.length, lessons_completed };
  return {
    percent: homeworkPercent(totals),
    ...totals,
    decks: decks.map((d) => {
      const words_to_go = Math.max(0, (d.notes_total ?? 0) - (d.notes_introduced ?? 0));
      return {
        ...d,
        percent_started: d.cards_total ? Math.round((100 * d.cards_started) / d.cards_total) : 0,
        percent_mastered: d.cards_total ? Math.round((100 * d.cards_mastered) / d.cards_total) : 0,
        words_to_go,
        days_to_go: daysToIntroduce(words_to_go, budget),
        queue_position: queueIndex.get(d.target_deck_id) ?? null,
        queue_total: deckQueue.length,
      };
    }),
    lessons,
  };
}

// ---------- Needs attention ----------

export function pickNeedsAttention(
  struggling: StrugglingNote[],
  recordings: InsightRecording[],
  limit = 3
): NeedsAttentionItem[] {
  const unheardByNote = new Map<string, InsightRecording[]>();
  for (const r of recordings) {
    if (r.mark) continue;
    const list = unheardByNote.get(r.note.id) ?? [];
    list.push(r);
    unheardByNote.set(r.note.id, list);
  }
  const items: NeedsAttentionItem[] = struggling.map((s) => {
    const unheard = unheardByNote.get(s.note.id) ?? [];
    const newest = unheard[0] ?? null; // listRecordings() is newest first
    return {
      note: s.note,
      attempts: s.attempts,
      again_count: s.again_count,
      hard_count: s.hard_count,
      wrong_answers: s.wrong_answers,
      wrong_typed_count: s.wrong_typed_count,
      last_reviewed_at: s.last_reviewed_at,
      recording: newest ? { event_id: newest.event_id, recording_url: newest.recording_url } : null,
      recordings_unheard: unheard.length,
    };
  });
  // Words with an unheard recording but no struggle signal still deserve a
  // row when there is room — the tutor asked to hear them.
  const covered = new Set(items.map((i) => i.note.id));
  for (const [noteId, list] of unheardByNote) {
    if (items.length >= limit) break;
    if (covered.has(noteId)) continue;
    const newest = list[0];
    items.push({
      note: newest.note,
      attempts: list.length,
      again_count: list.filter((r) => r.rating === 0).length,
      hard_count: list.filter((r) => r.rating === 1).length,
      wrong_answers: [],
      wrong_typed_count: 0,
      last_reviewed_at: newest.reviewed_at,
      recording: { event_id: newest.event_id, recording_url: newest.recording_url },
      recordings_unheard: list.length,
    });
  }
  return items.slice(0, limit);
}

// ---------- Setup checklist ----------

export function deriveSetup(input: {
  student: StudentUserRow;
  homework: HomeworkSummary;
  first_review_at: string | null;
  audio_total: number;
  invite: InviteRef | null;
}): SetupStatus {
  const { student, homework, first_review_at, audio_total, invite } = input;
  const signedIn = !!student.last_login_at;
  const homeworkCount = homework.decks.length + homework.lessons.length;
  const firstDeck = homework.decks[0]?.source_deck_name ?? null;
  const installed = student.install_kind === 'pwa' || student.install_kind === 'android';

  const steps: SetupStep[] = [
    {
      key: 'signed_in',
      title: 'Signed in with Google',
      done: signedIn,
      detail: signedIn
        ? [student.email, student.last_login_at].filter(Boolean).join(' · ')
        : 'Not yet — the link has not been used',
    },
    {
      key: 'homework',
      title: 'Homework received',
      done: homeworkCount > 0,
      detail:
        homeworkCount > 0
          ? [
              firstDeck,
              homework.decks.length > 1 ? `+${homework.decks.length - 1} more deck${homework.decks.length > 2 ? 's' : ''}` : null,
              homework.lessons.length ? `${homework.lessons.length} lesson${homework.lessons.length === 1 ? '' : 's'}` : null,
              invite ? 'copied automatically from your invite' : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Nothing shared yet — send a deck or a lesson',
    },
    {
      key: 'installed',
      title: 'Installed the app (Android app or home-screen shortcut)',
      done: installed,
      detail:
        student.install_kind === 'android'
          ? 'Using the Android app'
          : student.install_kind === 'pwa'
            ? 'Opens from the home screen'
            : student.install_kind === 'browser'
              ? 'Last opened in a browser tab'
              : 'Not opened on a phone yet',
    },
    {
      key: 'first_session',
      title: 'First study session',
      done: !!first_review_at,
      detail: first_review_at ? `First card reviewed ${first_review_at}` : 'Not yet — nudge them?',
    },
  ];

  return {
    steps,
    done_count: steps.filter((s) => s.done).length,
    install_kind: student.install_kind ?? null,
    audio: { cached: student.cached_audio_count ?? null, total: audio_total },
    last_opened_at: student.last_opened_at ?? null,
    invite,
  };
}

// ---------- Whole card ----------

export function buildStudentOverview(input: StudentOverviewInput): StudentOverview {
  const now = input.now ?? new Date();
  const status = computeStudyStatus(input.activity_rows, input.tz_offset_minutes, now);
  const struggling = rankStruggling(input.week_rows);
  const recordings = listRecordings(input.week_rows, input.week_marks);
  const homework = summarizeHomework(
    input.homework_decks,
    input.homework_lessons,
    { new_cards_per_day: input.student.new_cards_per_day ?? DEFAULT_STUDY_BUDGET.new_cards_per_day },
    input.deck_queue ?? []
  );
  const setup = deriveSetup({
    student: input.student,
    homework,
    first_review_at: input.first_review_at,
    audio_total: input.audio_total,
    invite: input.invite,
  });
  const { id, email, name, picture_url } = input.student;
  return {
    relationship_id: input.relationship_id,
    student: { id, email, name, picture_url },
    joined_at: input.joined_at,
    joined_via_invite: !!input.invite,
    is_new: input.total_reviews === 0,
    status,
    pills: {
      struggling_words: struggling.length,
      recordings_to_hear: input.unheard_recordings,
      homework_percent: homework.percent,
    },
    needs_attention: pickNeedsAttention(struggling, recordings),
    homework,
    setup,
    activity: recentActivityDays(input.activity_rows, input.tz_offset_minutes),
    last_conversation_id: input.last_conversation_id,
  };
}

/** Clamp a client-supplied timezone offset to something sane (minutes). */
export function parseTzOffset(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-14 * 60, Math.min(14 * 60, Math.round(n)));
}
