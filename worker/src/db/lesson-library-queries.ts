/**
 * Lesson library, assigned lesson copies and editor chats (migration 0061).
 *
 * Library items are a tutor's master copies. Assigning one creates a normal
 * custom_lessons row for the student with `library_item_id` / `assigned_by` /
 * `assigned_relationship_id` set, so the tutor can see results and push
 * updates while the student's copy keeps working offline like any lesson.
 */

import { CustomLessonRow } from './queries';

// ============ Library ============

export interface LessonLibraryRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  spec: string; // JSON CustomLessonSpec
  tags: string; // JSON string[]
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface LessonLibraryListRow extends LessonLibraryRow {
  assignment_count: number;
}

export interface LibraryItemInput {
  title: string;
  description?: string | null;
  icon?: string | null;
  spec: string;
  tags?: string[];
}

export async function createLibraryItem(
  db: D1Database,
  ownerId: string,
  data: LibraryItemInput,
): Promise<LessonLibraryRow> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO lesson_library (id, owner_id, title, description, icon, spec, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, ownerId, data.title, data.description ?? null, data.icon ?? null, data.spec, JSON.stringify(data.tags ?? [])).run();
  const row = await db.prepare(`SELECT * FROM lesson_library WHERE id = ?`).bind(id).first<LessonLibraryRow>();
  return row!;
}

