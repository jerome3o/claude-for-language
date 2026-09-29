import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerPictureHuntTools } from './picture-hunts';
import type { ToolContext } from './context';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const HUNT = { id: 'h1', title: '厨房', source: 'generated', status: 'generating', progress: 'finding the objects', error: null, object_count: 0, best_found: null, play_count: 0, created_at: '2026-09-29' };

function fakeContext() {
  const tools = new Map<string, Handler>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => { calls.push({ method: 'GET', path }); return { hunts: [HUNT] }; },
    post: async (path: string, body: unknown) => { calls.push({ method: 'POST', path, body }); return { hunt: HUNT }; },
  };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerPictureHuntTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('picture hunt tools', () => {
  it('lists hunts trimmed with a play path', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('list_picture_hunts')!({})));
    expect(calls[0]).toEqual({ method: 'GET', path: '/api/picture-hunts' });
    expect(out.hunts[0]).toMatchObject({ id: 'h1', progress: 'finding the objects', play_path: '/picture-hunt/h1' });
    expect(out.hunts[0].error).toBeUndefined();
  });
  it('creates a hunt through the API', async () => {
    const { tools, calls } = fakeContext();
    await tools.get('create_picture_hunt')!({ prompt: 'a market' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/picture-hunts', body: { prompt: 'a market' } });
  });
});
