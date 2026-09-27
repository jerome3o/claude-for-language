/**
 * SQL for lesson attempts (per-exercise answers + time) and the recordings
 * made during them. Migration 0073.
 */

import type { LessonAttemptData } from '@shared/lesson';

export interface LessonAttemptRow {
  id: string;
  user_id: string;
  lesson_id: string;
  started_at: string | null;
  completed_at: string;
  duration_ms: number;
  correct: number | null;
  total: number | null;
  rating: number | null;
  spec: string;
  data: string;
  created_at: string;
}

export interface LessonAttemptMediaRow {
  attempt_id: string;
  media_key: string;
  user_id: string;
  audio_key: string;
  content_type: string | null;
  size: number | null;
  transcript_status: string;
  transcript: string | null;
  transcript_translation: string | null;
  created_at: string;
}

/**
 * Store an attempt (idempotent by id). The spec is snapshotted from the
 * lesson row, so the attempt keeps the questions it answered. Returns false
 * when the lesson isn't the user's or the attempt already exists.
 */
export async function insertLessonAttempt(
  db: D1Database,
  userId: string,
  event: { id: string; lesson_id: string; correct: number; total: number; completed_at: string; rating?: number | null },
  data: LessonAttemptData,
): Promise<boolean> {
  const r = await db.prepare(`
    INSERT OR IGNORE INTO custom_lesson_attempts
      (id, user_id, lesson_id, started_at, completed_at, duration_ms, correct, total, rating, spec, data)
    SELECT ?, ?, l.id, ?, ?, ?, ?, ?, ?, l.spec, ?
    FROM custom_lessons l WHERE l.id = ? AND l.user_id = ?
  `).bind(
    event.id, userId, data.started_at || null, event.completed_at, data.duration_ms,
    event.correct, event.total, typeof event.rating === 'number' ? event.rating : null,
    JSON.stringify(data), event.lesson_id, userId,
  ).run();
  return (r.meta?.changes ?? 0) > 0;
}

export interface AttemptSummaryRow {
  id: string;
  lesson_id: string;
  lesson_title: string;
  lesson_icon: string | null;
  started_at: string | null;
  completed_at: string;
  duration_ms: number;
  correct: number | null;
  total: number | null;
  rating: number | null;
  recordings: number;
}

/** A user's attempts newest first (optionally one lesson's). */
export async function listLessonAttempts(
  db: D1Database,
  userId: string,
  opts: { lessonId?: string; limit?: number } = {},
): Promise<AttemptSummaryRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const r = await db.prepare(`
    SELECT a.id, a.lesson_id, l.title AS lesson_title, l.icon AS lesson_icon, a.started_at, a.completed_at,
           a.duration_ms, a.correct, a.total, a.rating,
           (SELECT COUNT(*) FROM custom_lesson_attempt_media m WHERE m.attempt_id = a.id) AS recordings
    FROM custom_lesson_attempts a
    JOIN custom_lessons l ON l.id = a.lesson_id
    WHERE a.user_id = ? ${opts.lessonId ? 'AND a.lesson_id = ?' : ''}
    ORDER BY a.completed_at DESC
    LIMIT ${limit}
  `).bind(...(opts.lessonId ? [userId, opts.lessonId] : [userId])).all<AttemptSummaryRow>();
  return r.results;
}

export async function getLessonAttempt(db: D1Database, attemptId: string, userId: string): Promise<LessonAttemptRow | null> {
  return (await db.prepare(`SELECT * FROM custom_lesson_attempts WHERE id = ? AND user_id = ?`)
    .bind(attemptId, userId).first<LessonAttemptRow>()) ?? null;
}

export async function listAttemptMedia(db: D1Database, attemptId: string): Promise<LessonAttemptMediaRow[]> {
  const r = await db.prepare(`SELECT * FROM custom_lesson_attempt_media WHERE attempt_id = ? ORDER BY media_key`)
    .bind(attemptId).all<LessonAttemptMediaRow>();
  return r.results;
}

export async function getAttemptMedia(db: D1Database, attemptId: string, mediaKey: string): Promise<LessonAttemptMediaRow | null> {
  return (await db.prepare(`SELECT * FROM custom_lesson_attempt_media WHERE attempt_id = ? AND media_key = ?`)
    .bind(attemptId, mediaKey).first<LessonAttemptMediaRow>()) ?? null;
}

export async function upsertAttemptMedia(
  db: D1Database,
  row: { attempt_id: string; media_key: string; user_id: string; audio_key: string; content_type: string | null; size: number },
): Promise<void> {
  await db.prepare(`
    INSERT INTO custom_lesson_attempt_media (attempt_id, media_key, user_id, audio_key, content_type, size, transcript_status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT (attempt_id, media_key) DO UPDATE SET
      audio_key = excluded.audio_key, content_type = excluded.content_type, size = excluded.size,
      transcript_status = 'pending', transcript = NULL, transcript_translation = NULL
  `).bind(row.attempt_id, row.media_key, row.user_id, row.audio_key, row.content_type, row.size).run();
}

export async function setAttemptMediaTranscript(
  db: D1Database,
  attemptId: string,
  mediaKey: string,
  status: 'done' | 'failed' | 'skipped',
  transcript: string | null,
  translation: string | null,
): Promise<void> {
  await db.prepare(`
    UPDATE custom_lesson_attempt_media SET transcript_status = ?, transcript = ?, transcript_translation = ?
    WHERE attempt_id = ? AND media_key = ?
  `).bind(status, transcript, translation, attemptId, mediaKey).run();
}

/** Latest attempt id per lesson, for linking a lesson row to its review. */
export async function latestAttemptIds(db: D1Database, lessonIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < lessonIds.length; i += 50) {
    const chunk = lessonIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    const r = await db.prepare(`
      SELECT a.lesson_id, a.id FROM custom_lesson_attempts a
      WHERE a.lesson_id IN (${chunk.map(() => '?').join(',')})
        AND a.completed_at = (SELECT MAX(b.completed_at) FROM custom_lesson_attempts b WHERE b.lesson_id = a.lesson_id)
    `).bind(...chunk).all<{ lesson_id: string; id: string }>();
    for (const row of r.results) out.set(row.lesson_id, row.id);
  }
  return out;
}