export async function listLibraryItems(db: D1Database, ownerId: string): Promise<LessonLibraryListRow[]> {
  const r = await db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM custom_lessons c WHERE c.library_item_id = l.id) AS assignment_count
    FROM lesson_library l
    WHERE l.owner_id = ? AND l.archived_at IS NULL
    ORDER BY l.updated_at DESC
  `).bind(ownerId).all<LessonLibraryListRow>();
  return r.results;
}

export async function getLibraryItem(db: D1Database, id: string, ownerId: string): Promise<LessonLibraryRow | null> {
  const row = await db.prepare(`SELECT * FROM lesson_library WHERE id = ? AND owner_id = ?`)
    .bind(id, ownerId).first<LessonLibraryRow>();
  return row ?? null;
}

/** Replace a library item's content. `bumpVersion` when the spec changed so
 * assigned copies can be told apart from the new master. */
export async function updateLibraryItem(
  db: D1Database,
  id: string,
  ownerId: string,
  data: LibraryItemInput,
  bumpVersion: boolean,
): Promise<LessonLibraryRow | null> {
  const r = await db.prepare(`
    UPDATE lesson_library
    SET title = ?, description = ?, icon = ?, spec = ?, tags = ?,
        version = version + ?, updated_at = datetime('now')
    WHERE id = ? AND owner_id = ?
  `).bind(
    data.title, data.description ?? null, data.icon ?? null, data.spec,
    JSON.stringify(data.tags ?? []), bumpVersion ? 1 : 0, id, ownerId,
  ).run();
  if ((r.meta?.changes ?? 0) === 0) return null;
  return getLibraryItem(db, id, ownerId);
}

export async function archiveLibraryItem(db: D1Database, id: string, ownerId: string): Promise<boolean> {
  const r = await db.prepare(`
    UPDATE lesson_library SET archived_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND owner_id = ? AND archived_at IS NULL
  `).bind(id, ownerId).run();
  return (r.meta?.changes ?? 0) > 0;
}

// ============ Assigned copies (custom_lessons rows with a link back) ============

export interface AssignedLessonRow extends CustomLessonRow {
  library_item_id: string | null;
  assigned_by: string | null;
  assigned_relationship_id: string | null;
}

export interface CompletionAggregate {
  lesson_id: string;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
  last_correct: number | null;
  last_total: number | null;
}

/** Completion counts + the latest event per lesson, in one query. */
export async function aggregateCompletions(db: D1Database, lessonIds: string[]): Promise<Map<string, CompletionAggregate>> {
  const out = new Map<string, CompletionAggregate>();
  if (lessonIds.length === 0) return out;
  // D1 caps bound parameters; chunk to stay well inside it.
  for (let i = 0; i < lessonIds.length; i += 50) {
    const chunk = lessonIds.slice(i, i + 50);
    const placeholders = chunk.map(() => '?').join(',');
    const r = await db.prepare(`
      SELECT c.lesson_id,
             COUNT(*) AS completions,
             MAX(c.completed_at) AS last_completed_at,
             (SELECT rating FROM custom_lesson_completions x WHERE x.lesson_id = c.lesson_id ORDER BY completed_at DESC LIMIT 1) AS last_rating,
             (SELECT correct FROM custom_lesson_completions x WHERE x.lesson_id = c.lesson_id ORDER BY completed_at DESC LIMIT 1) AS last_correct,
             (SELECT total FROM custom_lesson_completions x WHERE x.lesson_id = c.lesson_id ORDER BY completed_at DESC LIMIT 1) AS last_total
      FROM custom_lesson_completions c
      WHERE c.lesson_id IN (${placeholders})
      GROUP BY c.lesson_id
    `).bind(...chunk).all<CompletionAggregate>();
    for (const row of r.results) out.set(row.lesson_id, row);
  }
  return out;
}

export interface AssignmentRow extends AssignedLessonRow {
  student_name: string | null;
  student_email: string | null;
  student_picture_url: string | null;
}

/** Every student copy of a library item, with the student's summary. */
export async function listAssignmentsForItem(db: D1Database, libraryItemId: string): Promise<AssignmentRow[]> {
  const r = await db.prepare(`
    SELECT c.*, u.name AS student_name, u.email AS student_email, u.picture_url AS student_picture_url
    FROM custom_lessons c
    JOIN users u ON u.id = c.user_id
    WHERE c.library_item_id = ?
    ORDER BY c.created_at
  `).bind(libraryItemId).all<AssignmentRow>();
  return r.results;
}

export async function findAssignedCopy(db: D1Database, libraryItemId: string, studentId: string): Promise<AssignedLessonRow | null> {
  const row = await db.prepare(`SELECT * FROM custom_lessons WHERE library_item_id = ? AND user_id = ? LIMIT 1`)
    .bind(libraryItemId, studentId).first<AssignedLessonRow>();
  return row ?? null;
}

export async function createAssignedLesson(
  db: D1Database,
  studentId: string,
  data: {
    title: string;
    description?: string | null;
    icon?: string | null;
    spec: string;
    library_item_id: string;
    assigned_by: string;
    assigned_relationship_id: string;
  },
): Promise<AssignedLessonRow> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO custom_lessons (id, user_id, title, description, icon, spec, source, library_item_id, assigned_by, assigned_relationship_id)
    VALUES (?, ?, ?, ?, ?, ?, 'api', ?, ?, ?)
  `).bind(
    id, studentId, data.title, data.description ?? null, data.icon ?? null, data.spec,
    data.library_item_id, data.assigned_by, data.assigned_relationship_id,
  ).run();
  const row = await db.prepare(`SELECT * FROM custom_lessons WHERE id = ?`).bind(id).first<AssignedLessonRow>();
  return row!;
}

/** A lesson the user may open in the editor: their own, or one they assigned
 * as tutor. */
export async function getLessonForEditor(db: D1Database, lessonId: string, userId: string): Promise<AssignedLessonRow | null> {
  const row = await db.prepare(`SELECT * FROM custom_lessons WHERE id = ? AND (user_id = ? OR assigned_by = ?)`)
    .bind(lessonId, userId, userId).first<AssignedLessonRow>();
  return row ?? null;
}

/** Replace a lesson's content by id. Access must be checked by the caller
 * (getLessonForEditor) — this is the tutor-or-owner write path. */
