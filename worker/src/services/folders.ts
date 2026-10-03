/**
 * Folders for decks, Lesson Library items and graded readers — organisation only
 * (shared/folders; migration 0100). Every folder write goes through here.
 *
 * - A folder belongs to one user and one kind; nothing reads or writes another
 *   user's folders (every query is scoped by user_id; a foreign id is "not found").
 * - One level of nesting (`parentProblem`).
 * - Deleting a folder never deletes content: its items go back to Unfiled and its
 *   subfolders move up to the top level.
 * - Moving decks bumps `decks.updated_at` so the change rides the incremental sync
 *   to every device; the study queue (`study_priority`) is never touched.
 *   Library items and readers are not re-dated: the library sorts by updated_at
 *   (a move is not an edit) and readers sync as a whole list.
 */
import {
  cleanFolderName,
  folderNameProblems,
  folderNameKey,
  isFolderKind,
  parentProblem,
  sortFolders,
  MAX_FOLDERS_PER_KIND,
  type Folder,
  type FolderKind,
} from '@shared/folders';

export class FolderError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400, public problems?: string[]) {
    super(message);
  }
}

/** The table, owner column and whether a move re-dates the row, per kind. */
const ITEM_TABLES: Record<FolderKind, { table: string; owner: string; bump: boolean }> = {
  deck: { table: 'decks', owner: 'user_id', bump: true },
  lesson: { table: 'lesson_library', owner: 'owner_id', bump: false },
  reader: { table: 'graded_readers', owner: 'user_id', bump: false },
};

export function itemTable(kind: FolderKind) {
  return ITEM_TABLES[kind];
}

export function assertKind(kind: unknown): FolderKind {
  if (!isFolderKind(kind)) throw new FolderError("kind must be 'deck', 'lesson' or 'reader'");
  return kind;
}

export async function listFolders(db: D1Database, userId: string, kind?: FolderKind): Promise<Folder[]> {
  const res = kind
    ? await db.prepare('SELECT * FROM folders WHERE user_id = ? AND kind = ?').bind(userId, kind).all<Folder>()
    : await db.prepare('SELECT * FROM folders WHERE user_id = ?').bind(userId).all<Folder>();
  const rows = res.results ?? [];
  // Kinds grouped, siblings in display order.
  return FOLDER_KIND_ORDER.flatMap((k) => sortFolders(rows.filter((f) => f.kind === k)));
}
const FOLDER_KIND_ORDER: FolderKind[] = ['deck', 'lesson', 'reader'];

