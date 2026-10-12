/**
 * "Up next" against a REAL SQLite with every migration: add (ids / hanzi / client ids,
 * positions, moves, refusals), reorder, remove (the note is kept), done once every card
 * has a review, and the tutor routes (only the student's tutor, added_by shown).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { addUpNext, listUpNext, removeUpNext, reorderUpNextRows } from '../up-next';
import upNextRoutes from '../../routes/up-next';
import type { Env } from '../../types';

const ME = 'learner-1';
const TUTOR = 'tutor-1';
const OTHER = 'stranger-1';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function addNote(db: SqliteD1, id: string, deck: string, hanzi: string, reviewedCards = 0) {
  exec(db, 'INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', id, deck, hanzi, 'pīnyīn', 'meaning');
  ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'].forEach((t, i) => {
    exec(db, 'INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)', `${id}-${i}`, id, t);
    if (i < reviewedCards) {
      exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, 2, '2026-10-10')", `ev-${id}-${i}`, `${id}-${i}`, ME);
    }
  });
}

function seed(db: SqliteD1) {
  for (const [id, name] of [[ME, 'Jerome'], [TUTOR, 'Minghui'], [OTHER, 'Someone']]) {
    exec(db, 'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', id, `${id}@example.com`, name, 'student');
  }
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", ME, TUTOR);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d1', ?, 'HSK 2')", ME);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d2', ?, 'Food')", ME);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('t1', ?, 'Tutor deck')", TUTOR);
  addNote(db, 'yinhang', 'd1', '银行');
  addNote(db, 'xuesheng', 'd1', '学生');
  addNote(db, 'pingguo', 'd2', '苹果');
  addNote(db, 'started', 'd2', '面条', 1);
  addNote(db, 'done', 'd2', '米饭', 3);
  addNote(db, 'theirs', 't1', '老师');
}

let db: SqliteD1;
beforeEach(async () => {
  db = await createSqliteD1();
  seed(db);
});

const order = async (user = ME) => (await listUpNext(db, user)).map((e) => e.note_id);

describe('up next service', () => {
  it('adds at the bottom by default, at the top / an index when asked, with status and deck', async () => {
    const r = await addUpNext(db, ME, { noteIds: ['yinhang', 'pingguo'] });
    expect(r.added.map((a) => a.hanzi)).toEqual(['银行', '苹果']);
    await addUpNext(db, ME, { noteIds: ['started'], position: 'top' });
    await addUpNext(db, ME, { hanzi: ['学生'], position: 1 });
    const list = await listUpNext(db, ME);
    expect(list.map((e) => e.note_id)).toEqual(['started', 'xuesheng', 'yinhang', 'pingguo']);
    expect(list.map((e) => e.position)).toEqual([0, 1, 2, 3]);
    expect(list[0]).toMatchObject({ status: 'started', new_cards: 2, total_cards: 3, deck_name: 'Food', added_by_name: null });
    expect(list[2]).toMatchObject({ status: 'new', new_cards: 3, hanzi: '银行' });
  });

  it('a note already on the list stays — or moves when a position is given', async () => {
    await addUpNext(db, ME, { noteIds: ['yinhang', 'xuesheng', 'pingguo'] });
    const again = await addUpNext(db, ME, { noteIds: ['pingguo'] });
    expect(again.already.map((a) => a.note_id)).toEqual(['pingguo']);
    expect(await order()).toEqual(['yinhang', 'xuesheng', 'pingguo']);
    const moved = await addUpNext(db, ME, { noteIds: ['pingguo'], position: 'top' });
    expect(moved.moved.map((a) => a.note_id)).toEqual(['pingguo']);
    expect(await order()).toEqual(['pingguo', 'yinhang', 'xuesheng']);
  });

  it('refuses studied notes and other people’s notes; idempotent by client id', async () => {
    const r = await addUpNext(db, ME, { noteIds: ['done', 'theirs', 'nope'], items: [{ id: 'client-1', note_id: 'yinhang' }] });
    expect(r.no_new_cards.map((a) => a.hanzi)).toEqual(['米饭']);
    expect(r.not_found).toEqual(['theirs', 'nope']);
    expect(r.added.map((a) => a.note_id)).toEqual(['yinhang']);
    expect(db.rows('SELECT id FROM up_next')).toEqual([{ id: 'client-1' }]);
    // The outbox retries after the word was taken off: it stays off.
    await removeUpNext(db, ME, ['yinhang']);
    const retry = await addUpNext(db, ME, { items: [{ id: 'client-1', note_id: 'yinhang' }] });
    expect(retry.already.map((a) => a.note_id)).toEqual(['yinhang']);
    expect(await order()).toEqual([]);
    // A fresh add re-opens the row.
    await addUpNext(db, ME, { items: [{ id: 'client-2', note_id: 'yinhang' }] });
    expect(await order()).toEqual(['yinhang']);
  });

  it('reorders (unknown ids ignored, the rest kept after) and removes without touching the note', async () => {
    await addUpNext(db, ME, { noteIds: ['yinhang', 'xuesheng', 'pingguo', 'started'] });
    expect((await reorderUpNextRows(db, ME, ['pingguo', 'ghost', 'yinhang'])).map((e) => e.note_id)).toEqual(['pingguo', 'yinhang', 'xuesheng', 'started']);
    expect(await removeUpNext(db, ME, ['yinhang'])).toBe(1);
    expect(await removeUpNext(db, ME, ['yinhang'])).toBe(0);
    expect(await order()).toEqual(['pingguo', 'xuesheng', 'started']);
    expect(db.rows("SELECT id FROM notes WHERE id = 'yinhang'")).toHaveLength(1);
    expect((await listUpNext(db, ME)).map((e) => e.position)).toEqual([0, 1, 2]);
  });

  it('a note whose every card has a review leaves the list (done_at), a deleted note drops out', async () => {
    await addUpNext(db, ME, { noteIds: ['started', 'pingguo'] });
    exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('e1', 'started-1', ?, 2, '2026-10-11')", ME);
    exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('e2', 'started-2', ?, 2, '2026-10-11')", ME);
    expect(await order()).toEqual(['pingguo']);
    expect(db.rows<{ done_at: string | null }>("SELECT done_at FROM up_next WHERE note_id = 'started'")[0].done_at).not.toBeNull();
    exec(db, "DELETE FROM cards WHERE note_id = 'pingguo'");
    exec(db, "DELETE FROM notes WHERE id = 'pingguo'");
    expect(await order()).toEqual([]);
  });
});

describe('up next routes', () => {
  function app(userId: string) {
    const a = new Hono<{ Bindings: Env }>();
    a.use('*', async (c, next) => {
      c.set('user' as never, { id: userId } as never);
      await next();
    });
    a.route('/api', upNextRoutes);
    const env = { DB: db } as unknown as Env;
    return (path: string, init?: RequestInit) => a.request(path, init, env);
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  it('the learner: add, reorder, remove; 400 / 404', async () => {
    const req = app(ME);
    expect((await req('/api/me/up-next', json('POST', {}))).status).toBe(400);
    expect((await req('/api/me/up-next', json('POST', { hanzi: ['不在'] }))).status).toBe(404);
    const add = await req('/api/me/up-next', json('POST', { hanzi: '银行', source: 'search' }));
    expect(add.status).toBe(200);
    await req('/api/me/up-next', json('POST', { note_ids: ['pingguo'], position: 'top' }));
    const list = (await (await req('/api/me/up-next')).json()) as { up_next: Array<{ note_id: string }> };
    expect(list.up_next.map((e) => e.note_id)).toEqual(['pingguo', 'yinhang']);
    const re = (await (await req('/api/me/up-next/order', json('PUT', { note_ids: ['yinhang'] }))).json()) as { up_next: Array<{ note_id: string }> };
    expect(re.up_next.map((e) => e.note_id)).toEqual(['yinhang', 'pingguo']);
    const del = (await (await req('/api/me/up-next/yinhang', { method: 'DELETE' })).json()) as { removed: number };
    expect(del.removed).toBe(1);
    expect(await order()).toEqual(['pingguo']);
  });

  it('the tutor edits the student’s list (added by her); anyone else is refused', async () => {
    const tutor = app(TUTOR);
    const r = await tutor('/api/relationships/rel-1/student-up-next', json('POST', { hanzi: ['学生'] }));
    expect(r.status).toBe(200);
    const mine = await listUpNext(db, ME);
    expect(mine[0]).toMatchObject({ note_id: 'xuesheng', added_by_name: 'Minghui', source: 'tutor' });
    expect((await tutor('/api/relationships/rel-1/student-up-next')).status).toBe(200);
    expect((await tutor('/api/relationships/rel-1/student-up-next/xuesheng', { method: 'DELETE' })).status).toBe(200);
    expect(await order()).toEqual([]);
    // The student can't use the tutor route, a stranger can't either.
    expect((await app(ME)('/api/relationships/rel-1/student-up-next')).status).toBe(403);
    expect((await app(OTHER)('/api/relationships/rel-1/student-up-next', json('POST', { hanzi: ['学生'] }))).status).toBe(403);
    expect((await app(TUTOR)('/api/relationships/nope/student-up-next')).status).toBe(404);
  });

  it('the tutor searches the student’s notes with their card state', async () => {
    await addUpNext(db, ME, { noteIds: ['pingguo'] });
    const res = await app(TUTOR)('/api/relationships/rel-1/student-notes/search?q=' + encodeURIComponent('米'));
    const body = (await res.json()) as { notes: Array<{ id: string; new_cards: number; on_up_next: boolean }> };
    expect(body.notes.map((n) => [n.id, n.new_cards])).toEqual([['done', 0]]);
    const apple = (await (await app(TUTOR)('/api/relationships/rel-1/student-notes/search?q=pingguo')).json()) as typeof body;
    expect(apple.notes).toEqual([]); // the seeded pinyin is a placeholder
    const byHanzi = (await (await app(TUTOR)('/api/relationships/rel-1/student-notes/search?q=' + encodeURIComponent('苹果'))).json()) as typeof body;
    expect(byHanzi.notes[0]).toMatchObject({ id: 'pingguo', new_cards: 3, on_up_next: true });
    expect((await app(ME)('/api/relationships/rel-1/student-notes/search?q=a')).status).toBe(403);
  });
});
