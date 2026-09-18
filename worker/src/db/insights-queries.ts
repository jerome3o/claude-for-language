/**
 * Database access for the tutor "Student Insights" feature: lesson log,
 * narrative summaries, recording marks, and the review-event fetches that
 * feed services/insights.ts. All SQL for the feature lives here.
 */

import type { CardType } from '../types';
import type {
  InsightReviewRow,
  InsightCardState,
  InsightActivity,
  RecordingMark,
} from '../services/insights';

// ---------- Lesson log ----------

export interface TutorLessonLogEntry {
  id: string;
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  lesson_at: string;
  notes: string | null;
  created_at: string;
}

export async function listLessonLog(db: D1Database, relationshipId: string, limit = 100): Promise<TutorLessonLogEntry[]> {
  const res = await db
    .prepare(
      `SELECT id, relationship_id, tutor_id, student_id, lesson_at, notes, created_at
       FROM tutor_lesson_log WHERE relationship_id = ?
       ORDER BY lesson_at DESC, created_at DESC LIMIT ?`
    )
    .bind(relationshipId, limit)
    .all<TutorLessonLogEntry>();
  return res.results || [];
}

export async function getLatestLessonAt(db: D1Database, relationshipId: string): Promise<{ id: string; lesson_at: string } | null> {
  return db
    .prepare(`SELECT id, lesson_at FROM tutor_lesson_log WHERE relationship_id = ? ORDER BY lesson_at DESC LIMIT 1`)
    .bind(relationshipId)
    .first<{ id: string; lesson_at: string }>();
}

export async function createLessonLogEntry(
  db: D1Database,
  entry: { relationship_id: string; tutor_id: string; student_id: string; lesson_at: string; notes: string | null }
): Promise<TutorLessonLogEntry> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO tutor_lesson_log (id, relationship_id, tutor_id, student_id, lesson_at, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, entry.relationship_id, entry.tutor_id, entry.student_id, entry.lesson_at, entry.notes)
    .run();
  const row = await db
    .prepare(`SELECT id, relationship_id, tutor_id, student_id, lesson_at, notes, created_at FROM tutor_lesson_log WHERE id = ?`)
    .bind(id)
    .first<TutorLessonLogEntry>();
  return row ?? { id, created_at: new Date().toISOString(), ...entry };
}

export async function deleteLessonLogEntry(db: D1Database, relationshipId: string, id: string): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM tutor_lesson_log WHERE id = ? AND relationship_id = ?`)
    .bind(id, relationshipId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Push the tutor's lesson notes into the student's own Lesson Notes (migration 0040). */
export async function createStudentLessonNote(
  db: D1Database,
  studentId: string,
  rawText: string,
  givenAt: string | null
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO lesson_notes (id, user_id, raw_text, given_at) VALUES (?, ?, ?, ?)`)
    .bind(id, studentId, rawText, givenAt)
    .run();
  return id;
}

// ---------- Summaries ----------

export interface StudentSummaryRow {
  id: string;
  relationship_id: string;
  range_from: string;
  range_to: string;
  narrative_en: string;
  narrative_zh: string;
  stats_json: string | null;
  created_at: string;
}

export async function createStudentSummary(
  db: D1Database,
  s: { relationship_id: string; range_from: string; range_to: string; narrative_en: string; narrative_zh: string; stats_json: string | null }
): Promise<StudentSummaryRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO student_summaries (id, relationship_id, range_from, range_to, narrative_en, narrative_zh, stats_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, s.relationship_id, s.range_from, s.range_to, s.narrative_en, s.narrative_zh, s.stats_json)
    .run();
  const row = await db.prepare(`SELECT * FROM student_summaries WHERE id = ?`).bind(id).first<StudentSummaryRow>();
  return row ?? { id, created_at: new Date().toISOString(), ...s };
}

