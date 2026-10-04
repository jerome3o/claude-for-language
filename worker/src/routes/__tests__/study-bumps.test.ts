/**
 * "⚡ Study it today" (routes/study-bumps.ts + services/study-bumps.ts) against real
 * SQLite with every migration: bump by note id / hanzi / client item (idempotent),
 * ownership, the server's lazy done (every bumped card reviewed since the bump),
 * re-opening a finished bump, clearing, the tutor variant, and bumps on /sync/changes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import studyBumps from '../study-bumps';
import { listActiveBumps } from '../../services/study-bumps';
import { executeBumpCardsTool, BUMP_CARDS_TOOL } from '../../services/ai';
import type { Env } from '../../types';

const ME = 'user-1';
const OTHER = 'user-2';
const TUTOR = 'tutor-1';

function seed(db: SqliteD1) {
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [ME, 'me@x.test', 'Jerome']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [OTHER, 'o@x.test', 'Other']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [TUTOR, 't@x.test', 'Minghui']);
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-1', ?, 'HSK 2')", [ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-x', ?, 'Theirs')", [OTHER]);
  const note = (id: string, deck: string, hanzi: string) =>
    db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, 'pīnyīn', 'meaning')", [id, deck, hanzi]);
  note('n-bank', 'd-1', '银行');
  note('n-apple', 'd-1', '苹果');
  note('n-x', 'd-x', '银行');
  const card = (id: string, noteId: string, type: string, queue = 0, next: string | null = null) =>
    db.raw.run('INSERT INTO cards (id, note_id, card_type, queue, next_review_at) VALUES (?, ?, ?, ?, ?)', [id, noteId, type, queue, next]);
  card('c-bank-h', 'n-bank', 'hanzi_to_meaning');
  card('c-bank-m', 'n-bank', 'meaning_to_hanzi');
  card('c-apple-h', 'n-apple', 'hanzi_to_meaning', 2, '2027-01-01T00:00:00.000Z');
  card('c-x', 'n-x', 'hanzi_to_meaning');
}

function client(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', studyBumps);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

function review(db: SqliteD1, id: string, cardId: string, at: string) {
  db.raw.run('INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, 2, ?)', [id, cardId, ME, at]);
}

describe('study bumps', () => {
  let db: SqliteD1;
  let env: Env;
  let me: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    env = { DB: db } as unknown as Env;
    me = client(env, ME);
  });

  it('bumps by hanzi among MY notes only, and is idempotent', async () => {
    const a = await me('POST', '/me/bumps', { hanzi: ['银 行'], source: 'mcp' });
    expect(a.status).toBe(200);
    expect(a.json.added).toEqual([{ note_id: 'n-bank', hanzi: '银行' }]);
    expect(a.json.bumps.map((b: any) => [b.note_id, b.deck_name, b.source])).toEqual([['n-bank', 'HSK 2', 'mcp']]);
    const again = await me('POST', '/me/bumps', { note_ids: ['n-bank'] });
    expect(again.json.added).toEqual([]);
    expect(again.json.already).toEqual([{ note_id: 'n-bank', hanzi: '银行' }]);
    const theirs = await me('POST', '/me/bumps', { note_ids: ['n-x'], hanzi: ['不存在'] });
    expect(theirs.status).toBe(404);
    expect(theirs.json.not_found).toEqual(['n-x', '不存在']);
    expect((await me('POST', '/me/bumps', {})).status).toBe(400);
  });

  it('offline items keep their client id and bump time', async () => {
    const r = await me('POST', '/me/bumps', { items: [{ id: 'client-1', note_id: 'n-apple', created_at: '2026-10-04T08:00:00.000Z', source: 'coach' }] });
    expect(r.json.bumps[0]).toMatchObject({ id: 'client-1', note_id: 'n-apple', created_at: '2026-10-04T08:00:00.000Z', source: 'coach', bumped_by_name: null });
    const retry = await me('POST', '/me/bumps', { items: [{ id: 'client-1', note_id: 'n-apple' }] });
    expect(retry.json.already).toHaveLength(1);
  });

  it('is done once every bumped card is reviewed since the bump; a re-bump re-opens it', async () => {
    await me('POST', '/me/bumps', { items: [{ id: 'b1', note_id: 'n-bank', created_at: '2026-10-01T08:00:00.000Z' }] });
    review(db, 'e0', 'c-bank-h', '2026-09-30T08:00:00.000Z'); // before the bump: doesn't count
    review(db, 'e1', 'c-bank-h', '2026-10-01T09:00:00.000Z');
    expect((await me('GET', '/me/bumps')).json.bumps).toHaveLength(1); // m still open
    review(db, 'e2', 'c-bank-m', '2026-10-01T09:01:00.000Z');
    expect((await me('GET', '/me/bumps')).json.bumps).toEqual([]);
    expect(db.rows<{ done_at: string | null }>("SELECT done_at FROM study_bumps WHERE id = 'b1'")[0].done_at).not.toBeNull();
    // A retry of the same upload keeps it finished; a NEW bump re-opens the row.
    expect((await me('POST', '/me/bumps', { items: [{ id: 'b1', note_id: 'n-bank' }] })).json.bumps).toEqual([]);
    const re = await me('POST', '/me/bumps', { note_ids: ['n-bank'] });
    expect(re.json.added).toHaveLength(1);
    expect(re.json.bumps.map((b: any) => b.id)).toEqual(['b1']);
  });

  it('an early review: one reviewed card ends a bump of a note in review', async () => {
    await me('POST', '/me/bumps', { items: [{ id: 'b2', note_id: 'n-apple', created_at: '2026-10-04T08:00:00.000Z' }] });
    review(db, 'e3', 'c-apple-h', '2026-09-01T08:00:00.000Z');
    expect(await listActiveBumps(db, ME)).toHaveLength(1);
    review(db, 'e4', 'c-apple-h', '2026-10-04T08:30:00.000Z');
    expect(await listActiveBumps(db, ME)).toEqual([]);
  });

  it('clears by hand (idempotent)', async () => {
    await me('POST', '/me/bumps', { note_ids: ['n-bank', 'n-apple'] });
    const r = await me('DELETE', '/me/bumps/n-bank');
    expect(r.json.cleared).toBe(1);
    expect(r.json.bumps.map((b: any) => b.note_id)).toEqual(['n-apple']);
    expect((await me('DELETE', '/me/bumps/n-bank')).json.cleared).toBe(0);
  });

  it('the tutor bumps the student’s card; nobody else can', async () => {
    const tutor = client(env, TUTOR);
    const r = await tutor('POST', '/relationships/rel-1/student-bumps', { hanzi: ['苹果'] });
    expect(r.status).toBe(200);
    expect(r.json.added).toEqual([{ note_id: 'n-apple', hanzi: '苹果' }]);
    const mine = await me('GET', '/me/bumps');
    expect(mine.json.bumps[0]).toMatchObject({ note_id: 'n-apple', source: 'tutor', bumped_by_name: 'Minghui' });
    expect((await me('POST', '/relationships/rel-1/student-bumps', { hanzi: ['苹果'] })).status).toBe(403);
    expect((await client(env, OTHER)('POST', '/relationships/rel-1/student-bumps', { hanzi: ['苹果'] })).status).toBe(403);
  });

  it('the in-app agents’ bump_cards tool bumps existing words and says what it could not find', async () => {
    expect(BUMP_CARDS_TOOL.name).toBe('bump_cards');
    const r = await executeBumpCardsTool({ hanzi: ['银行', '火车'] }, { db, userId: ME }, 'coach_chat');
    expect(r).toMatchObject({ bumped: ['银行'], already_bumped: [], not_found: ['火车'] });
    const again = await executeBumpCardsTool({ note_ids: ['n-bank'] }, { db, userId: ME }, 'coach_chat');
    expect(again).toMatchObject({ bumped: [], already_bumped: ['银行'] });
    expect(await executeBumpCardsTool({}, { db, userId: ME }, 'coach_chat')).toEqual({ error: 'Give note_ids or hanzi' });
    expect((await listActiveBumps(db, ME))[0].source).toBe('coach_chat');
  });
});
