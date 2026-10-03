/**
 * The tutor's homework library and "update the students' copies"
 * (docs/HOMEWORK.md §9–10). The rows are built by the shared, unit-tested
 * `buildHomeworkLibrary` from what already exists: share rows + assignments.
 */

import type { Env, TutorRelationshipWithUsers } from '../types';
import { buildHomeworkLibrary, sortLibrary, type LibraryItem, type LibraryKind } from '@shared/homework';
import * as hw from '../db/homework-queries';
import { fetchHomeworkDecks } from '../db/tutor-dashboard-queries';
import { getMyRelationships, getOtherUserId, updateSharedDeckCopy } from './relationships';
import { listSharedReaders, updateSharedReaderCopy } from './shared-readers';
import { pushLibraryLessonUpdate } from './lesson-push';
import { getLink } from '../db/homework-links-queries';
import { HomeworkError } from './homework';

interface StudentRef {
  relationship_id: string;
  student_id: string;
  student_name: string;
}

function studentOf(rel: TutorRelationshipWithUsers, tutorId: string): StudentRef {
  const studentId = getOtherUserId(rel, tutorId);
  const user = rel.requester.id === studentId ? rel.requester : rel.recipient;
  return { relationship_id: rel.id, student_id: studentId, student_name: user.name || user.email || 'Student' };
}

/** Lessons this tutor assigned to the student, with the library item behind each. */
async function fetchLibraryLessons(db: D1Database, relationshipId: string, tutorId: string, studentId: string) {
  const res = await db
    .prepare(
      `SELECT cl.id AS lesson_id, cl.library_item_id, cl.title, cl.created_at,
              (SELECT COUNT(*) FROM custom_lesson_completions x WHERE x.lesson_id = cl.id) AS completions,
              (SELECT MAX(completed_at) FROM custom_lesson_completions x WHERE x.lesson_id = cl.id) AS last_completed_at
       FROM custom_lessons cl
       WHERE cl.user_id = ? AND cl.assigned_by = ? AND (cl.assigned_relationship_id = ? OR cl.assigned_relationship_id IS NULL)`
    )
    .bind(studentId, tutorId, relationshipId)
    .all<{ lesson_id: string; library_item_id: string | null; title: string; created_at: string; completions: number; last_completed_at: string | null }>();
  return res.results || [];
}

/** Every item this tutor sent one student, newest first. */
export async function relationshipLibrary(db: D1Database, tutorId: string, student: StudentRef, today: string): Promise<LibraryItem[]> {
  const [assignments, decks, lessons, readers] = await Promise.all([
    hw.listRelationshipAssignments(db, student.relationship_id, 1000),
    fetchHomeworkDecks(db, student.relationship_id),
    fetchLibraryLessons(db, student.relationship_id, tutorId, student.student_id),
    listSharedReaders(db, student.relationship_id, tutorId),
  ]);
  const notes = await hw.listEventNotes(db, assignments.filter((a) => a.status !== 'cancelled').map((a) => a.id));
  return buildHomeworkLibrary({
    ...student,
    today,
    notes,
    assignments: assignments.filter((a) => a.tutor_id === tutorId),
    decks: decks.map((d) => ({
      share_id: d.shared_deck_id,
      source_id: d.source_deck_name === '(deleted)' ? null : d.source_deck_id,
      target_id: d.target_deck_id,
      // The tutor's own name for it (the copy is "… (from tutor)").
      title: d.source_deck_name === '(deleted)' ? d.target_deck_name ?? d.source_deck_name : d.source_deck_name,
      shared_at: d.shared_at,
      notes_total: d.notes_total,
      notes_introduced: d.notes_introduced,
      notes_left_out: d.notes_left_out ?? 0,
      notes_missing: d.notes_missing,
      cards_started: d.cards_started,
      target_deleted: d.target_deck_name == null,
    })),
    lessons,
    readers: readers.map((r) => ({
      share_id: r.id,
      source_id: r.source_title_chinese == null && r.source_title_english == null ? null : r.source_reader_id,
      target_id: r.target_reader_id,
      title: r.target_title_english || r.target_title_chinese || r.source_title_english || r.source_title_chinese || 'Reader',
      shared_at: r.shared_at,
      read_count: r.read_count,
      last_read_at: r.last_read_at,
      target_deleted: r.target_deleted,
    })),
  });
}