export async function listStudentSummaries(db: D1Database, relationshipId: string, limit = 20): Promise<StudentSummaryRow[]> {
  const res = await db
    .prepare(`SELECT * FROM student_summaries WHERE relationship_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(relationshipId, limit)
    .all<StudentSummaryRow>();
  return res.results || [];
}

// ---------- Recording marks ----------

export async function getReviewEventOwner(db: D1Database, eventId: string): Promise<{ user_id: string; recording_url: string | null } | null> {
  return db
    .prepare(`SELECT user_id, recording_url FROM review_events WHERE id = ?`)
    .bind(eventId)
    .first<{ user_id: string; recording_url: string | null }>();
}

export async function upsertRecordingMark(
  db: D1Database,
  mark: { review_event_id: string; tutor_id: string; status: 'listened' | 'needs_work'; comment: string | null }
): Promise<RecordingMark> {
  await db
    .prepare(
      `INSERT INTO tutor_recording_marks (review_event_id, tutor_id, status, comment)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(review_event_id) DO UPDATE SET
         tutor_id = excluded.tutor_id,
         status = excluded.status,
         comment = excluded.comment,
         updated_at = datetime('now')`
    )
    .bind(mark.review_event_id, mark.tutor_id, mark.status, mark.comment)
    .run();
  const row = await db
    .prepare(`SELECT review_event_id, status, comment, updated_at FROM tutor_recording_marks WHERE review_event_id = ?`)
    .bind(mark.review_event_id)
    .first<RecordingMark>();
  return row ?? { review_event_id: mark.review_event_id, status: mark.status, comment: mark.comment, updated_at: new Date().toISOString() };
}

export async function deleteRecordingMark(db: D1Database, eventId: string): Promise<void> {
  await db.prepare(`DELETE FROM tutor_recording_marks WHERE review_event_id = ?`).bind(eventId).run();
}

/** Marks on every recording the student made in the range (one join, no IN-list). */
export async function fetchRecordingMarks(db: D1Database, studentId: string, from: string, to: string): Promise<RecordingMark[]> {
  const res = await db
    .prepare(
      `SELECT m.review_event_id, m.status, m.comment, m.updated_at
       FROM tutor_recording_marks m
       JOIN review_events re ON re.id = m.review_event_id
       WHERE re.user_id = ? AND re.reviewed_at >= ? AND re.reviewed_at <= ? AND re.recording_url IS NOT NULL`
    )
    .bind(studentId, from, to)
    .all<RecordingMark>();
  return res.results || [];
}

// ---------- Review rows for the insights report ----------

const REVIEW_ROW_SELECT = `
  SELECT re.id AS event_id, re.card_id, c.card_type, n.id AS note_id,
         n.hanzi, n.pinyin, n.english, d.id AS deck_id, d.name AS deck_name,
         re.rating, re.time_spent_ms, re.user_answer, re.recording_url, re.reviewed_at
  FROM review_events re
  JOIN cards c ON c.id = re.card_id
  JOIN notes n ON n.id = c.note_id
  JOIN decks d ON d.id = n.deck_id`;

/** Every review event in the range, newest first. Capped so a huge range cannot blow the response. */
export async function fetchReviewRows(
  db: D1Database,
  studentId: string,
  from: string,
  to: string,
  limit = 20000
): Promise<InsightReviewRow[]> {
  const res = await db
    .prepare(
      `${REVIEW_ROW_SELECT}
       WHERE re.user_id = ? AND re.reviewed_at >= ? AND re.reviewed_at <= ?
       ORDER BY re.reviewed_at DESC, re.id DESC
       LIMIT ?`
    )
    .bind(studentId, from, to, limit)
    .all<InsightReviewRow>();
  return res.results || [];
}

/** Notes whose very first review (ever) falls inside the range. */
export async function countNewWordsIntroduced(db: D1Database, studentId: string, from: string, to: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT c.note_id AS note_id, MIN(re.reviewed_at) AS first_at
         FROM review_events re JOIN cards c ON c.id = re.card_id
         WHERE re.user_id = ?
         GROUP BY c.note_id
       ) WHERE first_at >= ? AND first_at <= ?`
    )
    .bind(studentId, from, to)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Cached card state for every note the student touched in the range. */
export async function fetchCardStatesForRange(db: D1Database, studentId: string, from: string, to: string): Promise<InsightCardState[]> {
  const res = await db
    .prepare(
      `SELECT c.note_id, c.card_type, COALESCE(c.queue, 0) AS queue, COALESCE(c.interval, 0) AS interval
       FROM cards c
       WHERE c.note_id IN (
         SELECT DISTINCT c2.note_id FROM review_events re JOIN cards c2 ON c2.id = re.card_id
         WHERE re.user_id = ? AND re.reviewed_at >= ? AND re.reviewed_at <= ?
       )`
    )
    .bind(studentId, from, to)
    .all<InsightCardState>();
  return res.results || [];
}

/** Lessons, readers and quests the student completed in the range. */
export async function fetchActivity(db: D1Database, studentId: string, from: string, to: string): Promise<InsightActivity> {
  const [lessons, readers, quests] = await Promise.all([
    db
      .prepare(
        `SELECT cl.id AS lesson_id, cl.title, clc.rating, clc.completed_at
         FROM custom_lesson_completions clc JOIN custom_lessons cl ON cl.id = clc.lesson_id
         WHERE clc.user_id = ? AND clc.completed_at >= ? AND clc.completed_at <= ?
         ORDER BY clc.completed_at DESC LIMIT 200`
      )
      .bind(studentId, from, to)
      .all<InsightActivity['lessons'][number]>(),
    db
      .prepare(
        `SELECT rre.reader_id, gr.title_chinese, gr.title_english, rre.rating, rre.reviewed_at
         FROM reader_review_events rre JOIN graded_readers gr ON gr.id = rre.reader_id
         WHERE rre.user_id = ? AND rre.reviewed_at >= ? AND rre.reviewed_at <= ?
         ORDER BY rre.reviewed_at DESC LIMIT 200`
      )
      .bind(studentId, from, to)
      .all<InsightActivity['readers'][number]>(),
    db
      .prepare(
        `SELECT id AS quest_id, title, completed_at, best_moves
         FROM quests
         WHERE user_id = ? AND completed_at IS NOT NULL AND completed_at >= ? AND completed_at <= ?
         ORDER BY completed_at DESC LIMIT 200`
      )
      .bind(studentId, from, to)
      .all<InsightActivity['quests'][number]>(),
  ]);
  return {
    lessons: lessons.results || [],
    readers: readers.results || [],
    quests: quests.results || [],
  };
}

// ---------- History explorer ----------

export interface HistoryFilters {
  from: string;
  to: string;
  deck_id?: string | null;
  card_type?: CardType | null;
  rating?: number | null;
  q?: string | null;
  cursor?: string | null;
  limit: number;
}

export interface HistoryPage {
  events: InsightReviewRow[];
  next_cursor: string | null;
}

/** Encode a keyset cursor from the last row of a page. */
export function encodeHistoryCursor(row: InsightReviewRow): string {
  return `${row.reviewed_at}|${row.event_id}`;
}

export function decodeHistoryCursor(cursor: string | null | undefined): { reviewed_at: string; event_id: string } | null {
  if (!cursor) return null;
  const i = cursor.lastIndexOf('|');
  if (i <= 0) return null;
  return { reviewed_at: cursor.slice(0, i), event_id: cursor.slice(i + 1) };
}

export async function fetchHistoryPage(db: D1Database, studentId: string, f: HistoryFilters): Promise<HistoryPage> {
  const where: string[] = ['re.user_id = ?', 're.reviewed_at >= ?', 're.reviewed_at <= ?'];
  const params: unknown[] = [studentId, f.from, f.to];
  if (f.deck_id) {
    where.push('d.id = ?');
    params.push(f.deck_id);
  }
  if (f.card_type) {
    where.push('c.card_type = ?');
    params.push(f.card_type);
  }
  if (f.rating != null) {
    where.push('re.rating = ?');
    params.push(f.rating);
  }
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`;
    where.push('(n.hanzi LIKE ? OR n.pinyin LIKE ? OR n.english LIKE ?)');
    params.push(like, like, like);
  }
  const cursor = decodeHistoryCursor(f.cursor);
  if (cursor) {
    where.push('(re.reviewed_at < ? OR (re.reviewed_at = ? AND re.id < ?))');
    params.push(cursor.reviewed_at, cursor.reviewed_at, cursor.event_id);
  }
  const limit = Math.max(1, Math.min(500, f.limit));
  params.push(limit + 1);

  const res = await db
    .prepare(
      `${REVIEW_ROW_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY re.reviewed_at DESC, re.id DESC
       LIMIT ?`
    )
    .bind(...params)
    .all<InsightReviewRow>();
  const rows = res.results || [];
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return {
    events,
    next_cursor: hasMore && events.length ? encodeHistoryCursor(events[events.length - 1]) : null,
  };
}

/** Decks that appear in the student's history — for the filter dropdown. */
export async function fetchStudentDecks(db: D1Database, studentId: string): Promise<Array<{ id: string; name: string }>> {
  const res = await db
    .prepare(`SELECT id, name FROM decks WHERE user_id = ? ORDER BY name`)
    .bind(studentId)
    .all<{ id: string; name: string }>();
  return res.results || [];
}
