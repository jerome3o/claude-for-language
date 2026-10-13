import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerNoteImageTools } from './note-images.js';
import type { ToolContext } from './context.js';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function fake(routes: Record<string, (body?: unknown) => unknown>) {
  const tools = new Map<string, Handler>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const respond = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const fn = routes[`${method} ${path}`];
    if (!fn) return Promise.reject(new Error(`unexpected ${method} ${path}`));
    return Promise.resolve(fn(body));
  };
  const api = {
    get: (p: string) => respond('GET', p),
    post: (p: string, b?: unknown) => respond('POST', p, b),
    put: (p: string, b?: unknown) => respond('PUT', p, b),
    delete: (p: string) => respond('DELETE', p),
  };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => tools.set(name, handler) };
  const ctx = { server, api, env: {}, userId: 'u', userName: null, userEmail: null } as unknown as ToolContext;
  registerNoteImageTools(ctx);
  return { tools, calls };
}

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;
const status = { deck_id: 'd1', deck_name: 'Fruit', total: 3, with_image: 1, pending: 0, failed: 0, missing: 2, estimate: { pictures: 2, usd: 0.14, label: '2 pictures · about $0.14' }, illustrate_new: false, available: true };

describe('note image tools', () => {
  it('illustrate_deck dry_run only reads the estimate; a real run asks for the pictures', async () => {
    const { tools, calls } = fake({
      'GET /api/decks/d1/illustrate': () => status,
      'POST /api/decks/d1/illustrate': () => ({ ready: 0, pending: 2, queued: 2, status: { ...status, pending: 2, missing: 0 } }),
      'PUT /api/decks/d1/illustrate': (b) => b,
    });
    const dry = JSON.parse(text(await tools.get('illustrate_deck')!({ deck_id: 'd1', dry_run: true })));
    expect(dry.message).toMatch(/Nothing was drawn/);
    expect(calls.map(c => c.method)).toEqual(['GET']);
    const run = JSON.parse(text(await tools.get('illustrate_deck')!({ deck_id: 'd1', illustrate_new: true })));
    expect(run.pending).toBe(2);
    expect(calls.find(c => c.method === 'PUT')?.body).toEqual({ illustrate_new: true });
  });

  it("illustrate_note generates, regenerates or removes one card's picture", async () => {
    const { tools, calls } = fake({
      'POST /api/notes/n1/image/generate': (b) => ({ note: { image_status: 'pending', b } }),
      'DELETE /api/notes/n1/image': () => ({ note: { image_key: null } }),
    });
    await tools.get('illustrate_note')!({ note_id: 'n1', regenerate: true });
    expect(calls[0].body).toEqual({ regenerate: true });
    await tools.get('illustrate_note')!({ note_id: 'n1', remove: true });
    expect(calls[1].method).toBe('DELETE');
  });
});
