import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerUsageTools } from './usage';
import type { ToolContext } from './context';
import { ApiError } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;
interface Call { method: string; path: string; query?: Record<string, unknown> }

/**
 * The fake API answers like worker/src/routes/analytics.ts does over a small seeded set of
 * usage events (the worker's own test runs the same queries against real SQLite).
 */
const SEEDED = [
  { user: 'minghui@x.test', ts: '2026-10-01T09:00:00.000Z', platform: 'lab', event: 'app.screen_view', screen: '/connections/:id', props: { duration_ms: 120000 } },
  { user: 'minghui@x.test', ts: '2026-10-01T09:02:00.000Z', platform: 'lab', event: 'chat.send', screen: '/connections/:id/chat/:id', props: { kind: 'voice' } },
  { user: 'minghui@x.test', ts: '2026-10-02T10:00:00.000Z', platform: 'web', event: 'lesson.grammar_start', screen: '/study', props: {} },
  { user: 'minghui@x.test', ts: '2026-10-02T10:05:00.000Z', platform: 'web', event: 'error.shown', screen: '/library', props: { where: 'library', code: 'save_failed' } },
  { user: 'jerome@x.test', ts: '2026-10-02T11:00:00.000Z', platform: 'server', event: 'server.ai_call', screen: null, props: { model: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 500, cost_usd: 0.007 } },
];

function fakeContext() {
  const tools = new Map<string, Handler>();
  const calls: Call[] = [];
  const forUser = (u: unknown) => SEEDED.filter((e) => !u || e.user === u);
  const routes: Record<string, (query: Record<string, string>) => unknown> = {
    '/api/admin/usage/summary': (qy) => {
      const rows = forUser(qy.user).filter((e) => e.platform !== 'server');
      return { active_days: new Set(rows.map((e) => e.ts.slice(0, 10))).size, top_events: rows.map((e) => e.event) };
    },
    '/api/admin/usage/adoption': (qy) => {
      const used = new Set(forUser(qy.user).map((e) => e.event));
      return {
        never_used: ['call.screen_share', 'chat.send'].filter((e) => !used.has(e)).map((event) => ({ event })),
        old_path_in_use: used.has('lesson.grammar_start') ? [{ old: 'lesson.grammar_start', replaced_by: 'lesson.start', old_count: 1, new_count: 0 }] : [],
      };
    },
    '/api/admin/usage/timeline': (qy) => ({ events: forUser(qy.user).filter((e) => e.ts.startsWith(qy.date ?? '')).filter((e) => qy.screens !== '0' || e.event !== 'app.screen_view') }),
    '/api/admin/usage/counts': (qy) => {
      const prefix = qy.event.replace(/\*$/, '');
      const rows = SEEDED.filter((e) => (qy.event.endsWith('*') || qy.event.endsWith('.') ? e.event.startsWith(prefix) : e.event === qy.event));
      return { total: rows.length, group_by: qy.group_by };
    },
    '/api/admin/usage/errors': (qy) => ({ errors_shown: forUser(qy.user).filter((e) => e.event === 'error.shown'), crashes: [] }),
    '/api/admin/usage/ai': (qy) => ({ group_by: qy.group_by, totals: { calls: SEEDED.filter((e) => e.event === 'server.ai_call').length } }),
  };
  const api = {
    get: (path: string, query: Record<string, string> = {}) => {
      calls.push({ method: 'GET', path, query });
      if (path === '/api/admin/usage/summary' && query.user === 'not-admin') return Promise.reject(new ApiError(403, 'Forbidden', { error: 'Forbidden' }));
      const route = routes[path];
      return route ? Promise.resolve(route(query)) : Promise.reject(new ApiError(404, `No fake route for ${path}`, null));
    },
  };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  const ctx = { server, api, env: {}, userId: 'admin-1', userName: 'Admin', userEmail: null } as unknown as ToolContext;
  registerUsageTools(ctx);
  return { tools, calls };
}

const json = (r: CallToolResult) => JSON.parse(r.content.map((c) => (c.type === 'text' ? c.text : '')).join(''));

describe('usage tools', () => {
  it('registers the six admin tools', () => {
    expect([...fakeContext().tools.keys()].sort()).toEqual(['ai_usage', 'event_counts', 'feature_adoption', 'recent_errors', 'usage_summary', 'user_timeline']);
  });

  it('usage_summary and feature_adoption address the user by email', async () => {
    const { tools, calls } = fakeContext();
    const summary = json(await tools.get('usage_summary')!({ user: 'minghui@x.test', since: '30d' }));
    expect(summary.active_days).toBe(2);
    expect(calls[0]).toEqual({ method: 'GET', path: '/api/admin/usage/summary', query: { user: 'minghui@x.test', since: '30d' } });
    const adoption = json(await tools.get('feature_adoption')!({ user: 'minghui@x.test' }));
    expect(adoption.never_used.map((f: { event: string }) => f.event)).toEqual(['call.screen_share']);
    expect(adoption.old_path_in_use[0]).toMatchObject({ old: 'lesson.grammar_start', replaced_by: 'lesson.start' });
    expect(calls[1].query).toEqual({ user: 'minghui@x.test' });
  });

  it('user_timeline passes date, tz offset and hides screens on request', async () => {
    const { tools, calls } = fakeContext();
    const res = json(await tools.get('user_timeline')!({ user: 'minghui@x.test', date: '2026-10-01', tz_offset_minutes: 480, include_screens: false }));
    expect(res.events.map((e: { event: string }) => e.event)).toEqual(['chat.send']);
    expect(calls[0].query).toEqual({ user: 'minghui@x.test', date: '2026-10-01', tz_offset: '480', screens: '0' });
  });

  it('event_counts defaults to by-day and supports prefixes; ai_usage defaults to by-model', async () => {
    const { tools, calls } = fakeContext();
    expect(json(await tools.get('event_counts')!({ event: 'chat.*' }))).toEqual({ total: 1, group_by: 'day' });
    expect(json(await tools.get('ai_usage')!({}))).toMatchObject({ group_by: 'model', totals: { calls: 1 } });
    expect(calls.map((c) => c.query?.group_by)).toEqual(['day', 'model']);
  });

  it('recent_errors returns errors shown; a 403 becomes a tool error', async () => {
    const { tools } = fakeContext();
    expect(json(await tools.get('recent_errors')!({ user: 'minghui@x.test' })).errors_shown).toHaveLength(1);
    const res = await tools.get('usage_summary')!({ user: 'not-admin' });
    expect(res.isError).toBe(true);
  });
});
