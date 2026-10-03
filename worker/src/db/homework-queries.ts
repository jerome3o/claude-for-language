/**
 * SQL for homework assignments and their pass events (migration 0073,
 * docs/HOMEWORK.md). The copies themselves (decks, lessons, readers) are made
 * by services/homework.ts through the usual share / assign paths.
 */

import type { HomeworkAssignment, HomeworkDetails, HomeworkEvent, HomeworkMode, HomeworkStatus } from '@shared/homework';

interface AssignmentRow extends Omit<HomeworkAssignment, 'item_ids' | 'details'> {
  item_ids: string | null;
  details?: string | null;
}

function parseDetails(raw: string | null | undefined): HomeworkDetails | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as HomeworkDetails) : null;
  } catch {
    return null;
  }
}

function parseRow(row: AssignmentRow): HomeworkAssignment {
  let itemIds: string[] | null = null;
  if (row.item_ids) {
    try {
      const parsed = JSON.parse(row.item_ids);
      itemIds = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null;
    } catch {
      itemIds = null;
    }
  }
  return { ...row, item_ids: itemIds, details: parseDetails(row.details) };
}

export interface NewAssignment {
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  batch_id: string | null;
  kind: string;
  target_id: string;
  source_id: string | null;
  title: string;
  mode: HomeworkMode;
  due_date: string | null;
  item_ids: string[] | null;
  item_count: number;
  part_index: number;
  part_count: number;
  /** Link homework: the link snapshot. */
  details?: HomeworkDetails | null;
}

const SELECT = `SELECT a.*, u.name AS tutor_name FROM assignments a LEFT JOIN users u ON u.id = a.tutor_id`;

