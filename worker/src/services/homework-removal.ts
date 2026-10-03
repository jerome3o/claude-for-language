/**
 * Take homework back: the tutor removes what she sent from the student's
 * account — a deck copy, an assigned mini lesson or a shared reader.
 *
 * Only ever the student's COPY of something this tutor sent in this
 * relationship: a deck must be the `target_deck_id` of a `shared_decks` row of
 * the relationship, a lesson a `custom_lessons` row of the student with
 * `assigned_by` = the tutor, a reader the `target_reader_id` of a
 * `shared_readers` row. The student's own decks / lessons / readers can never
 * be reached through here.
 *
 * Each removal goes through the usual delete path (decks: the content
 * service's `deleteDeck` → tombstones for every device + unshared clips;
 * readers: `deleteReaderWithImages` → only unreferenced pictures), cancels the
 * homework assignments that pointed at the copy, drops the share row so the
 * tutor's Homework list no longer shows it, and marks the session-notes job
 * that sent it (its card then says "removed" instead of offering Undo).
 *
 * Every remove has a preview with the same shape (what would be lost), for
 * the confirm sheet: `preview*` never writes.
 */

import type { Env, TutorRelationship } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from './relationships';
import { deleteDeck, type Background } from './content';
import { deleteReaderWithImages } from './shared-readers';
import * as db from '../db/queries';

export class RemovalError extends Error {
  constructor(public status: 403 | 404 | 409, message: string) {
    super(message);
  }
}

export type HomeworkKind = 'deck' | 'lesson' | 'reader';

export interface DeckRemovalPreview {
  kind: 'deck';
  shared_deck_id: string;
  target_deck_id: string;
  /** The student's copy; null when they already deleted it. */
  deck_name: string | null;
  source_deck_id: string;
  source_deck_name: string | null;
  words_total: number;
  /** Words with at least one reviewed card. */
  words_met: number;
  reviews: number;
  /** "Also delete my copy" may be offered: the tutor owns the source and no other student still has a copy. */
  can_delete_source: boolean;
}

export interface LessonRemovalPreview {
  kind: 'lesson';
  lesson_id: string;
  title: string;
  /** Times the student finished it. */
  completions: number;
  library_item_id: string | null;
}

export interface ReaderRemovalPreview {
  kind: 'reader';
  shared_reader_id: string;
  target_reader_id: string;
  title: string | null;
  page_count: number;
  /** Times the student rated the reader (one per reading). */
  readings: number;
}

export interface RemovalResult {
  removed: true;
  /** Deck: words with a reviewed card (0 for a lesson / reader). */
  words_met: number;
  /** Deck: review events deleted; lesson: completions; reader: readings. */
  reviews: number;
  assignments_cancelled: number;
  source_deleted: boolean;
}

async function requireTutor(d1: D1Database, relId: string, userId: string): Promise<{ rel: TutorRelationship; studentId: string }> {
  let rel: TutorRelationship;
  try {
    rel = await verifyRelationshipAccess(d1, relId, userId);
  } catch {
    throw new RemovalError(404, 'Relationship not found or not active');
  }
  if (getMyRole(rel, userId) !== 'tutor') throw new RemovalError(403, 'Only the tutor can take homework back');
  return { rel, studentId: getOtherUserId(rel, userId) };
}

// ============ Decks ============

interface ShareRow {
  id: string;
  source_deck_id: string;
  target_deck_id: string;
}

/** The share by its id OR by the student's copy id (the session-notes job only knows the copy). */
async function findDeckShare(d1: D1Database, relId: string, idOrDeckId: string): Promise<ShareRow> {
  const row = await d1
    .prepare(
      `SELECT id, source_deck_id, target_deck_id FROM shared_decks
       WHERE relationship_id = ? AND (id = ? OR target_deck_id = ?)
       ORDER BY shared_at DESC LIMIT 1`
    )
    .bind(relId, idOrDeckId, idOrDeckId)
    .first<ShareRow>();
  if (!row) throw new RemovalError(404, 'This homework deck was already removed');
  return row;
}

