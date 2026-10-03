/**
 * Folders for decks, Lesson Library items and graded readers (services/folders.ts,
 * shared/folders). Per user; mounted under /api after the auth middleware.
 *
 *   GET    /folders?kind=deck|lesson|reader   → { folders: [{ …folder, item_count }] }
 *   POST   /folders { kind, name, parent_id?, id? }        → 201 { folder } (200 when the client id exists)
 *   PATCH  /folders/:id { name?, parent_id? }              → { folder }
 *   DELETE /folders/:id                                    → { deleted: true, unfiled, lifted }
 *   PUT    /folders/reorder { kind, folder_ids }           → { reordered }
 *   POST   /folders/move { kind, ids, folder_id | null }   → { moved, not_found, folder_id }
 *
 * 400 carries `problems`. Deleting a folder never deletes content (items → Unfiled).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import type { FolderKind } from '@shared/folders';
import {
  FolderError,
  assertKind,
  createFolder,
  deleteFolder,
  folderItemCounts,
  listFolders,
  moveToFolder,
  reorderFolders,
  updateFolder,
} from '../services/folders';

const folders = new Hono<{ Bindings: Env }>();

export function folderErrorResponse(c: Context, err: unknown): Response | null {
  if (err instanceof FolderError) {
    return c.json({ error: err.message, ...(err.problems ? { problems: err.problems } : {}) }, err.status);
  }
  return null;
}

async function withErrors(c: Context, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const res = folderErrorResponse(c, err);
    if (res) return res;
    throw err;
  }
}

folders.get('/folders', (c) =>
  withErrors(c, async () => {
    const userId = c.get('user').id;
    const kindParam = c.req.query('kind');
    const kind: FolderKind | undefined = kindParam ? assertKind(kindParam) : undefined;
    const rows = await listFolders(c.env.DB, userId, kind);
    const kinds: FolderKind[] = kind ? [kind] : (['deck', 'lesson', 'reader'] as FolderKind[]).filter((k) => rows.some((f) => f.kind === k));
    const counts: Record<string, number> = {};
    for (const k of kinds) Object.assign(counts, await folderItemCounts(c.env.DB, userId, k));
    return c.json({ folders: rows.map((f) => ({ ...f, item_count: counts[f.id] ?? 0 })) });
  }),
);

folders.post('/folders', (c) =>
  withErrors(c, async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const { folder, created } = await createFolder(c.env.DB, c.get('user').id, {
      kind: body.kind,
      name: body.name,
      parent_id: body.parent_id,
      id: body.id,
    });
    return c.json({ folder }, created ? 201 : 200);
  }),
);

// Registered before /folders/:id.
folders.put('/folders/reorder', (c) =>
  withErrors(c, async () => {
    const body = await c.req.json<{ kind?: unknown; folder_ids?: unknown }>().catch(() => ({} as { kind?: unknown; folder_ids?: unknown }));
    const reordered = await reorderFolders(c.env.DB, c.get('user').id, assertKind(body.kind), body.folder_ids);
    return c.json({ reordered });
  }),
);

folders.post('/folders/move', (c) =>
  withErrors(c, async () => {
    const body = await c.req.json<{ kind?: unknown; ids?: unknown; folder_id?: unknown }>().catch(() => ({} as { kind?: unknown; ids?: unknown; folder_id?: unknown }));
    if (!('folder_id' in body)) return c.json({ error: 'folder_id is required (null = Unfiled)' }, 400);
    const result = await moveToFolder(c.env.DB, c.get('user').id, assertKind(body.kind), body.ids, body.folder_id);
    return c.json(result);
  }),
);

folders.patch('/folders/:id', (c) =>
  withErrors(c, async () => {
    const body = await c.req.json<{ name?: unknown; parent_id?: unknown }>().catch(() => ({} as { name?: unknown; parent_id?: unknown }));
    const folder = await updateFolder(c.env.DB, c.get('user').id, c.req.param('id'), { name: body.name, parent_id: body.parent_id });
    return c.json({ folder });
  }),
);

folders.delete('/folders/:id', (c) =>
  withErrors(c, async () => {
    const result = await deleteFolder(c.env.DB, c.get('user').id, c.req.param('id'));
    return c.json({ deleted: true, ...result });
  }),
);

export default folders;