export async function getFolder(db: D1Database, userId: string, id: string): Promise<Folder | null> {
  return (await db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').bind(id, userId).first<Folder>()) ?? null;
}

/**
 * A folder id given with an item (create / move): must be this user's folder of this
 * kind. null / undefined / '' = Unfiled. Throws a 400 otherwise.
 */
export async function resolveFolderId(db: D1Database, userId: string, kind: FolderKind, folderId: unknown): Promise<string | null> {
  if (folderId === null || folderId === undefined || folderId === '') return null;
  if (typeof folderId !== 'string') throw new FolderError('folder_id must be a string or null');
  const folder = await getFolder(db, userId, folderId);
  if (!folder || folder.kind !== kind) throw new FolderError(`No ${kind} folder with id ${folderId}`, 400);
  return folder.id;
}

export interface CreateFolderInput {
  kind: unknown;
  name: unknown;
  parent_id?: unknown;
  /** Client id for an idempotent create (offline retries); a UUID-ish string. */
  id?: unknown;
}

export async function createFolder(db: D1Database, userId: string, input: CreateFolderInput): Promise<{ folder: Folder; created: boolean }> {
  const kind = assertKind(input.kind);
  const problems = folderNameProblems(input.name);
  if (problems.length) throw new FolderError(problems[0], 400, problems);
  const name = cleanFolderName(input.name);
  const clientId = typeof input.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(input.id) ? input.id : null;
  if (clientId) {
    const existing = await db.prepare('SELECT * FROM folders WHERE id = ?').bind(clientId).first<Folder>();
    if (existing) {
      if (existing.user_id !== userId) throw new FolderError('Folder id already in use', 409);
      return { folder: existing, created: false };
    }
  }
  const siblings = await listFolders(db, userId, kind);
  if (siblings.length >= MAX_FOLDERS_PER_KIND) throw new FolderError(`At most ${MAX_FOLDERS_PER_KIND} folders`, 400);
  const parentId = typeof input.parent_id === 'string' && input.parent_id ? input.parent_id : null;
  const parentErr = parentProblem({ id: null, kind }, parentId, siblings);
  if (parentErr) throw new FolderError(parentErr, 400, [parentErr]);
  const position = Math.max(-1, ...siblings.filter((f) => (f.parent_id ?? null) === parentId).map((f) => f.position)) + 1;
  const id = clientId ?? crypto.randomUUID();
  await db
    .prepare('INSERT INTO folders (id, user_id, kind, name, parent_id, position) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, userId, kind, name, parentId, position)
    .run();
  return { folder: (await getFolder(db, userId, id))!, created: true };
}

/**
 * Find a folder by name (case- and space-insensitive) at the top level, or make it.
 * For agents that file what they make by name ("HSK 2").
 */
export async function findOrCreateFolderByName(db: D1Database, userId: string, kind: FolderKind, name: unknown): Promise<{ folder: Folder; created: boolean }> {
  const key = folderNameKey(typeof name === 'string' ? name : '');
  const all = await listFolders(db, userId, kind);
  const hit = all.find((f) => folderNameKey(f.name) === key && !f.parent_id) ?? all.find((f) => folderNameKey(f.name) === key);
  if (hit) return { folder: hit, created: false };
  return createFolder(db, userId, { kind, name });
}

export async function updateFolder(
  db: D1Database,
  userId: string,
  id: string,
  patch: { name?: unknown; parent_id?: unknown },
): Promise<Folder> {
  const folder = await getFolder(db, userId, id);
  if (!folder) throw new FolderError('Folder not found', 404);
  let name = folder.name;
  if (patch.name !== undefined) {
    const problems = folderNameProblems(patch.name);
    if (problems.length) throw new FolderError(problems[0], 400, problems);
    name = cleanFolderName(patch.name);
  }
  let parentId = folder.parent_id ?? null;
  let position = folder.position;
  if (patch.parent_id !== undefined) {
    const next = typeof patch.parent_id === 'string' && patch.parent_id ? patch.parent_id : null;
    if (next !== parentId) {
      const all = await listFolders(db, userId, folder.kind);
      const err = parentProblem({ id: folder.id, kind: folder.kind }, next, all);
      if (err) throw new FolderError(err, 400, [err]);
      parentId = next;
      position = Math.max(-1, ...all.filter((f) => (f.parent_id ?? null) === next && f.id !== id).map((f) => f.position)) + 1;
    }
  }
  await db
    .prepare("UPDATE folders SET name = ?, parent_id = ?, position = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(name, parentId, position, id, userId)
    .run();
  return (await getFolder(db, userId, id))!;
}

/**
 * Delete a folder. Its items (and the items of… nothing else) go back to Unfiled; its
 * subfolders move to the top level with their items. Content is never deleted.
 */
export async function deleteFolder(db: D1Database, userId: string, id: string): Promise<{ unfiled: number; lifted: number }> {
  const folder = await getFolder(db, userId, id);
  if (!folder) throw new FolderError('Folder not found', 404);
  const t = ITEM_TABLES[folder.kind];
  const top = await db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM folders WHERE user_id = ? AND kind = ? AND parent_id IS NULL').bind(userId, folder.kind).first<{ p: number }>();
  const results = await db.batch([
    db.prepare(`UPDATE ${t.table} SET folder_id = NULL${t.bump ? ", updated_at = datetime('now')" : ''} WHERE ${t.owner} = ? AND folder_id = ?`).bind(userId, id),
    db.prepare("UPDATE folders SET parent_id = NULL, position = position + ?, updated_at = datetime('now') WHERE user_id = ? AND parent_id = ?").bind((top?.p ?? -1) + 1, userId, id),
    db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return { unfiled: results[0].meta?.changes ?? 0, lifted: results[1].meta?.changes ?? 0 };
}

/** Set the order of sibling folders (the ids given; others keep theirs, after them). */
export async function reorderFolders(db: D1Database, userId: string, kind: FolderKind, orderedIds: unknown): Promise<number> {
  if (!Array.isArray(orderedIds)) throw new FolderError('folder_ids must be an array');
  const ids = orderedIds.filter((x, i): x is string => typeof x === 'string' && !!x && orderedIds.indexOf(x) === i);
  if (ids.length > MAX_FOLDERS_PER_KIND) throw new FolderError('Too many folders');
  const mine = new Set((await listFolders(db, userId, kind)).map((f) => f.id));
  const known = ids.filter((id) => mine.has(id));
  if (!known.length) return 0;
  await db.batch(
    known.map((id, i) => db.prepare("UPDATE folders SET position = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(i, id, userId)),
  );
  return known.length;
}

/**
 * File items into a folder (or Unfiled with null). Only this user's items of that kind
 * move; ids that aren't theirs are reported in `not_found`. Idempotent.
 */
export async function moveToFolder(
  db: D1Database,
  userId: string,
  kind: FolderKind,
  ids: unknown,
  folderId: unknown,
): Promise<{ moved: number; not_found: string[]; folder_id: string | null }> {
  if (!Array.isArray(ids) || ids.length === 0) throw new FolderError('ids must be a non-empty array');
  const list = ids.filter((x, i): x is string => typeof x === 'string' && !!x && ids.indexOf(x) === i);
  if (list.length > 500) throw new FolderError('At most 500 items in one move');
  const target = await resolveFolderId(db, userId, kind, folderId);
  const t = ITEM_TABLES[kind];
  const found = new Set<string>();
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const res = await db
      .prepare(`SELECT id FROM ${t.table} WHERE ${t.owner} = ? AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(userId, ...chunk)
      .all<{ id: string }>();
    for (const r of res.results ?? []) found.add(r.id);
  }
  const mine = list.filter((id) => found.has(id));
  if (mine.length) {
    await db.batch(
      mine.map((id) =>
        db
          .prepare(`UPDATE ${t.table} SET folder_id = ?${t.bump ? ", updated_at = datetime('now')" : ''} WHERE id = ? AND ${t.owner} = ?`)
          .bind(target, id, userId),
      ),
    );
  }
  return { moved: mine.length, not_found: list.filter((id) => !found.has(id)), folder_id: target };
}

/** Item counts per folder id (for list views and the MCP). */
export async function folderItemCounts(db: D1Database, userId: string, kind: FolderKind): Promise<Record<string, number>> {
  const t = ITEM_TABLES[kind];
  const archived = kind === 'lesson' ? ' AND archived_at IS NULL' : '';
  const res = await db
    .prepare(`SELECT folder_id, COUNT(*) AS n FROM ${t.table} WHERE ${t.owner} = ? AND folder_id IS NOT NULL${archived} GROUP BY folder_id`)
    .bind(userId)
    .all<{ folder_id: string; n: number }>();
  return Object.fromEntries((res.results ?? []).map((r) => [r.folder_id, r.n]));
}

/** Set one item's folder right after it was created (create paths with `folder_id`). */
export async function fileItem(db: D1Database, userId: string, kind: FolderKind, itemId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const t = ITEM_TABLES[kind];
  await db.prepare(`UPDATE ${t.table} SET folder_id = ? WHERE id = ? AND ${t.owner} = ?`).bind(folderId, itemId, userId).run();
}
