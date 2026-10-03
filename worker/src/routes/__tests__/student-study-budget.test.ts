/**
 * The tutor sets a student's daily new-card budget (routes/student-study-budget.ts)
 * against real SQLite with every migration: tutor only, the shared validation,
 * NULL = back to the default, who set it, the chat message, the student's own
 * decks untouched, and the student's own change taking it back.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import studentStudyBudget from '../student-study-budget';
import { getStudyBudgetInfo, setStudyBudget } from '../../db/queries';
import type { Env } from '../../types';

const TUTOR = 'tutor-1';

async function rows<T = Record<string, unknown>>(db: SqliteD1, sql: string, params: unknown[] = []): Promise<T[]> {
  return ((await db.prepare(sql).bind(...params).all<T>()).results ?? []) as T[];
}
const STUDENT = 'student-1';

function seed(db: SqliteD1) {
  for (const [id, name] of [[TUTOR, 'Minghui Wang'], [STUDENT, 'Jerome'], ['stranger', 'Nobody']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO decks (id, user_id, name, new_cards_per_day, secondary_cards_per_day, study_priority, created_at) VALUES ('d-1', ?, 'Lesson vocab – 2 Oct', 4, 7, 5, '2026-10-02T00:00:00Z')", [STUDENT]);
  for (let i = 0; i < 3; i++) {
    db.raw.run('INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', [`n-${i}`, 'd-1', `字${i}`, 'zì', 'char']);
  }
}

function as(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', studentStudyBudget);
  return (method: string, body?: unknown) =>
    app.request('/api/relationships/rel-1/student-study-budget', body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
}

describe('tutor sets the student study budget', () => {
  let db: SqliteD1;
  let env: Env;
  const hubEvents: unknown[] = [];

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    hubEvents.length = 0;
    const ns = { idFromName: (n: string) => n, get: () => ({ broadcast: async (e: unknown) => { hubEvents.push(e); return 1; } }) };
    env = { DB: db, SESSION_SECRET: 's', CHAT_HUB: ns } as unknown as Env;
  });

  it('only the tutor of an active relationship', async () => {
    expect((await as(env, STUDENT)('GET')).status).toBe(403);
    expect((await as(env, 'stranger')('PUT', { new_cards_per_day: 5 })).status).toBe(403);
    db.raw.run("UPDATE tutor_relationships SET status = 'removed' WHERE id = 'rel-1'");
    expect((await as(env, TUTOR)('GET')).status).toBe(404);
  });

  it('GET: the default budget and the top deck with words to go', async () => {
    const res = await as(env, TUTOR)('GET');
    expect(res.status).toBe(200);
    const body = await res.json() as { budget: Record<string, unknown>; default: unknown; top_deck: unknown };
    expect(body.budget).toMatchObject({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true, set_by_tutor: false });
    expect(body.default).toEqual({ new_cards_per_day: 3, secondary_cards_per_day: 6 });
    expect(body.top_deck).toEqual({ id: 'd-1', name: 'Lesson vocab – 2 Oct', words_to_go: 3 });
  });

  it('validates like the student endpoint (400 + problems), nothing written', async () => {
    const res = await as(env, TUTOR)('PUT', { new_cards_per_day: 201, secondary_cards_per_day: -1 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problems: string[] }).problems).toHaveLength(2);
    expect((await as(env, TUTOR)('PUT', {})).status).toBe(400);
    expect((await getStudyBudgetInfo(db, STUDENT)).is_default).toBe(true);
  });

  it('PUT sets it, records the tutor, posts one chat message, leaves the decks alone', async () => {
    const res = await as(env, TUTOR)('PUT', { new_cards_per_day: 5, secondary_cards_per_day: 10 });
    expect(res.status).toBe(200);
    const body = await res.json() as { budget: Record<string, unknown>; changed: boolean; message_sent: boolean };
    expect(body).toMatchObject({ changed: true, message_sent: true });
    expect(body.budget).toMatchObject({ new_cards_per_day: 5, secondary_cards_per_day: 10, is_default: false, set_by_id: TUTOR, set_by_name: 'Minghui Wang', set_by_tutor: true });

    const msgs = await rows<{ sender_id: string; content: string }>(db, 'SELECT m.sender_id, m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.relationship_id = ?', ['rel-1']);
    expect(msgs).toEqual([{ sender_id: TUTOR, content: "I've set your new cards to 5 a day (+10 extra) 📚" }]);
    expect(hubEvents.length).toBeGreaterThan(0);

    const deck = await rows<{ new_cards_per_day: number; secondary_cards_per_day: number }>(db, 'SELECT new_cards_per_day, secondary_cards_per_day FROM decks WHERE id = ?', ['d-1']);
    expect(deck).toEqual([{ new_cards_per_day: 4, secondary_cards_per_day: 7 }]);

    // Same numbers again: nothing changed, no second message.
    const again = await (await as(env, TUTOR)('PUT', { new_cards_per_day: 5, secondary_cards_per_day: 10 })).json() as { changed: boolean; message_sent: boolean };
    expect(again).toMatchObject({ changed: false, message_sent: false });
    expect(await rows(db, 'SELECT id FROM messages')).toHaveLength(1);
  });

  it('null resets to the default (NULL columns), with the "back to the usual" message', async () => {
    await as(env, TUTOR)('PUT', { new_cards_per_day: 5, secondary_cards_per_day: 10 });
    const body = await (await as(env, TUTOR)('PUT', { new_cards_per_day: null, secondary_cards_per_day: null })).json() as { budget: Record<string, unknown> };
    expect(body.budget).toMatchObject({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true, set_by_tutor: true });
    expect(await rows(db, 'SELECT new_cards_per_day, secondary_cards_per_day FROM users WHERE id = ?', [STUDENT])).toEqual([{ new_cards_per_day: null, secondary_cards_per_day: null }]);
    const last = (await rows<{ content: string }>(db, 'SELECT content FROM messages ORDER BY created_at DESC, rowid DESC LIMIT 1'))[0];
    expect(last.content).toBe("I've set your new cards back to the usual 3 a day (+6 extra) 📚");
  });

  it("the student's own change wins and clears set_by back to them", async () => {
    await as(env, TUTOR)('PUT', { new_cards_per_day: 5 });
    const mine = await setStudyBudget(db, STUDENT, { new_cards_per_day: 2 }, STUDENT);
    expect(mine).toMatchObject({ new_cards_per_day: 2, secondary_cards_per_day: 6, set_by_id: STUDENT, set_by_tutor: false });
  });
});
