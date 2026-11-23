/**
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening"): the learner's "Too hard" /
 * back a section / next section presses on an audio lesson, stored idempotently by client id
 * (table audio_lesson_feedback, migration 0157), and read back grouped per lesson with a summary
 * (shared/audio-lesson/feedback.ts `summarizeLessonFeedback`) for Claude (MCP get_audio_lesson_feedback).
 */
import {
  MAX_FEEDBACK_EVENTS_PER_REQUEST,
  pickFeedbackEvent,
  summarizeLessonFeedback,
  type AudioLessonFeedbackEvent,
  type FeedbackRowSnapshot,
  type LessonFeedbackSummary,
} from '@shared/audio-lesson/feedback';

export { MAX_FEEDBACK_EVENTS_PER_REQUEST };

export interface AddFeedbackResult {
  accepted: string[];
  stored: number;
  rejected: string[];
}

/** Store a lesson's events (the caller's own lesson; checked by the route). Idempotent by id. */
export async function addAudioLessonFeedback(db: D1Database, userId: string, lessonId: string, raw: unknown[], now = new Date()): Promise<AddFeedbackResult> {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const events: AudioLessonFeedbackEvent[] = [];
  for (const r of raw) {
    const e = pickFeedbackEvent(r, lessonId);
    if (e) {
      events.push(e);
      accepted.push(e.id);
    } else {
      const id = r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' ? (r as { id: string }).id : '';
      rejected.push(id);
    }
  }
  if (events.length === 0) return { accepted, stored: 0, rejected };
  // Another account's id (or another lesson's) is never overwritten: INSERT OR IGNORE, then count what is ours.
  const received = now.toISOString();
  const results = await db.batch(events.map((e) => db.prepare(
    `INSERT OR IGNORE INTO audio_lesson_feedback
       (id, user_id, audio_lesson_id, kind, source, position_ms, chapter_index, row_index, row_json, previous_row_json, speed, audio_version, created_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    e.id, userId, lessonId, e.kind, e.where, e.position_ms, e.chapter_index, e.row_index,
    e.row ? JSON.stringify(e.row) : null, e.previous_row ? JSON.stringify(e.previous_row) : null,
    e.speed, e.audio_version, e.created_at, received,
  )));
  const stored = results.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0);
  return { accepted, stored, rejected };
}

interface FeedbackDbRow {
  id: string;
  audio_lesson_id: string;
  kind: AudioLessonFeedbackEvent['kind'];
  source: AudioLessonFeedbackEvent['where'] | null;
  position_ms: number;
  chapter_index: number | null;
  row_index: number | null;
  row_json: string | null;
  previous_row_json: string | null;
  speed: number | null;
  audio_version: string | null;
  created_at: string;
  received_at: string;
}

function snap(json: string | null): FeedbackRowSnapshot | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as FeedbackRowSnapshot;
  } catch {
    return null;
  }
}

function toEvent(r: FeedbackDbRow): AudioLessonFeedbackEvent {
  return {
    id: r.id,
    audio_lesson_id: r.audio_lesson_id,
    kind: r.kind,
    where: r.source ?? 'player',
    position_ms: r.position_ms,
    chapter_index: r.chapter_index ?? 0,
    row_index: r.row_index ?? -1,
    row: snap(r.row_json),
    previous_row: snap(r.previous_row_json),
    speed: r.speed ?? 1,
    audio_version: r.audio_version,
    created_at: r.created_at,
  };
}

export interface LessonFeedback {
  lesson: {
    id: string;
    title: string;
    format: string;
    status: string;
    duration_ms: number | null;
    listened_at: string | null;
    created_at: string;
  };
  /** Oldest first. */
  events: AudioLessonFeedbackEvent[];
  summary: LessonFeedbackSummary;
}

export const MAX_FEEDBACK_EVENTS_LISTED = 2000;

/**
 * The caller's feedback, grouped per lesson (the lesson with the newest press first). `since` = only
 * events the server received after it (ISO); `cursor` = the newest received_at listed (pass it as
 * `since` next time).
 */
export async function listAudioLessonFeedback(
  db: D1Database,
  userId: string,
  opts: { lessonId?: string | null; since?: string | null; limit?: number } = {},
): Promise<{ lessons: LessonFeedback[]; cursor: string | null; more: boolean }> {
  const limit = Math.max(1, Math.min(MAX_FEEDBACK_EVENTS_LISTED, Math.floor(opts.limit ?? MAX_FEEDBACK_EVENTS_LISTED)));
  const where = ['f.user_id = ?'];
  const binds: unknown[] = [userId];
  if (opts.lessonId) {
    where.push('f.audio_lesson_id = ?');
    binds.push(opts.lessonId);
  }
  if (opts.since) {
    where.push('f.received_at > ?');
    binds.push(opts.since);
  }
  // The newest `limit` events (by when they were received), then put back in pressing order.
  const { results } = await db.prepare(
    `SELECT f.* FROM audio_lesson_feedback f WHERE ${where.join(' AND ')} ORDER BY f.received_at DESC, f.created_at DESC LIMIT ?`,
  ).bind(...binds, limit + 1).all<FeedbackDbRow>();
  const rows = results ?? [];
  const more = rows.length > limit;
  const kept = rows.slice(0, limit);
  const cursor = kept.reduce<string | null>((m, r) => (!m || r.received_at > m ? r.received_at : m), null);
  const byLesson = new Map<string, FeedbackDbRow[]>();
  for (const r of kept) byLesson.set(r.audio_lesson_id, [...(byLesson.get(r.audio_lesson_id) ?? []), r]);
  if (byLesson.size === 0) return { lessons: [], cursor, more };

  const ids = [...byLesson.keys()];
  const { results: lessonRows } = await db.prepare(
    `SELECT id, title, format, status, duration_ms, listened_at, created_at FROM audio_lessons WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
  ).bind(userId, ...ids).all<LessonFeedback['lesson']>();
  const lessons: LessonFeedback[] = [];
  for (const l of lessonRows ?? []) {
    const events = (byLesson.get(l.id) ?? []).map(toEvent).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.position_ms - b.position_ms);
    lessons.push({ lesson: { ...l, format: l.format ?? 'dialogue' }, events, summary: summarizeLessonFeedback(events) });
  }
  const latest = (x: LessonFeedback) => x.events[x.events.length - 1]?.created_at ?? '';
  lessons.sort((a, b) => latest(b).localeCompare(latest(a)));
  return { lessons, cursor, more };
}
