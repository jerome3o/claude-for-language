import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAdminTools } from './admin';
import type { ToolContext } from './context';
import { ApiError } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;
interface Call { method: string; path: string; body?: unknown }

function fakeContext(routes: Record<string, (body?: unknown) => unknown>) {
  const tools = new Map<string, Handler>();
  const calls: Call[] = [];
  const respond = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (!route) return Promise.reject(new ApiError(404, `No fake route for ${method} ${path}`, null));
    try {
      return Promise.resolve(route(body));
    } catch (err) {
      return Promise.reject(err);
    }
  };
  const api = {
    get: (path: string, query?: Record<string, unknown>) => respond('GET', query && Object.keys(query).length ? `${path}?${new URLSearchParams(query as Record<string, string>)}` : path),
    post: (path: string, body?: unknown) => respond('POST', path, body ?? {}),
    put: (path: string, body?: unknown) => respond('PUT', path, body ?? {}),
    patch: (path: string, body?: unknown) => respond('PATCH', path, body ?? {}),
    delete: (path: string, body?: unknown) => respond('DELETE', path, body),
  };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  const ctx = { server, api, env: {}, userId: 'admin-1', userName: 'Admin', userEmail: null } as unknown as ToolContext;
  return { ctx, tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('admin tools', () => {
  it('registers the admin tool set', () => {
    const { ctx, tools } = fakeContext({});
    registerAdminTools(ctx);
    expect([...tools.keys()].sort()).toEqual([
      'admin_delete_user', 'admin_get_user', 'admin_handle_access_request', 'admin_inspect_user_decks', 'admin_list_access_requests',
      'admin_list_users', 'admin_preview_delete_user', 'admin_set_can_invite', 'admin_set_role', 'admin_set_user_voice_gender',
      'audio_backfill_run', 'audio_backfill_status', 'audio_retry_failed', 'audio_tts_compare',
    ]);
  });

  it('audio backfill: status is a read-only GET; run posts the limit only when given', async () => {
    const { ctx, tools, calls } = fakeContext({
      'GET /api/admin/audio/backfill': () => ({ backlog: 12, eta_minutes: 1 }),
      'POST /api/admin/audio/backfill/run': () => ({ pump_started: true, queued: 0 }),
    });
    registerAdminTools(ctx);
    expect(text(await tools.get('audio_backfill_status')!({}))).toContain('"backlog": 12');
    await tools.get('audio_backfill_run')!({});
    await tools.get('audio_backfill_run')!({ limit: 50 });
    expect(calls).toEqual([
      { method: 'GET', path: '/api/admin/audio/backfill', body: undefined },
      { method: 'POST', path: '/api/admin/audio/backfill/run', body: {} },
      { method: 'POST', path: '/api/admin/audio/backfill/run', body: { limit: 50 } },
    ]);
  });

  it('audio_retry_failed posts the error code only when given', async () => {
    const { ctx, tools, calls } = fakeContext({
      'POST /api/admin/audio/retry-failed': () => ({ reset: 715, account_probe_now: true }),
    });
    registerAdminTools(ctx);
    expect(text(await tools.get('audio_retry_failed')!({}))).toContain('"reset": 715');
    await tools.get('audio_retry_failed')!({ error_code: 2053 });
    expect(calls).toEqual([
      { method: 'POST', path: '/api/admin/audio/retry-failed', body: {} },
      { method: 'POST', path: '/api/admin/audio/retry-failed', body: { error_code: 2053 } },
    ]);
  });

  it('set_role and inspect address the user by email through the admin API', async () => {
    const { ctx, tools, calls } = fakeContext({
      'PUT /api/admin/users/mh%40example.com/role': (body) => ({ id: 'u1', email: 'mh@example.com', role: (body as { role: string }).role }),
      'GET /api/admin/users/mh%40example.com/decks': () => ({ decks: [], deleted_decks: [], untombstoned_deleted_sources: ['d1'] }),
    });
    registerAdminTools(ctx);
    expect(JSON.parse(text(await tools.get('admin_set_role')!({ user: 'mh@example.com', role: 'tutor' })))).toMatchObject({ role: 'tutor' });
    expect(calls[0]).toEqual({ method: 'PUT', path: '/api/admin/users/mh%40example.com/role', body: { role: 'tutor' } });
    const decks = JSON.parse(text(await tools.get('admin_inspect_user_decks')!({ user: 'mh@example.com' })));
    expect(decks.untombstoned_deleted_sources).toEqual(['d1']);
  });

  it('set_user_voice_gender puts male / female / other / null through the admin API', async () => {
    const { ctx, tools, calls } = fakeContext({
      'PUT /api/admin/users/u1/voice-gender': (body) => ({ id: 'u1', ...(body as object) }),
    });
    registerAdminTools(ctx);
    expect(JSON.parse(text(await tools.get('admin_set_user_voice_gender')!({ user: 'u1', voice_gender: 'male' })))).toMatchObject({ voice_gender: 'male' });
    await tools.get('admin_set_user_voice_gender')!({ user: 'u1', voice_gender: null });
    expect(calls.map((c) => c.body)).toEqual([{ voice_gender: 'male' }, { voice_gender: null }]);
  });

  it('delete sends the typed email as confirmation and refuses a non-email locally', async () => {
    const { ctx, tools, calls } = fakeContext({
      'DELETE /api/admin/users/u1': (body) => ({ deleted_user: { id: 'u1' }, confirm: body }),
    });
    registerAdminTools(ctx);
    const bad = await tools.get('admin_delete_user')!({ user: 'u1', confirm_email: 'yes' });
    expect(bad.isError).toBe(true);
    expect(calls).toEqual([]);
    const ok = JSON.parse(text(await tools.get('admin_delete_user')!({ user: 'u1', confirm_email: 'mh@example.com' })));
    expect(ok.confirm).toEqual({ confirm_email: 'mh@example.com' });
  });

  it('surfaces the API 403 for non-admins as a tool error', async () => {
    const { ctx, tools } = fakeContext({
      'GET /api/admin/users': () => { throw new ApiError(403, 'Forbidden', { error: 'Forbidden' }); },
    });
    registerAdminTools(ctx);
    const res = await tools.get('admin_list_users')!({});
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('HTTP 403');
  });

  it('list_users filters by email or name', async () => {
    const { ctx, tools } = fakeContext({
      'GET /api/admin/users': () => [
        { id: 'a', email: 'mhmandarinchina@gmail.com', name: 'Mandarin Home' },
        { id: 'b', email: 'jerome@example.com', name: 'Jerome' },
      ],
    });
    registerAdminTools(ctx);
    const res = JSON.parse(text(await tools.get('admin_list_users')!({ query: 'mandarin' })));
    expect(res.users.map((x: { id: string }) => x.id)).toEqual(['a']);
  });
});
