/**
 * Folders (routes/folders.ts + services/folders.ts) against real SQLite with every
 * migration: per-user ownership, one level of nesting, delete → Unfiled (content
 * kept, subfolders lifted), moves (decks re-dated for sync, queue untouched), reorder,
 * folder_id on the create paths and in /api/sync/changes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import folders from '../folders';
import { findOrCreateFolderByName, listFolders, resolveFolderId } from '../../services/folders';
import type { Env } from '../../types';

const ME = 'user-1';
const OTHER = 'user-2';

function seed(db: SqliteD1) {
  for (const id of [ME, OTHER]) db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [id, `${id}@x.test`, id]);
  db.raw.run("INSERT INTO decks (id, user_id, name, study_priority, updated_at) VALUES ('d-1', ?, 'HSK 1', 3, '2026-01-01 00:00:00')", [ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name, study_priority, updated_at) VALUES ('d-2', ?, 'Food', 2, '2026-01-01 00:00:00')", [ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name, study_priority) VALUES ('d-x', ?, 'Not mine', 1)", [OTHER]);
  db.raw.run("INSERT INTO lesson_library (id, owner_id, title, spec, updated_at) VALUES ('l-1', ?, '把 sentences', '{}', '2026-01-01 00:00:00')", [ME]);
  db.raw.run("INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('r-1', ?, '小明在巴黎', 'Xiaoming in Paris', 'beginner', '[]', '[]')", [ME]);
}

function client(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', folders);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

async function one<T = any>(db: SqliteD1, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.prepare(sql).bind(...params).first<T>()) as T;
}

describe('folders', () => {
  let db: SqliteD1;
  let env: Env;
  let me: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    env = { DB: db } as unknown as Env;
    me = client(env, ME);
    other = client(env, OTHER);
  });

  it('creates, lists with counts, renames, validates', async () => {
    const a = await me('POST', '/folders', { kind: 'deck', name: '  HSK   levels ' });
    expect(a.status).toBe(201);
    expect(a.json.folder).toMatchObject({ kind: 'deck', name: 'HSK levels', parent_id: null, position: 0 });
    const b = await me('POST', '/folders', { kind: 'deck', name: 'Topics' });
    expect(b.json.folder.position).toBe(1);
    expect((await me('POST', '/folders', { kind: 'deck', name: '' })).json.problems).toEqual(['Give the folder a name']);
    expect((await me('POST', '/folders', { kind: 'cards', name: 'x' })).status).toBe(400);

    await me('POST', '/folders/move', { kind: 'deck', ids: ['d-1', 'd-2'], folder_id: a.json.folder.id });
    const list = await me('GET', '/folders?kind=deck');
    expect(list.json.folders.map((f: any) => [f.name, f.item_count])).toEqual([['HSK levels', 2], ['Topics', 0]]);

    const renamed = await me('PATCH', `/folders/${b.json.folder.id}`, { name: 'Themes' });
    expect(renamed.json.folder.name).toBe('Themes');
  });

  it('is idempotent by client id', async () => {
    const first = await me('POST', '/folders', { kind: 'lesson', name: 'Grammar', id: 'client-folder-1' });
    const again = await me('POST', '/folders', { kind: 'lesson', name: 'Grammar', id: 'client-folder-1' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.json.folder.id).toBe('client-folder-1');
    expect((await other('POST', '/folders', { kind: 'lesson', name: 'Mine', id: 'client-folder-1' })).status).toBe(409);
  });

  it("never touches another user's folders or items", async () => {
    const mine = (await me('POST', '/folders', { kind: 'deck', name: 'Mine' })).json.folder;
    expect((await other('PATCH', `/folders/${mine.id}`, { name: 'Hacked' })).status).toBe(404);
    expect((await other('DELETE', `/folders/${mine.id}`)).status).toBe(404);
    expect((await other('GET', '/folders')).json.folders).toEqual([]);
    // Moving into someone else's folder: 400; moving someone else's deck: not_found.
    expect((await other('POST', '/folders/move', { kind: 'deck', ids: ['d-x'], folder_id: mine.id })).status).toBe(400);
    const move = await me('POST', '/folders/move', { kind: 'deck', ids: ['d-1', 'd-x'], folder_id: mine.id });
    expect(move.json).toEqual({ moved: 1, not_found: ['d-x'], folder_id: mine.id });
    expect((await one(db, "SELECT folder_id FROM decks WHERE id = 'd-x'")).folder_id).toBeNull();
  });

  it('a folder of one kind holds only that kind', async () => {
    const lessons = (await me('POST', '/folders', { kind: 'lesson', name: 'Lessons' })).json.folder;
    expect((await me('POST', '/folders/move', { kind: 'deck', ids: ['d-1'], folder_id: lessons.id })).status).toBe(400);
    const ok = await me('POST', '/folders/move', { kind: 'lesson', ids: ['l-1'], folder_id: lessons.id });
    expect(ok.json.moved).toBe(1);
    // A move is not an edit: the library keeps its updated_at order.
    expect((await one(db, "SELECT updated_at FROM lesson_library WHERE id = 'l-1'")).updated_at).toBe('2026-01-01 00:00:00');
  });

  it('moving decks re-dates them for sync and leaves the study queue alone', async () => {
    const f = (await me('POST', '/folders', { kind: 'deck', name: 'F' })).json.folder;
    await me('POST', '/folders/move', { kind: 'deck', ids: ['d-2'], folder_id: f.id });
    const row = await one(db, "SELECT folder_id, study_priority, updated_at FROM decks WHERE id = 'd-2'");
    expect(row.folder_id).toBe(f.id);
    expect(row.study_priority).toBe(2);
    expect(row.updated_at > '2026-01-01 00:00:00').toBe(true);
    // Back to Unfiled with null.
    await me('POST', '/folders/move', { kind: 'deck', ids: ['d-2'], folder_id: null });
    expect((await one(db, "SELECT folder_id FROM decks WHERE id = 'd-2'")).folder_id).toBeNull();
    expect((await me('POST', '/folders/move', { kind: 'deck', ids: ['d-2'] })).status).toBe(400);
  });

  it('nests one level only', async () => {
    const top = (await me('POST', '/folders', { kind: 'reader', name: 'Stories' })).json.folder;
    const sub = await me('POST', '/folders', { kind: 'reader', name: 'Paris', parent_id: top.id });
    expect(sub.status).toBe(201);
    expect(sub.json.folder.parent_id).toBe(top.id);
    const deeper = await me('POST', '/folders', { kind: 'reader', name: 'Too deep', parent_id: sub.json.folder.id });
    expect(deeper.status).toBe(400);
    const other2 = (await me('POST', '/folders', { kind: 'reader', name: 'Other' })).json.folder;
    expect((await me('PATCH', `/folders/${top.id}`, { parent_id: other2.id })).status).toBe(400);
    // A subfolder can come back to the top level.
    expect((await me('PATCH', `/folders/${sub.json.folder.id}`, { parent_id: null })).json.folder.parent_id).toBeNull();
  });

  it('delete moves items to Unfiled, lifts subfolders, deletes no content', async () => {
    const top = (await me('POST', '/folders', { kind: 'deck', name: 'Top' })).json.folder;
    const sub = (await me('POST', '/folders', { kind: 'deck', name: 'Sub', parent_id: top.id })).json.folder;
    await me('POST', '/folders/move', { kind: 'deck', ids: ['d-1'], folder_id: top.id });
    await me('POST', '/folders/move', { kind: 'deck', ids: ['d-2'], folder_id: sub.id });
    const del = await me('DELETE', `/folders/${top.id}`);
    expect(del.json).toEqual({ deleted: true, unfiled: 1, lifted: 1 });
    expect((await one(db, "SELECT COUNT(*) AS n FROM decks WHERE user_id = ?", [ME])).n).toBe(2);
    expect((await one(db, "SELECT folder_id FROM decks WHERE id = 'd-1'")).folder_id).toBeNull();
    expect((await one(db, "SELECT folder_id FROM decks WHERE id = 'd-2'")).folder_id).toBe(sub.id);
    const left = await listFolders(db, ME, 'deck');
    expect(left.map((f) => [f.name, f.parent_id])).toEqual([['Sub', null]]);
  });

  it('reorders siblings', async () => {
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) ids.push((await me('POST', '/folders', { kind: 'deck', name })).json.folder.id);
    const r = await me('PUT', '/folders/reorder', { kind: 'deck', folder_ids: [ids[2], ids[0], ids[1], 'not-mine'] });
    expect(r.json.reordered).toBe(3);
    expect((await listFolders(db, ME, 'deck')).map((f) => f.name)).toEqual(['C', 'A', 'B']);
  });

  it('find-or-create by name for agents', async () => {
    const a = await findOrCreateFolderByName(db, ME, 'lesson', 'HSK 2');
    const b = await findOrCreateFolderByName(db, ME, 'lesson', ' hsk  2 ');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.folder.id).toBe(a.folder.id);
    await expect(resolveFolderId(db, ME, 'deck', a.folder.id)).rejects.toThrow(/No deck folder/);
    expect(await resolveFolderId(db, ME, 'lesson', a.folder.id)).toBe(a.folder.id);
    expect(await resolveFolderId(db, ME, 'lesson', null)).toBeNull();
  });
});
