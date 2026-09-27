import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerDebugTools } from './debug';
import type { ToolContext } from './context';
import { ApiError } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;
interface Call { method: string; path: string }

function fakeContext(routes: Record<string, () => unknown>) {
  const tools = new Map<string, Handler>();
  const calls: Call[] = [];
  const api = {
    get: (path: string, query?: Record<string, string>) => {
      const full = query && Object.keys(query).length ? `${path}?${new URLSearchParams(query)}` : path;
      calls.push({ method: 'GET', path: full });
      const route = routes[`GET ${full}`] ?? routes[`GET ${path}`];
      return route ? Promise.resolve(route()) : Promise.reject(new ApiError(404, `No fake route for GET ${full}`, null));
    },
  };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  const ctx = { server, api, env: {}, userId: 'u1', userName: 'J', userEmail: null } as unknown as ToolContext;
  registerDebugTools(ctx);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('debug report tools', () => {
  it('registers list / get / compare', () => {
    expect([...fakeContext({}).tools.keys()].sort()).toEqual(['compare_debug_reports', 'get_debug_report', 'list_debug_reports']);
  });

  it('lists with the client filter and a default limit', async () => {
    const { tools, calls } = fakeContext({ 'GET /api/debug/reports': () => ({ reports: [{ id: 'r1' }] }) });
    expect(JSON.parse(text(await tools.get('list_debug_reports')!({ client: 'lab' }))).reports[0].id).toBe('r1');
    expect(calls[0].path).toBe('/api/debug/reports?limit=20&client=lab');
  });

  it('get pages cards and resolves latest_web; overview sends no paging', async () => {
    const { tools, calls } = fakeContext({
      'GET /api/debug/reports?client=web&limit=1': () => ({ reports: [{ id: 'w9' }] }),
      'GET /api/debug/reports/w9': () => ({ section: 'cards', total: 3, cards: [] }),
    });
    await tools.get('get_debug_report')!({ id: 'latest_web', section: 'cards', deck_id: 'd1', in_due_queue: true });
    expect(calls[1].path).toBe('/api/debug/reports/w9?section=cards&offset=0&limit=50&deck_id=d1&in_due_queue=1');
    await tools.get('get_debug_report')!({ id: 'w9' });
    expect(calls[2].path).toBe('/api/debug/reports/w9?section=overview');
  });

  it('says so when there is no latest report', async () => {
    const { tools } = fakeContext({ 'GET /api/debug/reports?client=lab&limit=1': () => ({ reports: [] }) });
    const r = await tools.get('get_debug_report')!({ id: 'latest_lab' });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('No lab report yet');
  });

  it('compare defaults to the newest lab vs web with 25 cards, and passes ids / server=0', async () => {
    const { tools, calls } = fakeContext({ 'GET /api/debug/compare': () => ({ hints: ['No differences found.'] }) });
    expect(JSON.parse(text(await tools.get('compare_debug_reports')!({}))).hints).toEqual(['No differences found.']);
    expect(calls[0].path).toBe('/api/debug/compare?max_cards=25');
    await tools.get('compare_debug_reports')!({ a: 'x1', b: 'y2', max_cards: 5, with_server: false });
    expect(calls[1].path).toBe('/api/debug/compare?max_cards=5&a=x1&b=y2&server=0');
  });
});