export async function updateLessonSpecById(
  db: D1Database,
  lessonId: string,
  data: { title: string; description?: string | null; icon?: string | null; spec: string },
): Promise<AssignedLessonRow | null> {
  const r = await db.prepare(`
    UPDATE custom_lessons
    SET title = ?, description = ?, icon = ?, spec = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(data.title, data.description ?? null, data.icon ?? null, data.spec, lessonId).run();
  if ((r.meta?.changes ?? 0) === 0) return null;
  const row = await db.prepare(`SELECT * FROM custom_lessons WHERE id = ?`).bind(lessonId).first<AssignedLessonRow>();
  return row ?? null;
}

/** All of a student's lessons (for the tutor's view of a connection). */
export async function listLessonsForUser(db: D1Database, userId: string): Promise<AssignedLessonRow[]> {
  const r = await db.prepare(`SELECT * FROM custom_lessons WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId).all<AssignedLessonRow>();
  return r.results;
}

// ============ Editor chats ============

export interface EditorChatRow {
  id: string;
  owner_id: string;
  target_type: string;
  target_id: string;
  created_at: string;
  updated_at: string;
}

export interface EditorChatMessageRow {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  spec_snapshot: string | null;
  proposed_spec: string | null;
  proposal_status: 'pending' | 'accepted' | 'rejected' | null;
  created_at: string;
}

export async function getOrCreateEditorChat(
  db: D1Database,
  ownerId: string,
  targetType: string,
  targetId: string,
): Promise<EditorChatRow> {
  const existing = await db.prepare(`SELECT * FROM editor_chats WHERE owner_id = ? AND target_type = ? AND target_id = ?`)
    .bind(ownerId, targetType, targetId).first<EditorChatRow>();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO editor_chats (id, owner_id, target_type, target_id) VALUES (?, ?, ?, ?)`)
    .bind(id, ownerId, targetType, targetId).run();
  const row = await db.prepare(`SELECT * FROM editor_chats WHERE id = ?`).bind(id).first<EditorChatRow>();
  return row!;
}

export async function listEditorChatMessages(db: D1Database, chatId: string): Promise<EditorChatMessageRow[]> {
  const r = await db.prepare(`SELECT * FROM editor_chat_messages WHERE chat_id = ? ORDER BY created_at, rowid`)
    .bind(chatId).all<EditorChatMessageRow>();
  return r.results;
}

export async function insertEditorChatMessage(
  db: D1Database,
  data: {
    chat_id: string;
    role: 'user' | 'assistant';
    content: string;
    spec_snapshot: string | null;
    proposed_spec?: string | null;
    proposal_status?: 'pending' | 'accepted' | 'rejected' | null;
  },
): Promise<EditorChatMessageRow> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO editor_chat_messages (id, chat_id, role, content, spec_snapshot, proposed_spec, proposal_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, data.chat_id, data.role, data.content, data.spec_snapshot, data.proposed_spec ?? null, data.proposal_status ?? null).run();
  await db.prepare(`UPDATE editor_chats SET updated_at = datetime('now') WHERE id = ?`).bind(data.chat_id).run();
  const row = await db.prepare(`SELECT * FROM editor_chat_messages WHERE id = ?`).bind(id).first<EditorChatMessageRow>();
  return row!;
}

export async function setProposalStatus(
  db: D1Database,
  messageId: string,
  chatId: string,
  status: 'accepted' | 'rejected',
): Promise<EditorChatMessageRow | null> {
  const r = await db.prepare(`
    UPDATE editor_chat_messages SET proposal_status = ?
    WHERE id = ? AND chat_id = ? AND proposed_spec IS NOT NULL
  `).bind(status, messageId, chatId).run();
  if ((r.meta?.changes ?? 0) === 0) return null;
  const row = await db.prepare(`SELECT * FROM editor_chat_messages WHERE id = ?`).bind(messageId).first<EditorChatMessageRow>();
  return row ?? null;
}
