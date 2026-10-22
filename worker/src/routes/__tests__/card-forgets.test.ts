/**
 * "Forget this card" (routes/card-forgets.ts + services/card-forgets.ts) against real SQLite with
 * every migration: forget by card / note / client item (idempotent, my cards only), the card's
 * cached state goes back to NEW and the reviews stay, later reviews replay from the forget, Undo
 * restores the old state, and the forget never appears among the review events.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import cardForgets from '../card-forgets';
import { recomputeCards } from '../../services/card-forgets';
import type { Env } from '../../types';

const ME = 'user-1';
const OTHER = 'user-2';

function seed(db: SqliteD1) {
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [ME, 'me@x.test', 'Jerome']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [OTHER, 'o@x.test', 'Other']);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-1', ?, 'HSK 2')", [ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-x', ?, 'Theirs')", [OTHER]);
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-bank', 'd-1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-x', 'd-x', '银行', 'yínháng', 'bank')");
  for (const [id, note, type] of [['c-h', 'n-bank', 'hanzi_to_meaning'], ['c-m', 'n-bank', 'meaning_to_hanzi'], ['c-x', 'n-x', 'hanzi_to_meaning']]) {
    db.raw.run('INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)', [id, note, type]);
  }
  const ev = (id: string, card: string, rating: number, at: string) =>
    db.raw.run('INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, ?, ?)', [id, card, ME, rating, at]);
  ev('e1', 'c-h', 2, '2026-01-01T10:00:00.000Z');
  ev('e2', 'c-h', 2, '2026-01-01T10:15:00.000Z');
  ev('e3', 'c-h', 2, '2026-01-03T10:00:00.000Z');
  ev('e4', 'c-m', 3, '2026-01-02T10:00:00.000Z');
}

function client(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', cardForgets);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

const card = async (db: SqliteD1, id: string) =>
  (await (db as unknown as D1Database).prepare('SELECT queue, lapses, next_review_at, repetitions FROM cards WHERE id = ?').bind(id)
    .first<{ queue: number; lapses: number; next_review_at: string | null; repetitions: number }>())!;

describe('card forgets', () => {
  let db: SqliteD1;
  let env: Env;
  let me: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    env = { DB: db } as unknown as Env;
    me = client(env, ME);
    await recomputeCards(db as unknown as D1Database, ME, ['c-h', 'c-m']);
  });

  it('puts the card back to NEW, keeps the reviews, idempotent by client id, my cards only', async () => {
    expect((await card(db, 'c-h')).queue).not.toBe(0);
    const r = await me('POST', '/me/card-forgets', {
      items: [
        { id: 'f1', card_id: 'c-h', forgotten_at: '2026-01-05T09:00:00.000Z', source: 'study' },
        { id: 'f2', card_id: 'c-x' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.added).toEqual(['c-h']);
    expect(r.json.not_found).toEqual(['c-x']);
    expect(r.json.forgets).toEqual([{ id: 'f1', card_id: 'c-h', forgotten_at: '2026-01-05T09:00:00.000Z', source: 'study' }]);
    expect((await card(db, 'c-h'))).toMatchObject({ queue: 0, lapses: 0, next_review_at: null, repetitions: 0 });
    // The reviews are history: still there, and the forget is not one of them.
    const events = await (db as unknown as D1Database).prepare('SELECT id FROM review_events WHERE card_id = ?').bind('c-h').all<{ id: string }>();
    expect(events.results.map(e => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
    const retry = await me('POST', '/me/card-forgets', { items: [{ id: 'f1', card_id: 'c-h' }] });
    expect(retry.json.already).toEqual(['c-h']);
    expect((await me('GET', '/me/card-forgets')).json.forgets).toHaveLength(1);
  });

  it('reviews after the forget replay from NEW; Undo restores the old schedule', async () => {
    const before = (await card(db, 'c-h'));
    await me('POST', '/me/card-forgets', { items: [{ id: 'f1', card_id: 'c-h', forgotten_at: '2026-01-05T09:00:00.000Z' }] });
    db.raw.run("INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('e5', 'c-h', ?, 2, '2026-01-05T09:05:00.000Z')", [ME]);
    await recomputeCards(db as unknown as D1Database, ME, ['c-h']);
    expect((await card(db, 'c-h'))).toMatchObject({ queue: 1, repetitions: 1 });
    const undo = await me('POST', '/me/card-forgets/undo', { ids: ['f1', 'nope'] });
    expect(undo.json).toEqual({ undone: 1, forgets: [] });
    expect((await card(db, 'c-h')).repetitions).toBe(before.repetitions + 1);
    expect((await me('POST', '/me/card-forgets/undo', { ids: ['f1'] })).json.undone).toBe(0);
  });

  it('forgets every card of a word by note id (or some card types); 400 / 404', async () => {
    const r = await me('POST', '/me/card-forgets', { note_ids: ['n-bank'], source: 'mcp' });
    expect(r.json.added.sort()).toEqual(['c-h', 'c-m']);
    expect((await card(db, 'c-m')).queue).toBe(0);
    expect((await me('POST', '/me/card-forgets', {})).status).toBe(400);
    expect((await me('POST', '/me/card-forgets', { card_ids: ['c-x'] })).status).toBe(404);
    expect((await me('POST', '/me/card-forgets/undo', {})).status).toBe(400);
  });
});