async function deckStats(d1: D1Database, deckId: string, studentId: string): Promise<{ words_total: number; words_met: number; reviews: number }> {
  const totals = await d1
    .prepare('SELECT COUNT(*) AS n FROM notes WHERE deck_id = ?')
    .bind(deckId)
    .first<{ n: number }>();
  const met = await d1
    .prepare(
      `SELECT COUNT(DISTINCT c.note_id) AS words, COUNT(re.id) AS reviews
       FROM review_events re
       JOIN cards c ON c.id = re.card_id
       JOIN notes n ON n.id = c.note_id
       WHERE n.deck_id = ? AND re.user_id = ?`
    )
    .bind(deckId, studentId)
    .first<{ words: number; reviews: number }>();
  return { words_total: Number(totals?.n ?? 0), words_met: Number(met?.words ?? 0), reviews: Number(met?.reviews ?? 0) };
}

/** The tutor owns the source deck and no OTHER share of it still has a live copy. */
async function canDeleteSource(d1: D1Database, tutorId: string, share: ShareRow): Promise<boolean> {
  const owned = await d1
    .prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?')
    .bind(share.source_deck_id, tutorId)
    .first<{ id: string }>();
  if (!owned) return false;
  const others = await d1
    .prepare(
      `SELECT COUNT(*) AS n FROM shared_decks sd JOIN decks t ON t.id = sd.target_deck_id
       WHERE sd.source_deck_id = ? AND sd.id != ?`
    )
    .bind(share.source_deck_id, share.id)
    .first<{ n: number }>();
  return Number(others?.n ?? 0) === 0;
}

export async function previewDeckRemoval(d1: D1Database, relId: string, tutorId: string, idOrDeckId: string): Promise<DeckRemovalPreview> {
  const { studentId } = await requireTutor(d1, relId, tutorId);
  const share = await findDeckShare(d1, relId, idOrDeckId);
  const copy = await d1
    .prepare('SELECT name FROM decks WHERE id = ? AND user_id = ?')
    .bind(share.target_deck_id, studentId)
    .first<{ name: string }>();
  const source = await d1.prepare('SELECT name FROM decks WHERE id = ?').bind(share.source_deck_id).first<{ name: string }>();
  const stats = copy ? await deckStats(d1, share.target_deck_id, studentId) : { words_total: 0, words_met: 0, reviews: 0 };
  return {
    kind: 'deck',
    shared_deck_id: share.id,
    target_deck_id: share.target_deck_id,
    deck_name: copy?.name ?? null,
    source_deck_id: share.source_deck_id,
    source_deck_name: source?.name ?? null,
    ...stats,
    can_delete_source: await canDeleteSource(d1, tutorId, share),
  };
}

export async function removeStudentDeck(
  env: Env,
  relId: string,
  tutorId: string,
  idOrDeckId: string,
  opts: { deleteSource?: boolean; bg?: Background } = {}
): Promise<RemovalResult> {
  const d1 = env.DB;
  const { studentId } = await requireTutor(d1, relId, tutorId);
  const share = await findDeckShare(d1, relId, idOrDeckId);
  const copy = await d1
    .prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?')
    .bind(share.target_deck_id, studentId)
    .first<{ id: string }>();
  const stats = copy ? await deckStats(d1, share.target_deck_id, studentId) : { words_total: 0, words_met: 0, reviews: 0 };
  const sourceDeletable = opts.deleteSource ? await canDeleteSource(d1, tutorId, share) : false;

  // deleteDeck checks the deck is the STUDENT's before touching it.
  if (copy) await deleteDeck(env, studentId, share.target_deck_id, opts.bg);
  await d1.prepare('DELETE FROM shared_decks WHERE id = ?').bind(share.id).run();
  const cancelled = await cancelAssignments(d1, relId, 'deck', share.target_deck_id);
  await markJobsRemoved(d1, relId, 'deck', share.target_deck_id);

  let sourceDeleted = false;
  if (sourceDeletable) {
    sourceDeleted = await deleteDeck(env, tutorId, share.source_deck_id, opts.bg);
    if (sourceDeleted) {
      // Shares of the deleted source whose copies are already gone are history now.
      await d1
        .prepare('DELETE FROM shared_decks WHERE source_deck_id = ? AND target_deck_id NOT IN (SELECT id FROM decks)')
        .bind(share.source_deck_id)
        .run();
    }
  }
  return { removed: true, words_met: stats.words_met, reviews: stats.reviews, assignments_cancelled: cancelled, source_deleted: sourceDeleted };
}

