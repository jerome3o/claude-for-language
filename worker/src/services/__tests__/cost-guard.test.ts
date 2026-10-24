/**
 * The cost guard (middleware/cost-guard.ts): which requests count, the per-minute and
 * per-hour limits with a readable 429 + Retry-After, and the daily AI cost cap from the
 * ai-usage accounting (admins exempt, env-configurable).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  COST_LIMITS,
  costGroupFor,
  costGuard,
  dailyCapMessage,
  dailyCostCap,
  resetCostGuard,
  secondsUntilUtcMidnight,
} from '../../middleware/cost-guard';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import type { Env } from '../../types';

function app(user: { id: string; email?: string; is_admin?: number }) {
  const a = new Hono<{ Bindings: Env }>();
  a.use('/api/*', async (c, next) => {
    c.set('user', user as never);
    await next();
  });
  a.use('/api/*', costGuard);
  a.post('/api/notes/:id/ask', (c) => c.json({ ok: true }));
  a.post('/api/practice/tts', (c) => c.json({ ok: true }));
  a.post('/api/quests', (c) => c.json({ ok: true }));
  a.get('/api/coach/conversations', (c) => c.json({ ok: true }));
  a.post('/api/decks', (c) => c.json({ ok: true }));
  return a;
}

let db: SqliteD1;
let env: Env;

beforeEach(async () => {
  resetCostGuard();
  db = await createSqliteD1();
  env = { DB: db, ADMIN_EMAIL: 'jerome@example.com' } as unknown as Env;
});

const post = (a: Hono<{ Bindings: Env }>, path: string, e = env) => a.request(path, { method: 'POST' }, e);

describe('which requests count', () => {
  it('groups the costly endpoints; reads and ordinary writes never count', () => {
    expect(costGroupFor('POST', '/api/ai/generate-deck')).toBe('ai');
    expect(costGroupFor('POST', '/api/sentence/coach')).toBe('ai');
    expect(costGroupFor('POST', '/api/sentences/explain-text')).toBe('ai');
    expect(costGroupFor('POST', '/api/sentences/abc123/explain')).toBe('ai');
    expect(costGroupFor('POST', '/api/coach/conversations/c1/messages')).toBe('ai');
    expect(costGroupFor('POST', '/api/transcribe')).toBe('ai');
    expect(costGroupFor('POST', '/api/transcribe/live')).toBe('ai');
    expect(costGroupFor('POST', '/api/notes/n1/ask')).toBe('ai');
    expect(costGroupFor('POST', '/api/lessons/answer-check/ask')).toBe('ai');
    expect(costGroupFor('POST', '/api/practice/tts')).toBe('tts');
    expect(costGroupFor('POST', '/api/audio-lessons')).toBe('jobs');
    expect(costGroupFor('POST', '/api/readers/generate')).toBe('jobs');
    expect(costGroupFor('POST', '/api/picture-hunts/upload')).toBe('jobs');
    expect(costGroupFor('POST', '/api/quests')).toBe('jobs');
    expect(costGroupFor('POST', '/api/clips/generate')).toBe('jobs');
    expect(costGroupFor('POST', '/api/clips/c1/learn-more')).toBe('jobs');
    expect(costGroupFor('POST', '/api/clips/c1/retry')).toBe('jobs');
    expect(costGroupFor('POST', '/api/clips/events')).toBeNull();
    expect(costGroupFor('POST', '/api/clips')).toBeNull();
    expect(costGroupFor('POST', '/api/podcasts/episodes')).toBe('jobs');
    expect(costGroupFor('POST', '/api/relationships/r1/session-notes')).toBe('jobs');
    // not costly / not a job
    expect(costGroupFor('GET', '/api/coach/conversations')).toBeNull();
    expect(costGroupFor('POST', '/api/picture-hunts/plays')).toBeNull();
    expect(costGroupFor('POST', '/api/audio-lessons/listened')).toBeNull();
    expect(costGroupFor('POST', '/api/sentences/s1/ensure-audio')).toBeNull();
    expect(costGroupFor('POST', '/api/relationships/r1/session-notes/j1/send')).toBeNull();
    expect(costGroupFor('POST', '/api/decks')).toBeNull();
  });
});

describe('rate limits', () => {
  it('60 AI calls a minute per user, then a readable 429 with Retry-After; other users unaffected', async () => {
    const a = app({ id: 'u1' });
    for (let i = 0; i < COST_LIMITS.ai.perMinute; i++) expect((await post(a, '/api/notes/n1/ask')).status).toBe(200);
    const res = await post(a, '/api/notes/n1/ask');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('rate_limited');
    expect(body.error).toMatch(/wait a minute/);
    expect((await post(app({ id: 'u2' }), '/api/notes/n1/ask')).status).toBe(200);
    // ordinary routes and reads never count
    expect((await post(a, '/api/decks')).status).toBe(200);
    expect((await a.request('/api/coach/conversations', {}, env)).status).toBe(200);
  });

  it('uses the Workers rate-limit binding when there is one, keyed by group + user', async () => {
    const keys: string[] = [];
    const e = { ...env, AI_RATE_LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } } as unknown as Env;
    const res = await post(app({ id: 'u1' }), '/api/notes/n1/ask', e);
    expect(res.status).toBe(429);
    expect(keys).toEqual(['ai:u1']);
  });

  it('jobs: 10 a minute, and 30 an hour (counted in D1)', async () => {
    const a = app({ id: 'u1' });
    for (let i = 0; i < COST_LIMITS.jobs.perMinute; i++) expect((await post(a, '/api/quests')).status).toBe(200);
    expect((await post(a, '/api/quests')).status).toBe(429);
    // the per-minute limiter says yes, but the hour is used up
    const always = { limit: async () => ({ success: true }) };
    const e = { ...env, JOB_RATE_LIMITER: always } as unknown as Env;
    resetCostGuard();
    let status = 200;
    let n = 0;
    while (status === 200 && n < 100) {
      status = (await post(a, '/api/quests', e)).status;
      n++;
    }
    expect(n - 1).toBe(COST_LIMITS.jobs.perHour! - COST_LIMITS.jobs.perMinute); // the 10 above already counted this hour (the refused 11th did not)
    const body = (await (await post(a, '/api/quests', e)).json()) as { error: string };
    expect(body.error).toMatch(/30 generations in the last hour/);
  });

  it('practice TTS has its own, larger bucket (600 a minute)', async () => {
    const a = app({ id: 'u1' });
    for (let i = 0; i < 100; i++) expect((await post(a, '/api/practice/tts')).status).toBe(200);
  });
});

describe('daily AI cost cap', () => {
  function spent(userId: string, usd: number, ts = new Date().toISOString()) {
    const stmt = db.raw.prepare("INSERT INTO usage_events (id, user_id, ts, platform, event, props) VALUES (?, ?, ?, 'server', 'server.ai_call', ?)");
    stmt.run([`e-${Math.random()}`, userId, ts, JSON.stringify({ cost_usd: usd })] as never);
    stmt.free();
  }

  it('over $10 today → 429 until UTC midnight; yesterday does not count; admins and TTS are exempt', async () => {
    spent('u1', 6);
    spent('u1', 4.5);
    spent('u1', 50, '2020-01-01T00:00:00.000Z');
    const res = await post(app({ id: 'u1' }), '/api/notes/n1/ask');
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; code: string; retry_after: number };
    expect(body.code).toBe('daily_ai_limit');
    expect(body.error).toBe(dailyCapMessage(10));
    expect(body.error).toMatch(/resets at midnight UTC/);
    expect(Number(res.headers.get('Retry-After'))).toBe(body.retry_after);
    expect((await post(app({ id: 'u1' }), '/api/quests')).status).toBe(429);
    expect((await post(app({ id: 'u1' }), '/api/practice/tts')).status).toBe(200);
    // the admin (flag or ADMIN_EMAIL) is never capped
    spent('admin', 99);
    expect((await post(app({ id: 'admin', is_admin: 1 }), '/api/notes/n1/ask')).status).toBe(200);
    spent('jerome', 99);
    expect((await post(app({ id: 'jerome', email: 'Jerome@example.com' }), '/api/notes/n1/ask')).status).toBe(200);
  });

  it('under the cap passes; the cap is an env var ("off" turns it off)', async () => {
    spent('u1', 9.5);
    expect((await post(app({ id: 'u1' }), '/api/notes/n1/ask')).status).toBe(200);
    resetCostGuard();
    expect((await post(app({ id: 'u1' }), '/api/notes/n1/ask', { ...env, AI_DAILY_COST_CAP_USD: '5' } as Env)).status).toBe(429);
    resetCostGuard();
    expect((await post(app({ id: 'u1' }), '/api/notes/n1/ask', { ...env, AI_DAILY_COST_CAP_USD: 'off' } as Env)).status).toBe(200);
    expect(dailyCostCap(undefined)).toBe(10);
    expect(dailyCostCap('2.5')).toBe(2.5);
    expect(dailyCostCap('0')).toBeNull();
    expect(dailyCostCap('nonsense')).toBe(10);
    expect(dailyCapMessage(2.5)).toMatch(/\$2\.50 a day/);
  });

  it('E2E_TEST_MODE skips the guard', async () => {
    spent('u1', 99);
    expect((await post(app({ id: 'u1' }), '/api/notes/n1/ask', { ...env, E2E_TEST_MODE: 'true' } as Env)).status).toBe(200);
  });

  it('seconds until UTC midnight', () => {
    expect(secondsUntilUtcMidnight(Date.parse('2026-10-16T23:59:00Z'))).toBe(60);
  });
});
