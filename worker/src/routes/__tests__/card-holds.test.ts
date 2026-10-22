/**
 * Suspend & snooze (routes/card-holds.ts + services/card-holds.ts) against real SQLite with
 * every migration: hold by card / note / hanzi / client item (idempotent), ownership, kinds and
 * dates validated, a new hold replaces the older one, clear (by kind, by time), the sibling-bury
 * switch, and the server's due list leaving held cards out.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import cardHolds from '../card-holds';
import { getBurySiblings, listActiveHolds } from '../../services/card-holds';
import { getDueCards } from '../../db/queries';
import type { Env } from '../../types';

const ME = 'user-1';
const OTHER = 'user-2';

function seed(db: SqliteD1) {
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [ME, 'me@x.test', 'Jerome']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [OTHER, 'o@x.test', 'Other']);
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
  card('c-apple-h', 'n-apple', 'hanzi_to_meaning', 2, '2020-01-01T00:00:00.000Z');
  card('c-x', 'n-x', 'hanzi_to_meaning');
}

function client(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', cardHolds);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

describe('card holds', () => {
  let db: SqliteD1;
  let env: Env;
  let me: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    env = { DB: db } as unknown as Env;
    me = client(env, ME);
  });

  it('suspends offline items idempotently by client id, my cards only', async () => {
    const r = await me('POST', '/me/card-holds', {
      items: [
        { id: 'h1', card_id: 'c-bank-h', kind: 'suspend', created_at: '2026-10-20T08:00:00.000Z', source: 'study' },
        { id: 'h2', card_id: 'c-x', kind: 'suspend' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.added).toEqual(['c-bank-h']);
    expect(r.json.not_found).toEqual(['c-x']);
    expect(r.json.holds.map((h: any) => [h.id, h.card_id, h.kind, h.until, h.hanzi, h.deck_name, h.card_type])).toEqual([
      ['h1', 'c-bank-h', 'suspend', null, '银行', 'HSK 2', 'hanzi_to_meaning'],
    ]);
    const retry = await me('POST', '/me/card-holds', { items: [{ id: 'h1', card_id: 'c-bank-h', kind: 'suspend' }] });
    expect(retry.json.already).toEqual(['c-bank-h']);
    expect(retry.json.holds).toHaveLength(1);
  });

  it('holds every card of a word by note id or hanzi (or only some card types); validates kind and date', async () => {
    const r = await me('POST', '/me/card-holds', { hanzi: ['银 行'], kind: 'snooze', until: '2026-10-29', source: 'mcp' });
    expect(r.json.added.sort()).toEqual(['c-bank-h', 'c-bank-m']);
    expect(r.json.holds.every((h: any) => h.until === '2026-10-29')).toBe(true);
    const one = await me('POST', '/me/card-holds', { note_ids: ['n-apple'], card_types: ['hanzi_to_meaning'], kind: 'suspend' });
    expect(one.json.added).toEqual(['c-apple-h']);
    expect((await me('POST', '/me/card-holds', { note_ids: ['n-apple'], kind: 'bury' })).status).toBe(400);
    const badDate = await me('POST', '/me/card-holds', { card_ids: ['c-apple-h'], kind: 'snooze', until: 'tomorrow' });
    expect(badDate.status).toBe(400);
    expect((await me('POST', '/me/card-holds', { hanzi: ['不存在'], kind: 'suspend' })).status).toBe(404);
    expect((await me('POST', '/me/card-holds', {})).status).toBe(400);
  });

  it('a new hold replaces the older active one; clear by kind and by time', async () => {
    await me('POST', '/me/card-holds', { items: [{ id: 'a', card_id: 'c-bank-h', kind: 'snooze', until: '2026-10-23', created_at: '2026-10-20T08:00:00.000Z' }] });
    await me('POST', '/me/card-holds', { items: [{ id: 'b', card_id: 'c-bank-h', kind: 'suspend', created_at: '2026-10-21T08:00:00.000Z' }] });
    expect((await listActiveHolds(db as unknown as D1Database, ME)).map(h => h.id)).toEqual(['b']);
    // A clear made before the hold (another device, offline) leaves it alone.
    const early = await me('POST', '/me/card-holds/clear', { card_ids: ['c-bank-h'], cleared_at: '2026-10-20T09:00:00.000Z' });
    expect(early.json.cleared).toBe(0);
    // Wake now (snooze only) doesn't unsuspend.
    expect((await me('POST', '/me/card-holds/clear', { card_ids: ['c-bank-h'], kind: 'snooze' })).json.cleared).toBe(0);
    const r = await me('POST', '/me/card-holds/clear', { note_ids: ['n-bank'] });
    expect(r.json.cleared).toBe(1);
    expect(r.json.holds).toEqual([]);
    // Idempotent.
    expect((await me('POST', '/me/card-holds/clear', { card_ids: ['c-bank-h'] })).json.cleared).toBe(0);
  });

  it('the due list (MCP / study app) leaves suspended cards out', async () => {
    const before = await getDueCards(db as unknown as D1Database, ME, undefined, true, 50);
    expect(before.map(c => c.id).sort()).toEqual(['c-apple-h', 'c-bank-h', 'c-bank-m']);
    await me('POST', '/me/card-holds', { card_ids: ['c-apple-h', 'c-bank-m'], kind: 'suspend' });
    const after = await getDueCards(db as unknown as D1Database, ME, undefined, true, 50);
    expect(after.map(c => c.id)).toEqual(['c-bank-h']);
  });

  it('the sibling-bury switch is off by default', async () => {
    expect(await getBurySiblings(db as unknown as D1Database, ME)).toBe(false);
    expect((await me('PUT', '/profile/bury-siblings', { bury_siblings: true })).json.bury_siblings).toBe(true);
    expect(await getBurySiblings(db as unknown as D1Database, ME)).toBe(true);
    expect((await me('PUT', '/profile/bury-siblings', { bury_siblings: 'yes' })).status).toBe(400);
    await me('PUT', '/profile/bury-siblings', { bury_siblings: null });
    expect(await getBurySiblings(db as unknown as D1Database, ME)).toBe(false);
  });
});
