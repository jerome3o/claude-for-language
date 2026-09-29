import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import studyTime from '../study-time';
import type { Env } from '../../types';

function makeApp(db: SqliteD1, user: { id: string } | null) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never);
    await next();
  });
  app.route('/api', studyTime);
  const env = { DB: db } as unknown as Env;
  return {
    get: (q = '') => app.request(`/api/me/study-time${q}`, undefined, env),
    put: (body: unknown) => app.request('/api/me/study-time', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, env),
  };
}

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

describe('study time routes', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1();
    for (const id of ['learner', 'other']) {
      db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, id, 'student']);
    }
  });

  it('refuses a signed-out caller', async () => {
    const app = makeApp(db, null);
    expect((await app.get()).status).toBe(401);
    expect((await app.put({ device_id: 'lab-12345678', days: [] })).status).toBe(401);
  });

  it('stores each device’s per-day total, only ever raising it, and sums devices', async () => {
    const app = makeApp(db, { id: 'learner' });
    let res = await app.put({ device_id: 'lab-aaaaaaaa', days: [{ date: today, active_ms: 600_000 }, { date: yesterday, active_ms: 60_000 }] });
    expect(res.status).toBe(200);
    // A stale re-send (lower) never lowers the row.
    await app.put({ device_id: 'lab-aaaaaaaa', days: [{ date: today, active_ms: 300_000 }] });
    res = await app.put({ device_id: 'web-bbbbbbbb', days: [{ date: today, active_ms: 120_000 }] });
    const body = await res.json() as { days: { date: string; active_ms: number; device_ms: number }[] };
    expect(body.days).toEqual([
      { date: yesterday, active_ms: 60_000, device_ms: 0 },
      { date: today, active_ms: 720_000, device_ms: 120_000 },
    ]);
    const mine = await (await app.get(`?device_id=lab-aaaaaaaa&from=${yesterday}`)).json() as typeof body;
    expect(mine.days.find((d) => d.date === today)).toEqual({ date: today, active_ms: 720_000, device_ms: 600_000 });
  });

  it('keeps accounts apart', async () => {
    await makeApp(db, { id: 'other' }).put({ device_id: 'web-cccccccc', days: [{ date: today, active_ms: 999 }] });
    const body = await (await makeApp(db, { id: 'learner' }).get()).json() as { days: unknown[] };
    expect(body.days).toEqual([]);
  });

  it('refuses a bad device id or bad rows with the problems', async () => {
    const app = makeApp(db, { id: 'learner' });
    expect((await app.put({ device_id: 'x', days: [] })).status).toBe(400);
    const res = await app.put({ device_id: 'lab-aaaaaaaa', days: [{ date: 'today', active_ms: 5 }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problems: string[] }).problems[0]).toMatch(/YYYY-MM-DD/);
  });
});