export async function insertAssignments(db: D1Database, rows: NewAssignment[]): Promise<HomeworkAssignment[]> {
  if (rows.length === 0) return [];
  const ids: string[] = [];
  const stmts = rows.map((r) => {
    const id = crypto.randomUUID();
    ids.push(id);
    return db
      .prepare(
        `INSERT INTO assignments (id, relationship_id, tutor_id, student_id, batch_id, kind, target_id, source_id, title, mode, due_date, item_ids, item_count, part_index, part_count, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        r.relationship_id,
        r.tutor_id,
        r.student_id,
        r.batch_id,
        r.kind,
        r.target_id,
        r.source_id,
        r.title,
        r.mode,
        r.due_date,
        r.item_ids ? JSON.stringify(r.item_ids) : null,
        r.item_count,
        r.part_index,
        r.part_count,
        r.details ? JSON.stringify(r.details) : null
      );
  });
  await db.batch(stmts);
  return getAssignmentsByIds(db, ids);
}

export async function getAssignmentsByIds(db: D1Database, ids: string[]): Promise<HomeworkAssignment[]> {
  if (ids.length === 0) return [];
  const out: HomeworkAssignment[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await db.prepare(`${SELECT} WHERE a.id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<AssignmentRow>();
    out.push(...r.results.map(parseRow));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function getAssignment(db: D1Database, id: string): Promise<HomeworkAssignment | null> {
  const row = await db.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first<AssignmentRow>();
  return row ? parseRow(row) : null;
}

/** Everything assigned to a student (newest first) — the student's sync. */
export async function listStudentAssignments(db: D1Database, studentId: string, limit = 500): Promise<HomeworkAssignment[]> {
  const r = await db.prepare(`${SELECT} WHERE a.student_id = ? ORDER BY a.created_at DESC LIMIT ?`).bind(studentId, limit).all<AssignmentRow>();
  return r.results.map(parseRow);
}

/** One relationship's assignments (tutor view), newest first. */
export async function listRelationshipAssignments(db: D1Database, relationshipId: string, limit = 200): Promise<HomeworkAssignment[]> {
  const r = await db.prepare(`${SELECT} WHERE a.relationship_id = ? ORDER BY a.created_at DESC LIMIT ?`).bind(relationshipId, limit).all<AssignmentRow>();
  return r.results.map(parseRow);
}

export async function listBatchAssignments(db: D1Database, batchId: string): Promise<HomeworkAssignment[]> {
  const r = await db.prepare(`${SELECT} WHERE a.batch_id = ? ORDER BY a.created_at ASC, a.part_index ASC`).bind(batchId).all<AssignmentRow>();
  return r.results.map(parseRow);
}

/** Active assignments of the student (for the load gauge). */
export async function listActiveForStudent(db: D1Database, studentId: string): Promise<HomeworkAssignment[]> {
  const r = await db.prepare(`${SELECT} WHERE a.student_id = ? AND a.status = 'active' ORDER BY a.due_date`).bind(studentId).all<AssignmentRow>();
  return r.results.map(parseRow);
}

export async function listEvents(db: D1Database, assignmentIds: string[]): Promise<HomeworkEvent[]> {
  if (assignmentIds.length === 0) return [];
  const out: HomeworkEvent[] = [];
  for (let i = 0; i < assignmentIds.length; i += 50) {
    const chunk = assignmentIds.slice(i, i + 50);
    const r = await db
      .prepare(`SELECT id, assignment_id, item_id, result, created_at, note FROM assignment_events WHERE assignment_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at`)
      .bind(...chunk)
      .all<HomeworkEvent>();
    out.push(...r.results);
  }
  return out;
}

/** Insert events, skipping ids already stored. Returns how many were new. */
export async function insertEvents(db: D1Database, studentId: string, events: HomeworkEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const results = await db.batch(
    events.map((e) =>
      db
        .prepare(`INSERT OR IGNORE INTO assignment_events (id, assignment_id, student_id, item_id, result, created_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(e.id, e.assignment_id, studentId, e.item_id, e.result, e.created_at, e.note ?? null)
    )
  );
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

export async function setProgress(db: D1Database, id: string, doneCount: number, status: HomeworkStatus, completedAt: string | null): Promise<void> {
  await db
    .prepare(`UPDATE assignments SET done_count = ?, status = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(doneCount, status, completedAt, id)
    .run();
}

export async function patchAssignment(db: D1Database, id: string, patch: { due_date?: string | null; status?: HomeworkStatus }): Promise<void> {
  const sets: string[] = [`updated_at = datetime('now')`];
  const binds: unknown[] = [];
  if (patch.due_date !== undefined) {
    sets.push('due_date = ?');
    binds.push(patch.due_date);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    binds.push(patch.status);
  }
  binds.push(id);
  await db.prepare(`UPDATE assignments SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
}

/** Unseen words the FSRS budget will still introduce: notes with no started card, in decks that take new cards. */
export async function countFsrsWordsToGo(db: D1Database, studentId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM notes n JOIN decks d ON d.id = n.deck_id
       WHERE d.user_id = ? AND COALESCE(d.new_cards_per_day, 1) > 0
         AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.note_id = n.id AND COALESCE(c.queue, 0) != 0)`
    )
    .bind(studentId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getStudentBudget(db: D1Database, studentId: string): Promise<number | null> {
  const row = await db.prepare(`SELECT new_cards_per_day FROM users WHERE id = ?`).bind(studentId).first<{ new_cards_per_day: number | null }>();
  return row?.new_cards_per_day ?? null;
}

/** Hanzi of every note the student has (for dedupe). */
export async function listStudentHanzi(db: D1Database, studentId: string, excludeDeckIds: string[] = []): Promise<string[]> {
  const not = excludeDeckIds.length ? ` AND d.id NOT IN (${excludeDeckIds.map(() => '?').join(',')})` : '';
  const r = await db
    .prepare(`SELECT n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?${not}`)
    .bind(studentId, ...excludeDeckIds)
    .all<{ hanzi: string }>();
  return r.results.map((x) => x.hanzi);
}

export async function listDeckNotes(db: D1Database, deckId: string): Promise<Array<{ id: string; hanzi: string; pinyin: string; english: string }>> {
  const r = await db
    .prepare(`SELECT id, hanzi, pinyin, english FROM notes WHERE deck_id = ? ORDER BY created_at ASC`)
    .bind(deckId)
    .all<{ id: string; hanzi: string; pinyin: string; english: string }>();
  return r.results;
}

/** The newest note per assignment (from `done` events), for the homework library. */
export async function listEventNotes(db: D1Database, assignmentIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < assignmentIds.length; i += 50) {
    const chunk = assignmentIds.slice(i, i + 50);
    const r = await db
      .prepare(`SELECT assignment_id, note FROM assignment_events WHERE note IS NOT NULL AND note != '' AND assignment_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at`)
      .bind(...chunk)
      .all<{ assignment_id: string; note: string }>();
    for (const row of r.results) out[row.assignment_id] = row.note;
  }
  return out;
}

/** Rewrite the title + link snapshot of the sent copies of a link (not cancelled), optionally only some relationships. */
export async function updateLinkAssignments(
  db: D1Database,
  linkId: string,
  tutorId: string,
  title: string,
  details: HomeworkDetails,
  relationshipIds: string[] | null
): Promise<Array<{ relationship_id: string }>> {
  const rows = await db
    .prepare(`SELECT id, relationship_id FROM assignments WHERE kind = 'link' AND source_id = ? AND tutor_id = ? AND status != 'cancelled'`)
    .bind(linkId, tutorId)
    .all<{ id: string; relationship_id: string }>();
  const chosen = rows.results.filter((r) => !relationshipIds || relationshipIds.includes(r.relationship_id));
  if (chosen.length === 0) return [];
  await db.batch(
    chosen.map((r) =>
      db.prepare(`UPDATE assignments SET title = ?, details = ?, updated_at = datetime('now') WHERE id = ?`).bind(title, JSON.stringify(details), r.id)
    )
  );
  return chosen.map((r) => ({ relationship_id: r.relationship_id }));
}
