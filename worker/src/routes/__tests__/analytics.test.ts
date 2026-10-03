/**
 * Usage analytics (docs/ANALYTICS.md): the upload endpoint (idempotent, privacy-filtered,
 * level + opt-out), the opt-out setting, the retention prune, the admin questions the MCP
 * tools ask — all against real SQLite with every migration — plus server events and the
 * AI-usage capture.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import analytics from '../analytics';
import { pruneUsageEvents, parseSince } from '../../services/analytics/usage';
import { trackServer } from '../../services/analytics/server-events';
import { runInScope } from '../../services/analytics/scope';
import { estimateCost, parseAiUsage, providerOf } from '../../services/analytics/ai-usage';
import { routePattern } from '../../services/analytics/request-log';
import type { Env } from '../../types';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let db: SqliteD1;

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run("INSERT INTO users (id, email, name, role, is_admin) VALUES ('admin-1', 'jerome@x.test', 'Jerome', 'student', 1)");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('tutor-1', 'minghui@x.test', 'Minghui', 'tutor')");
});

function makeApp(userId: string, env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    const row = db.rows<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [userId])[0];
    c.set('user', row as never);
    await next();
  });
  app.route('/api', analytics);
  const fullEnv = { DB: db, ...env } as unknown as Env;
  return (path: string, init?: RequestInit) => app.request(path, init, fullEnv);
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ev = (id: string, event: string, extra: Record<string, unknown> = {}) => ({
  id, event, ts: iso(MIN), session_id: 'sess_1', platform: 'web', app_version: '2026-10-03T10:00:00.000Z', ...extra,
});

describe('POST /api/analytics/events', () => {
  it('stores catalogue events once (idempotent by id) and never keeps a message body', async () => {
    const req = makeApp('tutor-1');
    const body = {
      events: [
        ev('evt_00000001', 'chat.send', { props: { kind: 'text', text: '老师，我今天不能上课', body: 'secret' }, screen: '/connections/abcdef123456/chat/zyxw98765432' }),
        ev('evt_00000002', 'study.card_rated', { props: { rating: 'good', answer: '你好' } }),
        ev('evt_00000003', 'server.ai_call'),
        ev('evt_00000004', 'not.real'),
      ],
    };
    const first = await (await req('/api/analytics/events', post(body))).json();
    expect(first).toMatchObject({ accepted: 2, stored: 2, rejected: 2, opted_out: false, level: 'verbose' });
    const again = await (await req('/api/analytics/events', post(body))).json();
    expect(again.stored).toBe(0);
    const rows = db.rows<{ event: string; props: string; screen: string; user_id: string }>('SELECT event, props, screen, user_id FROM usage_events ORDER BY id');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ event: 'chat.send', screen: '/connections/:id/chat/:id', user_id: 'tutor-1' });
    expect(JSON.parse(rows[0].props)).toEqual({ kind: 'text' });
    const everything = JSON.stringify(db.rows('SELECT * FROM usage_events'));
    expect(everything).not.toContain('老师');
    expect(everything).not.toContain('secret');
    expect(everything).not.toContain('你好');
  });

  it('400 on a bad body; basic level drops verbose-only events; off stores nothing', async () => {
    expect((await makeApp('tutor-1')('/api/analytics/events', post({ nope: 1 }))).status).toBe(400);
    const basic = await (await makeApp('tutor-1', { ANALYTICS_LEVEL: 'basic' })('/api/analytics/events', post({
      events: [ev('evt_b0000001', 'study.card_rated', { props: { rating: 'good' } }), ev('evt_b0000002', 'study.session_start')],
    }))).json();
    expect(basic).toMatchObject({ stored: 1, level: 'basic' });
    const off = await (await makeApp('tutor-1', { ANALYTICS_LEVEL: 'off' })('/api/analytics/events', post({ events: [ev('evt_o0000001', 'chat.open')] }))).json();
    expect(off.stored).toBe(0);
  });

  it('opt-out: PUT /profile/analytics forgets the data and later uploads are dropped', async () => {
    const req = makeApp('tutor-1');
    await req('/api/analytics/events', post({ events: [ev('evt_p0000001', 'chat.open')] }));
    const res = await req('/api/profile/analytics', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ share_usage: false }) });
    expect(await res.json()).toEqual({ share_usage: false });
    expect(db.rows('SELECT * FROM usage_events')).toHaveLength(0);
    const after = await (await makeApp('tutor-1')('/api/analytics/events', post({ events: [ev('evt_p0000002', 'chat.open')] }))).json();
    expect(after).toMatchObject({ stored: 0, opted_out: true });
    expect((await req('/api/profile/analytics', { method: 'PUT', body: JSON.stringify({ share_usage: 'yes' }) })).status).toBe(400);
  });
});

describe('prune cron', () => {
  it('deletes rows older than 180 days and keeps newer ones', async () => {
    db.raw.run(`INSERT INTO usage_events (id, user_id, ts, platform, event) VALUES
      ('old', 'tutor-1', '2026-03-01T00:00:00.000Z', 'web', 'chat.open'),
      ('edge', 'tutor-1', '2026-04-07T12:00:01.000Z', 'web', 'chat.open'),
      ('new', 'tutor-1', '2026-10-01T00:00:00.000Z', 'web', 'chat.open')`);
    expect(await pruneUsageEvents(db, NOW)).toBe(1);
    expect(db.rows<{ id: string }>('SELECT id FROM usage_events ORDER BY id').map((r) => r.id)).toEqual(['edge', 'new']);
  });
});

describe('admin usage questions', () => {
  function seed() {
    const rows: Array<[string, string, string, string, string, string | null, string]> = [
      // id, ts, platform, version, event, screen, props
      ['a1', iso(3 * DAY), 'lab', '0.57 (412)', 'app.screen_view', '/connections/:id', '{"duration_ms":120000}'],
      ['a2', iso(3 * DAY - MIN), 'lab', '0.57 (412)', 'chat.send', '/connections/:id/chat/:id', '{"kind":"voice"}'],
      ['a3', iso(2 * DAY), 'web', 'w1', 'app.screen_view', '/library', '{"duration_ms":60000}'],
      ['a4', iso(2 * DAY - MIN), 'web', 'w1', 'tutor.send_homework', '/connections/:id', '{"items":2,"mode":"both"}'],
      ['a5', iso(40 * DAY), 'web', 'w0', 'lesson.grammar_start', '/study', '{}'],
      ['a6', iso(1 * DAY), 'web', 'w1', 'error.shown', '/library', '{"code":"save_failed","where":"library","status":500}'],
      ['a7', iso(1 * DAY), 'web', 'w1', 'app.screen_view', '/search', '{"duration_ms":1000}'],
    ];
    for (const [id, ts, platform, version, event, screen, props] of rows) {
      db.raw.run('INSERT INTO usage_events (id, user_id, ts, platform, app_version, session_id, event, screen, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, 'tutor-1', ts, platform, version, `s_${platform}`, event, screen, props]);
    }
    db.raw.run(`INSERT INTO usage_events (id, user_id, ts, platform, event, screen, props) VALUES
      ('s1', 'tutor-1', '${iso(DAY)}', 'server', 'server.ai_call', '/api/coach/conversations', '{"provider":"anthropic","model":"claude-sonnet-5","input_tokens":1000,"output_tokens":500,"cost_usd":0.007,"route":"/api/coach/conversations"}'),
      ('s2', 'admin-1', '${iso(DAY)}', 'server', 'server.ai_call', NULL, '{"provider":"gemini","model":"gemini-3.5-flash","input_tokens":2000,"output_tokens":100,"cost_usd":0.00085}')`);
    db.raw.run(`INSERT INTO crash_reports (id, user_id, client, app_version, source, reason, description, trace, occurred_at, created_at)
      VALUES ('c1', 'tutor-1', 'lab', '0.57', 'uncaught', 'crash', 'NullPointerException', 'at Foo.bar', '${iso(DAY)}', datetime('now', '-1 day'))`);
  }

  const get = async (path: string, as = 'admin-1') => {
    const res = await makeApp(as)(path);
    return { status: res.status, body: await res.json() };
  };

  it('is admin only', async () => {
    seed();
    expect((await get('/api/admin/usage/summary?user=minghui@x.test', 'tutor-1')).status).toBe(403);
  });

  it('summary: active days, time per platform, top screens, last seen per version (user by email)', async () => {
    seed();
    const { status, body } = await get('/api/admin/usage/summary?user=MINGHUI@x.test&since=30d');
    expect(status).toBe(200);
    expect(body.user.id).toBe('tutor-1');
    expect(body.active_days).toBe(3); // the 40-day-old event is outside 30d
    const lab = body.platforms.find((p: { platform: string }) => p.platform === 'lab');
    expect(lab.time_in_app_min).toBe(2);
    expect(body.top_screens[0]).toEqual({ screen: '/connections/:id', views: 1, time_min: 2 });
    expect(body.last_seen_by_version.map((v: { app_version: string }) => v.app_version)).toContain('0.57 (412)');
    expect(JSON.stringify(body.platforms)).not.toContain('server');
    expect((await get('/api/admin/usage/summary?user=nobody@x.test')).status).toBe(404);
  });

  it('adoption: never used, stale, and old paths still in use', async () => {
    seed();
    const { body } = await get('/api/admin/usage/adoption?user=tutor-1&since=180d&stale_days=30');
    const never = body.never_used.map((f: { event: string }) => f.event);
    expect(never).toContain('call.screen_share');
    expect(never).not.toContain('chat.send');
    expect(never).not.toContain('server.ai_call'); // server events are not "features"
    expect(body.stale.map((f: { event: string }) => f.event)).toEqual(['lesson.grammar_start']);
    const old = body.old_path_in_use.map((o: { old: string; replaced_by: string }) => `${o.old}→${o.replaced_by}`);
    expect(old).toEqual(expect.arrayContaining(['lesson.grammar_start→lesson.start', 'screen /search→screen /decks']));
    const send = body.features.find((f: { event: string }) => f.event === 'tutor.send_homework');
    expect(send).toMatchObject({ count: 1 });
  });

  it('timeline: a day in order, screens optional', async () => {
    seed();
    const day = iso(3 * DAY).slice(0, 10);
    const { body } = await get(`/api/admin/usage/timeline?user=tutor-1&date=${day}`);
    expect(body.events.map((e: { event: string }) => e.event)).toEqual(['app.screen_view', 'chat.send']);
    expect(body.events[1].props).toEqual({ kind: 'voice' });
    const noScreens = await get(`/api/admin/usage/timeline?user=tutor-1&date=${day}&screens=0`);
    expect(noScreens.body.events.map((e: { event: string }) => e.event)).toEqual(['chat.send']);
  });

  it('counts by prefix, grouped by platform or user', async () => {
    seed();
    const byPlatform = await get('/api/admin/usage/counts?event=app.*&group_by=platform&since=30d');
    expect(byPlatform.body.total).toBe(3);
    expect(byPlatform.body.rows.find((r: { key: string }) => r.key === 'web').count).toBe(2);
    const byUser = await get('/api/admin/usage/counts?event=server.ai_call&group_by=user&since=30d');
    expect(byUser.body.rows.map((r: { email: string }) => r.email).sort()).toEqual(['jerome@x.test', 'minghui@x.test']);
    expect((await get('/api/admin/usage/counts')).status).toBe(400);
  });

  it('errors: errors shown + crash reports', async () => {
    seed();
    const { body } = await get('/api/admin/usage/errors?user=tutor-1&since=7d');
    expect(body.errors_shown).toHaveLength(1);
    expect(body.errors_by_place).toEqual([{ where_code: 'library:save_failed', count: 1 }]);
    expect(body.crashes.map((c: { id: string }) => c.id)).toEqual(['c1']);
  });

  it('ai usage by model and by user', async () => {
    seed();
    const byModel = await get('/api/admin/usage/ai?since=30d');
    expect(byModel.body.totals).toMatchObject({ calls: 2, input_tokens: 3000, output_tokens: 600 });
    expect(byModel.body.rows[0].key).toBe('claude-sonnet-5');
    const mine = await get('/api/admin/usage/ai?since=30d&group_by=route&user=tutor-1');
    expect(mine.body.rows).toEqual([expect.objectContaining({ key: '/api/coach/conversations', calls: 1 })]);
  });
});

describe('server events', () => {
  it('record with the scope user and route, and respect opt-out and level', async () => {
    const env = { DB: db } as unknown as Env;
    await runInScope({ env, userId: 'tutor-1', route: '/api/decks' }, () => trackServer('server.content_created', { kind: 'deck', count: 1, text: 'nope' }));
    const row = db.rows<{ user_id: string; platform: string; screen: string; props: string }>('SELECT user_id, platform, screen, props FROM usage_events')[0];
    expect(row).toMatchObject({ user_id: 'tutor-1', platform: 'server', screen: '/api/decks' });
    expect(JSON.parse(row.props)).toEqual({ kind: 'deck', count: 1 });

    db.raw.run("UPDATE users SET analytics_opt_out = 1 WHERE id = 'tutor-1'");
    await trackServer('server.content_created', { kind: 'deck' }, { env, userId: 'tutor-1' });
    await trackServer('server.content_created', { kind: 'deck' }, { env: { DB: db, ANALYTICS_LEVEL: 'off' } as unknown as Env, userId: 'admin-1' });
    expect(db.rows('SELECT * FROM usage_events')).toHaveLength(1);
    // Outside any scope and without env: a silent no-op, never a throw.
    await expect(trackServer('server.email_sent', { kind: 'x' })).resolves.toBeUndefined();
  });
});

describe('AI usage capture', () => {
  it('reads Anthropic and Gemini usage and estimates cost', () => {
    expect(providerOf('https://api.anthropic.com/v1/messages')).toBe('anthropic');
    expect(providerOf('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')).toBe('gemini');
    expect(providerOf('https://api.sendgrid.com/v3/mail/send')).toBeNull();
    const a = parseAiUsage('anthropic', '', { model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000 } }, 200);
    expect(a).toMatchObject({ model: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 10000 });
    expect(a!.cost_usd).toBeCloseTo((1000 * 2 + 10000 * 0.2 + 500 * 10) / 1e6, 8);
    const g = parseAiUsage('gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent', { usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 80, thoughtsTokenCount: 20 } }, 200);
    expect(g).toMatchObject({ model: 'gemini-3.5-flash', input_tokens: 2000, output_tokens: 100 });
    expect(parseAiUsage('anthropic', '', { error: { type: 'overloaded' } }, 529)).toBeNull();
    expect(estimateCost('claude-opus-4-6', 1_000_000, 0)).toBe(5);
    expect(estimateCost('mystery-model', 1000, 1000)).toBe(0);
  });
});

describe('request log route pattern', () => {
  it('names the handler pattern, never the raw path', async () => {
    const app = new Hono();
    let seen = '';
    app.use('*', async (c, next) => {
      await next();
      seen = routePattern(c);
    });
    let inMiddleware = '';
    app.use('/api/*', async (c, next) => {
      inMiddleware = routePattern(c);
      await next();
    });
    app.get('/api/decks/:id', (c) => c.text('ok'));
    app.post('/api/decks', (c) => c.text('ok'));
    app.get('*', (c) => c.text('spa')); // the SPA catch-all matches every GET too
    await app.request('/api/decks/abc123def456');
    expect(seen).toBe('/api/decks/:id');
    expect(inMiddleware).toBe('/api/decks/:id');
    await app.request('/somewhere');
    expect(seen).toBe('*');
    await app.request('/api/nowhere', { method: 'DELETE' });
    expect(seen).toBe('unmatched');
  });
});

describe('parseSince', () => {
  it('accepts Nd, dates and timestamps', () => {
    expect(parseSince('7d', NOW, 30)).toBe('2026-09-26T12:00:00.000Z');
    expect(parseSince('2026-10-01', NOW, 30)).toBe('2026-10-01T00:00:00.000Z');
    expect(parseSince(undefined, NOW, 30)).toBe('2026-09-03T12:00:00.000Z');
  });
});