/** The tutor's students (active relationships where she is the tutor). */
export async function tutorStudents(db: D1Database, tutorId: string): Promise<StudentRef[]> {
  const mine = await getMyRelationships(db, tutorId);
  return mine.students.map((rel) => studentOf(rel as TutorRelationshipWithUsers, tutorId));
}

/** All students' items, newest first. */
export async function tutorLibrary(db: D1Database, tutorId: string, today: string): Promise<{ students: StudentRef[]; items: LibraryItem[] }> {
  const students = await tutorStudents(db, tutorId);
  const lists = await Promise.all(students.map((s) => relationshipLibrary(db, tutorId, s, today)));
  const items = sortLibrary(lists.flat());
  return { students, items };
}

// ============ Students' copies (§10) ============

export interface StudentCopy {
  relationship_id: string;
  student_id: string;
  student_name: string;
  /** The student's copy (deck / lesson / reader id; a link: the link id). */
  target_id: string;
  /** shared_decks / shared_readers id. */
  share_id: string | null;
  /** Deck: tutor words the copy does not have yet; null = unknown. */
  behind: number | null;
}

export function isCopyKind(kind: unknown): kind is LibraryKind {
  return kind === 'deck' || kind === 'lesson' || kind === 'reader' || kind === 'link';
}

/** 404 unless `sourceId` is one of the caller's own decks / library lessons / readers / links. */
async function requireOwnSource(db: D1Database, userId: string, kind: LibraryKind, sourceId: string): Promise<void> {
  const sql: Record<LibraryKind, string> = {
    deck: 'SELECT id FROM decks WHERE id = ? AND user_id = ?',
    lesson: 'SELECT id FROM lesson_library WHERE id = ? AND owner_id = ?',
    reader: 'SELECT id FROM graded_readers WHERE id = ? AND user_id = ?',
    link: 'SELECT id FROM homework_links WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  };
  const owned = await db.prepare(sql[kind]).bind(sourceId, userId).first();
  if (!owned) throw new HomeworkError(404, `${kind === 'lesson' ? 'Lesson not found in your library' : `${kind[0].toUpperCase()}${kind.slice(1)} not found in your account`}`);
}

/** Where `sourceId` (one of the tutor's decks / library lessons / readers / links) has been sent, one row per copy. */
export async function listStudentCopies(db: D1Database, tutorId: string, kind: LibraryKind, sourceId: string): Promise<StudentCopy[]> {
  await requireOwnSource(db, tutorId, kind, sourceId);
  const students = await tutorStudents(db, tutorId);
  const byRel = new Map(students.map((s) => [s.relationship_id, s]));
  const relIds = [...byRel.keys()];
  if (relIds.length === 0) return [];
  const inRels = `(${relIds.map(() => '?').join(',')})`;
  const out: StudentCopy[] = [];
  const push = (relId: string, target: string, share: string | null, behind: number | null) => {
    const s = byRel.get(relId);
    if (s) out.push({ ...s, target_id: target, share_id: share, behind });
  };
  if (kind === 'deck') {
    const r = await db
      .prepare(
        `SELECT sd.id, sd.relationship_id, sd.target_deck_id,
                (SELECT COUNT(*) FROM notes s WHERE s.deck_id = sd.source_deck_id
                   AND NOT EXISTS (SELECT 1 FROM notes t WHERE t.deck_id = sd.target_deck_id AND t.hanzi = s.hanzi)) AS behind
         FROM shared_decks sd JOIN decks t ON t.id = sd.target_deck_id
         WHERE sd.source_deck_id = ? AND sd.relationship_id IN ${inRels} ORDER BY sd.shared_at`
      )
      .bind(sourceId, ...relIds)
      .all<{ id: string; relationship_id: string; target_deck_id: string; behind: number }>();
    for (const row of r.results) push(row.relationship_id, row.target_deck_id, row.id, row.behind);
  } else if (kind === 'lesson') {
    const r = await db
      .prepare(`SELECT id, assigned_relationship_id FROM custom_lessons WHERE library_item_id = ? AND assigned_relationship_id IN ${inRels} ORDER BY created_at`)
      .bind(sourceId, ...relIds)
      .all<{ id: string; assigned_relationship_id: string }>();
    for (const row of r.results) push(row.assigned_relationship_id, row.id, null, null);
  } else if (kind === 'reader') {
    const r = await db
      .prepare(
        `SELECT sr.id, sr.relationship_id, sr.target_reader_id FROM shared_readers sr JOIN graded_readers t ON t.id = sr.target_reader_id
         WHERE sr.source_reader_id = ? AND sr.relationship_id IN ${inRels} ORDER BY sr.shared_at`
      )
      .bind(sourceId, ...relIds)
      .all<{ id: string; relationship_id: string; target_reader_id: string }>();
    for (const row of r.results) push(row.relationship_id, row.target_reader_id, row.id, null);
  } else {
    const r = await db
      .prepare(`SELECT DISTINCT relationship_id FROM assignments WHERE kind = 'link' AND source_id = ? AND tutor_id = ? AND status != 'cancelled' AND relationship_id IN ${inRels}`)
      .bind(sourceId, tutorId, ...relIds)
      .all<{ relationship_id: string }>();
    for (const row of r.results) push(row.relationship_id, sourceId, null, null);
  }
  return out;
}

export interface CopyUpdateResult {
  relationship_id: string;
  student_name: string;
  ok: boolean;
  /** "2 new words · 3 updated", "lesson updated", "already up to date", … */
  detail: string;
  error?: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Bring the chosen students' copies of `sourceId` up to date (all of them
 * when `relationshipIds` is null). Each copy fails on its own.
 */
export async function updateStudentCopies(
  env: Env,
  tutorId: string,
  kind: LibraryKind,
  sourceId: string,
  relationshipIds: string[] | null
): Promise<{ updated: number; results: CopyUpdateResult[] }> {
  const db = env.DB;
  const copies = (await listStudentCopies(db, tutorId, kind, sourceId)).filter((c) => !relationshipIds || relationshipIds.includes(c.relationship_id));
  const results: CopyUpdateResult[] = [];

  if (kind === 'lesson') {
    const only = new Set(copies.map((c) => c.relationship_id));
    const pushed = only.size > 0 ? await pushLibraryLessonUpdate(env, tutorId, sourceId, only) : null;
    for (const c of copies) {
      const changed = pushed?.copies.some((p) => p.lesson_id === c.target_id && p.updated) ?? false;
      results.push({ relationship_id: c.relationship_id, student_name: c.student_name, ok: true, detail: changed ? 'lesson updated' : 'already up to date' });
    }
  } else if (kind === 'link') {
    const link = await getLink(db, sourceId, tutorId);
    if (link && copies.length > 0) {
      await hw.updateLinkAssignments(
        db,
        link.id,
        tutorId,
        link.title,
        { url: link.url, instructions: link.instructions, thumbnail_url: link.thumbnail_url },
        copies.map((c) => c.relationship_id)
      );
    }
    for (const c of copies) results.push({ relationship_id: c.relationship_id, student_name: c.student_name, ok: true, detail: 'link updated' });
  } else {
    for (const c of copies) {
      try {
        if (kind === 'deck') {
          const r = await updateSharedDeckCopy(db, c.relationship_id, tutorId, c.share_id!);
          const parts = [r.added > 0 ? plural(r.added, 'new word') : '', r.updated > 0 ? `${plural(r.updated, 'word')} updated` : '', r.audio_filled > 0 ? plural(r.audio_filled, 'audio clip') : ''].filter(Boolean);
          results.push({ relationship_id: c.relationship_id, student_name: c.student_name, ok: true, detail: parts.join(' · ') || 'already up to date' });
        } else {
          const r = await updateSharedReaderCopy(db, sourceId, c.target_id);
          const n = r.changed + r.added + r.removed;
          results.push({ relationship_id: c.relationship_id, student_name: c.student_name, ok: true, detail: n > 0 ? `${plural(n, 'page')} updated` : 'already up to date' });
        }
      } catch (error) {
        results.push({ relationship_id: c.relationship_id, student_name: c.student_name, ok: false, detail: '', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { updated: results.filter((r) => r.ok && r.detail !== 'already up to date').length, results };
}