// ============ Lessons ============

interface LessonRow {
  id: string;
  title: string;
  library_item_id: string | null;
}

async function findAssignedLesson(d1: D1Database, relId: string, tutorId: string, studentId: string, lessonId: string): Promise<LessonRow> {
  const row = await d1
    .prepare(
      `SELECT id, title, library_item_id FROM custom_lessons
       WHERE id = ? AND user_id = ? AND assigned_by = ?
         AND (assigned_relationship_id = ? OR assigned_relationship_id IS NULL)`
    )
    .bind(lessonId, studentId, tutorId, relId)
    .first<LessonRow>();
  if (!row) throw new RemovalError(404, 'This lesson was already removed, or you did not assign it');
  return row;
}

async function lessonCompletions(d1: D1Database, lessonId: string): Promise<number> {
  const r = await d1.prepare('SELECT COUNT(*) AS n FROM custom_lesson_completions WHERE lesson_id = ?').bind(lessonId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

export async function previewLessonRemoval(d1: D1Database, relId: string, tutorId: string, lessonId: string): Promise<LessonRemovalPreview> {
  const { studentId } = await requireTutor(d1, relId, tutorId);
  const lesson = await findAssignedLesson(d1, relId, tutorId, studentId, lessonId);
  return { kind: 'lesson', lesson_id: lesson.id, title: lesson.title, completions: await lessonCompletions(d1, lesson.id), library_item_id: lesson.library_item_id };
}

/** Delete the student's copy of a lesson this tutor assigned. The library item stays. */
export async function removeStudentLesson(env: Env, relId: string, tutorId: string, lessonId: string): Promise<RemovalResult> {
  const d1 = env.DB;
  const { studentId } = await requireTutor(d1, relId, tutorId);
  const lesson = await findAssignedLesson(d1, relId, tutorId, studentId, lessonId);
  const completions = await lessonCompletions(d1, lesson.id);
  await db.deleteCustomLesson(d1, lesson.id, studentId);
  const cancelled = await cancelAssignments(d1, relId, 'lesson', lesson.id);
  await markJobsRemoved(d1, relId, 'lesson', lesson.id);
  return { removed: true, words_met: 0, reviews: completions, assignments_cancelled: cancelled, source_deleted: false };
}

// ============ Readers ============

interface ReaderShareRow {
  id: string;
  target_reader_id: string;
}

async function findReaderShare(d1: D1Database, relId: string, idOrReaderId: string): Promise<ReaderShareRow> {
  const row = await d1
    .prepare(
      `SELECT id, target_reader_id FROM shared_readers
       WHERE relationship_id = ? AND (id = ? OR target_reader_id = ?)
       ORDER BY shared_at DESC LIMIT 1`
    )
    .bind(relId, idOrReaderId, idOrReaderId)
    .first<ReaderShareRow>();
  if (!row) throw new RemovalError(404, 'This reader was already removed');
  return row;
}

async function readerStats(d1: D1Database, readerId: string, studentId: string): Promise<{ title: string | null; page_count: number; readings: number; exists: boolean }> {
  const reader = await d1
    .prepare('SELECT title_english, title_chinese FROM graded_readers WHERE id = ? AND user_id = ?')
    .bind(readerId, studentId)
    .first<{ title_english: string | null; title_chinese: string | null }>();
  if (!reader) return { title: null, page_count: 0, readings: 0, exists: false };
  const pages = await d1.prepare('SELECT COUNT(*) AS n FROM reader_pages WHERE reader_id = ?').bind(readerId).first<{ n: number }>();
  const reads = await d1
    .prepare('SELECT COUNT(*) AS n FROM reader_review_events WHERE reader_id = ? AND user_id = ?')
    .bind(readerId, studentId)
    .first<{ n: number }>();
  return {
    title: reader.title_chinese || reader.title_english,
    page_count: Number(pages?.n ?? 0),
    readings: Number(reads?.n ?? 0),
    exists: true,
  };
}

export async function previewReaderRemoval(d1: D1Database, relId: string, tutorId: string, idOrReaderId: string): Promise<ReaderRemovalPreview> {
  const { studentId } = await requireTutor(d1, relId, tutorId);
  const share = await findReaderShare(d1, relId, idOrReaderId);
  const s = await readerStats(d1, share.target_reader_id, studentId);
  return { kind: 'reader', shared_reader_id: share.id, target_reader_id: share.target_reader_id, title: s.title, page_count: s.page_count, readings: s.readings };
}

/** Delete the student's copy of a shared reader; pictures another page still uses stay in R2. */
export async function removeStudentReader(env: Env, relId: string, tutorId: string, idOrReaderId: string): Promise<RemovalResult> {
  const d1 = env.DB;
  const { studentId } = await requireTutor(d1, relId, tutorId);
  const share = await findReaderShare(d1, relId, idOrReaderId);
  const s = await readerStats(d1, share.target_reader_id, studentId);
  if (s.exists) await deleteReaderWithImages(env, studentId, share.target_reader_id);
  await d1.prepare('DELETE FROM shared_readers WHERE id = ?').bind(share.id).run();
  const cancelled = await cancelAssignments(d1, relId, 'reader', share.target_reader_id);
  await markJobsRemoved(d1, relId, 'reader', share.target_reader_id);
  return { removed: true, words_met: 0, reviews: s.readings, assignments_cancelled: cancelled, source_deleted: false };
}

// ============ Shared bookkeeping ============

/** Homework assignments that pointed at the copy: cancelled, so the student's Homework card drops them on sync. */
async function cancelAssignments(d1: D1Database, relId: string, kind: HomeworkKind, targetId: string): Promise<number> {
  const r = await d1
    .prepare(
      `UPDATE assignments SET status = 'cancelled', updated_at = datetime('now')
       WHERE relationship_id = ? AND kind = ? AND target_id = ? AND status != 'cancelled'`
    )
    .bind(relId, kind, targetId)
    .run();
  return Number(r.meta?.changes ?? 0);
}

/**
 * Session-notes jobs that sent this copy: stamp `removed_at` on that item of
 * the job's result, so the job card shows "removed from <student>".
 */
export async function markJobsRemoved(d1: D1Database, relId: string, kind: HomeworkKind, targetId: string): Promise<number> {
  const rows = await d1
    .prepare("SELECT id, result FROM tutor_note_jobs WHERE relationship_id = ? AND result LIKE ?")
    .bind(relId, `%${targetId}%`)
    .all<{ id: string; result: string }>();
  const now = new Date().toISOString();
  let changed = 0;
  for (const row of rows.results || []) {
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(row.result || '{}');
    } catch {
      continue;
    }
    if (!markResultRemoved(result, kind, targetId, now)) continue;
    await d1.prepare('UPDATE tutor_note_jobs SET result = ? WHERE id = ?').bind(JSON.stringify(result), row.id).run();
    changed++;
  }
  return changed;
}

/** Pure: stamp `removed_at` on the matching item of a job result. True when something changed. */
export function markResultRemoved(result: Record<string, unknown>, kind: HomeworkKind, targetId: string, at: string): boolean {
  if (kind === 'deck') {
    const deck = result.deck as { target_deck_id?: string; removed_at?: string } | undefined;
    if (deck && deck.target_deck_id === targetId && !deck.removed_at) {
      deck.removed_at = at;
      return true;
    }
    return false;
  }
  if (kind === 'reader') {
    const reader = result.reader as { target_reader_id?: string; removed_at?: string } | undefined;
    if (reader && reader.target_reader_id === targetId && !reader.removed_at) {
      reader.removed_at = at;
      return true;
    }
    return false;
  }
  const lessons = result.lessons as Array<{ lesson_id?: string; removed_at?: string }> | undefined;
  let changed = false;
  for (const l of lessons ?? []) {
    if (l.lesson_id === targetId && !l.removed_at) {
      l.removed_at = at;
      changed = true;
    }
  }
  return changed;
}
