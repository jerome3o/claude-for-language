/**
 * Folders (routes/folders.ts + services/folders.ts) against real SQLite with every
 * migration: per-user ownership, nesting up to 5 levels (no cycles), delete → Unfiled
 * (content kept, subfolders lifted one level), moves (decks re-dated for sync, queue untouched), reorder,
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

  it('nests up to five levels, never in a cycle', async () => {
    const chain: any[] = [];
    for (const name of ['Stories', 'Paris', 'Week 1', 'Monday', 'Morning']) {
      const r = await me('POST', '/folders', { kind: 'reader', name, parent_id: chain.at(-1)?.id ?? null });
      expect(r.status).toBe(201);
      chain.push(r.json.folder);
    }
    expect(chain[4].parent_id).toBe(chain[3].id);
    // A sixth level is refused.
    const deeper = await me('POST', '/folders', { kind: 'reader', name: 'Too deep', parent_id: chain[4].id });
    expect(deeper.status).toBe(400);
    expect(deeper.json.problems[0]).toMatch(/5 levels deep/);
    // A folder can't go inside its own subfolder.
    const cycle = await me('PATCH', `/folders/${chain[0].id}`, { parent_id: chain[2].id });
    expect(cycle.status).toBe(400);
    expect(cycle.json.problems[0]).toMatch(/one of its own folders/);
    // A folder with two levels inside it fits only where the whole subtree stays within five.
    const other2 = (await me('POST', '/folders', { kind: 'reader', name: 'Other' })).json.folder;
    const o2 = (await me('POST', '/folders', { kind: 'reader', name: 'Other 2', parent_id: other2.id })).json.folder;
    expect((await me('PATCH', `/folders/${other2.id}`, { parent_id: chain[3].id })).status).toBe(400);
    const moved = await me('PATCH', `/folders/${other2.id}`, { parent_id: chain[2].id });
    expect(moved.status).toBe(200);
    expect(moved.json.folder.parent_id).toBe(chain[2].id);
    expect((await one(db, 'SELECT parent_id FROM folders WHERE id = ?', [o2.id])).parent_id).toBe(other2.id);
    // Any subfolder can come back to the top level.
    expect((await me('PATCH', `/folders/${chain[3].id}`, { parent_id: null })).json.folder.parent_id).toBeNull();
  });

  it('deleting a nested folder lifts its subfolders one level, into its parent', async () => {
    const a = (await me('POST', '/folders', { kind: 'deck', name: 'A' })).json.folder;
    const keep = (await me('POST', '/folders', { kind: 'deck', name: 'Keep', parent_id: a.id })).json.folder;
    const b = (await me('POST', '/folders', { kind: 'deck', name: 'B', parent_id: a.id })).json.folder;
    const c = (await me('POST', '/folders', { kind: 'deck', name: 'C', parent_id: b.id })).json.folder;
    const d = (await me('POST', '/folders', { kind: 'deck', name: 'D', parent_id: c.id })).json.folder;
    await me('POST', '/folders/move', { kind: 'deck', ids: ['d-1'], folder_id: b.id });
    await me('POST', '/folders/move', { kind: 'deck', ids: ['d-2'], folder_id: d.id });
    const del = await me('DELETE', `/folders/${b.id}`);
    expect(del.json).toEqual({ deleted: true, unfiled: 1, lifted: 1 });
    const left = await listFolders(db, ME, 'deck');
    const byName = Object.fromEntries(left.map((f) => [f.name, f]));
    expect(byName.C.parent_id).toBe(a.id); // up one level, after Keep
    expect(byName.C.position).toBeGreaterThan(byName.Keep.position);
    expect(byName.D.parent_id).toBe(c.id); // everything inside C stays inside
    expect(keep.parent_id).toBe(a.id);
    expect((await one(db, "SELECT folder_id FROM decks WHERE id = 'd-1'")).folder_id).toBeNull();
    expect((await one(db, "SELECT folder_id FROM decks WHERE id = 'd-2'")).folder_id).toBe(d.id);
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

  it('find-or-create by path makes the missing steps inside each other', async () => {
    const made = await findOrCreateFolderByName(db, ME, 'deck', 'HSK 2 / Week 1 / Monday');
    expect(made.created).toBe(true);
    const all = await listFolders(db, ME, 'deck');
    const byName = Object.fromEntries(all.map((f) => [f.name, f]));
    expect(byName['Week 1'].parent_id).toBe(byName['HSK 2'].id);
    expect(made.folder.parent_id).toBe(byName['Week 1'].id);
    const again = await findOrCreateFolderByName(db, ME, 'deck', 'hsk 2 › week 1 › monday');
    expect(again).toMatchObject({ created: false, folder: { id: made.folder.id } });
    // One name finds it at any depth; a new branch reuses the existing steps.
    expect((await findOrCreateFolderByName(db, ME, 'deck', 'Monday')).folder.id).toBe(made.folder.id);
    const tue = await findOrCreateFolderByName(db, ME, 'deck', 'HSK 2/Week 1/Tuesday');
    expect(tue.folder.parent_id).toBe(byName['Week 1'].id);
    expect((await listFolders(db, ME, 'deck')).length).toBe(4);
  });
});
