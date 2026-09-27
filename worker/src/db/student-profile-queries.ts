/**
 * student_profiles (migration 0076): the tutor's private profile of a student,
 * one row per tutor_relationship. Only the tutor-only route
 * (routes/student-profile.ts), the tutor dashboard's `has_profile` flag and the
 * tutor-side content agents read it — never a student-facing path.
 */
import type { StudentLevel, StudentProfile, StudentProfileFields } from '@shared/students';
import { isStudentLevel } from '@shared/students';

interface Row {
  relationship_id: string;
  body: string;
  level: string | null;
  handwriting: number | null;
  words_per_lesson: number | null;
  updated_at: string;
}

function toProfile(row: Row): StudentProfile {
  return {
    relationship_id: row.relationship_id,
    body: row.body ?? '',
    level: isStudentLevel(row.level) ? (row.level as StudentLevel) : null,
    handwriting: row.handwriting == null ? null : row.handwriting === 1,
    words_per_lesson: row.words_per_lesson ?? null,
    updated_at: row.updated_at,
  };
}

/**
 * The profile the TUTOR wrote for this relationship. The tutor id is part of
 * the lookup, so a caller that passes the student's id gets nothing.
 */
export async function getStudentProfile(db: D1Database, relationshipId: string, tutorId: string): Promise<StudentProfile | null> {
  const row = await db
    .prepare(
      `SELECT relationship_id, body, level, handwriting, words_per_lesson, updated_at
       FROM student_profiles WHERE relationship_id = ? AND tutor_id = ?`
    )
    .bind(relationshipId, tutorId)
    .first<Row>();
  return row ? toProfile(row) : null;
}

export async function upsertStudentProfile(
  db: D1Database,
  ids: { relationshipId: string; tutorId: string; studentId: string },
  fields: StudentProfileFields
): Promise<StudentProfile> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO student_profiles (relationship_id, tutor_id, student_id, body, level, handwriting, words_per_lesson, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(relationship_id) DO UPDATE SET
         tutor_id = excluded.tutor_id,
         student_id = excluded.student_id,
         body = excluded.body,
         level = excluded.level,
         handwriting = excluded.handwriting,
         words_per_lesson = excluded.words_per_lesson,
         updated_at = excluded.updated_at`
    )
    .bind(
      ids.relationshipId,
      ids.tutorId,
      ids.studentId,
      fields.body,
      fields.level,
      fields.handwriting == null ? null : fields.handwriting ? 1 : 0,
      fields.words_per_lesson,
      now,
      now
    )
    .run();
  return { relationship_id: ids.relationshipId, ...fields, updated_at: now };
}

export async function deleteStudentProfile(db: D1Database, relationshipId: string, tutorId: string): Promise<void> {
  await db.prepare(`DELETE FROM student_profiles WHERE relationship_id = ? AND tutor_id = ?`).bind(relationshipId, tutorId).run();
}

/** Has this tutor written a (non-empty) profile for the relationship? — the dashboard's quiet hint. */
export async function hasStudentProfile(db: D1Database, relationshipId: string, tutorId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM student_profiles
       WHERE relationship_id = ? AND tutor_id = ?
         AND (TRIM(body) != '' OR level IS NOT NULL OR handwriting IS NOT NULL OR words_per_lesson IS NOT NULL)`
    )
    .bind(relationshipId, tutorId)
    .first<{ ok: number }>();
  return !!row;
}
