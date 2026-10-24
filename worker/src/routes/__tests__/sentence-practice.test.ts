/**
 * Practice per example sentence (routes/sentence-practice.ts + services/sentence-practice.ts) against real
 * SQLite with every migration: events stored idempotently by client id, only on my own notes, junk refused,
 * listed after a cursor, hidden keys folded by the last hide / unhide.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import sentencePractice from '../sentence-practice';
import { hiddenSentenceKeys } from '../../services/sentence-practice';
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
}

function client(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', sentencePractice);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

describe('sentence practice events', () => {
  let db: SqliteD1;
  let me: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    me = client({ DB: db } as unknown as Env, ME);
  });

  it('stores attempts and hides idempotently, my notes only, junk refused', async () => {
    const events = [
      { id: 'a1', note_id: 'n-bank', sentence_key: 'clue', kind: 'attempt', mode: 'read', result: 'right', at: '2026-10-20T08:00:00.000Z' },
      { id: 'a2', note_id: 'n-bank', sentence_key: 's1', kind: 'attempt', mode: 'translate', result: 'close', at: '2026-10-20T08:01:00.000Z' },
      { id: 'h1', note_id: 'n-bank', sentence_key: 's2', kind: 'hide', reason: 'weird', at: '2026-10-20T08:02:00.000Z' },
      { id: 'x1', note_id: 'n-x', sentence_key: 'clue', kind: 'attempt', mode: 'read', result: 'right', at: '2026-10-20T08:00:00.000Z' },
      { id: 'bad', note_id: 'n-bank', sentence_key: 'clue', kind: 'attempt', mode: 'sing', result: 'right', at: '2026-10-20T08:00:00.000Z' },
    ];
    const r = await me('POST', '/me/sentence-practice', { events });
    expect(r.status).toBe(200);
    expect(r.json.stored).toBe(3);
    expect(r.json.accepted.sort()).toEqual(['a1', 'a2', 'h1']);
    expect(r.json.rejected.sort()).toEqual(['bad', 'x1']);
    const again = await me('POST', '/me/sentence-practice', { events: events.slice(0, 2) });
    expect(again.json.stored).toBe(0);
    expect(again.json.accepted).toEqual(['a1', 'a2']);

    const list = await me('GET', '/me/sentence-practice');
    expect(list.json.events.map((e: { id: string }) => e.id).sort()).toEqual(['a1', 'a2', 'h1']);
    const later = await me('GET', `/me/sentence-practice?since=${encodeURIComponent(list.json.cursor)}`);
    expect(later.json.events).toEqual([]);
    expect((await me('POST', '/me/sentence-practice', { events: [] })).status).toBe(400);
  });

  it('hidden keys: the last hide / unhide decides', async () => {
    await me('POST', '/me/sentence-practice', { events: [
      { id: 'h1', note_id: 'n-bank', sentence_key: 's2', kind: 'hide', reason: 'weird', at: '2026-10-20T08:02:00.000Z' },
      { id: 'h2', note_id: 'n-bank', sentence_key: 'clue', kind: 'hide', reason: 'wrong', at: '2026-10-20T08:03:00.000Z' },
      { id: 'u1', note_id: 'n-bank', sentence_key: 'clue', kind: 'unhide', at: '2026-10-20T08:04:00.000Z' },
    ] });
    const hidden = await hiddenSentenceKeys(db as unknown as D1Database, ME, ['n-bank']);
    expect([...(hidden.get('n-bank') ?? [])]).toEqual(['s2']);
  });
});
