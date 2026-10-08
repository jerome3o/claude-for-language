import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SAMPLE_IDIOM_ENTRY } from '../../../shared/idioms/sample';
import { registerIdiomTools } from './idioms';
import type { ToolContext } from './context';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function fakeContext(responses: { post: unknown; gets: unknown[] }) {
  const tools = new Map<string, Handler>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      return responses.gets.shift();
    },
    post: async (path: string, body: unknown) => {
      calls.push({ method: 'POST', path, body });
      return responses.post;
    },
  };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerIdiomTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext, { sleep: async () => undefined, pollMs: 1, waitMs: 60_000 });
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
const record = (status: string, extra: Record<string, unknown> = {}) => ({ hanzi: '画蛇添足', status, entry: null, error: null, suggestion: null, generator_version: 1, updated_at: null, ...extra });

describe('idiom tools', () => {
  it('get_idiom generates and waits until the entry is ready', async () => {
    const { tools, calls } = fakeContext({
      post: { idiom: record('generating') },
      gets: [{ idiom: record('generating') }, { idiom: record('ready', { entry: SAMPLE_IDIOM_ENTRY }) }],
    });
    const out = JSON.parse(text(await tools.get('get_idiom')!({ hanzi: '画蛇添足' })));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/idioms',
      `GET /api/idioms/${encodeURIComponent('画蛇添足')}`,
      `GET /api/idioms/${encodeURIComponent('画蛇添足')}`,
    ]);
    expect(out.idiom).toMatchObject({ status: 'ready', app_path: `/idioms/${encodeURIComponent('画蛇添足')}` });
    expect(out.idiom.entry.origin.source).toBe('《战国策·齐策二》');
    expect(out.idiom.caution).toBeUndefined();
  });

  it('get_idiom reports not-an-idiom with the suggestion', async () => {
    const { tools } = fakeContext({ post: { idiom: record('not_idiom', { hanzi: '画蛇添脚', error: 'Not a set expression.', suggestion: '画蛇添足' }) }, gets: [] });
    const out = JSON.parse(text(await tools.get('get_idiom')!({ hanzi: '画蛇添脚' })));
    expect(out.idiom).toMatchObject({ status: 'not_idiom', did_you_mean: '画蛇添足' });
  });

  it('list_idioms lists the starter list and the rest with app paths', async () => {
    const { tools, calls } = fakeContext({
      post: null,
      gets: [{ starter: [{ hanzi: '画蛇添足', pinyin: 'huà shé tiān zú', english: 'overdo it', status: 'ready', starter: true }], more: [] }],
    });
    const out = JSON.parse(text(await tools.get('list_idioms')!({})));
    expect(calls[0].path).toBe('/api/idioms');
    expect(out.starter[0]).toMatchObject({ hanzi: '画蛇添足', status: 'ready' });
  });
});
