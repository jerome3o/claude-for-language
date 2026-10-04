import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerBumpTools, shapeBumpResult, shapePocket } from './bumps';
import type { ToolContext } from './context';
import type { ApiClient } from '../api';
import { ApiError } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const BANK = { id: 'b1', note_id: 'n-bank', created_at: '2026-10-04T08:00:00.000Z', source: 'mcp', bumped_by_name: null, hanzi: '银行', pinyin: 'yínháng', english: 'bank', deck_id: 'd1', deck_name: 'HSK 2' };

function fakeContext(opts: { notFound?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => { calls.push({ method: 'GET', path }); return { bumps: [BANK] }; },
    post: async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body });
      if (opts.notFound) throw new ApiError(404, 'None of those words are in your decks', { bumps: [], added: [], already: [], not_found: body.hanzi ?? [] });
      return { bumps: [BANK], added: [{ note_id: 'n-bank', hanzi: '银行' }], already: [], not_found: [] };
    },
    delete: async (path: string) => { calls.push({ method: 'DELETE', path }); return { cleared: 1, bumps: [] }; },
  };
  const tools = new Map<string, Handler>();
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerBumpTools({ server, api: api as unknown as ApiClient, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('bump tools', () => {
  it('bump_cards posts hanzi / note ids with source mcp and returns the pocket', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('bump_cards')!({ hanzi: ['银行'] })));
    expect(calls).toEqual([{ method: 'POST', path: '/api/me/bumps', body: { note_ids: undefined, hanzi: ['银行'], source: 'mcp' } }]);
    expect(out.message).toBe('⚡ 银行 will come first in today’s study');
    expect(out.pocket).toEqual([{ note_id: 'n-bank', hanzi: '银行', pinyin: 'yínháng', english: 'bank', deck: 'HSK 2', bumped_at: '2026-10-04T08:00:00.000Z' }]);
    expect((await tools.get('bump_cards')!({})).isError).toBe(true);
  });

  it('words the user does not have come back as not_found, not an error', async () => {
    const { tools } = fakeContext({ notFound: true });
    const out = JSON.parse(text(await tools.get('bump_cards')!({ hanzi: ['火车'] })));
    expect(out.not_found).toEqual(['火车']);
    expect(out.message).toMatch(/add them as new notes/);
  });

  it('list / clear (by hanzi) / the tutor variant', async () => {
    const { tools, calls } = fakeContext();
    expect(JSON.parse(text(await tools.get('list_bumped_cards')!({}))).count).toBe(1);
    const cleared = JSON.parse(text(await tools.get('clear_bumped_card')!({ hanzi: '银 行' })));
    expect(cleared.cleared).toBe(1);
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/api/me/bumps/n-bank' });
    expect((await tools.get('clear_bumped_card')!({ hanzi: '火车' })).isError).toBe(true);
    await tools.get('bump_student_cards')!({ relationship_id: 'rel-1', hanzi: ['银行'] });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/relationships/rel-1/student-bumps' });
  });

  it('shapes', () => {
    expect(shapePocket([{ ...BANK, bumped_by_name: 'Minghui' }])[0].bumped_by).toBe('Minghui');
    expect(shapeBumpResult({ bumps: [], added: [], already: [{ note_id: 'n', hanzi: '银行' }], not_found: [] }).message).toBe('Already in today’s pocket ⚡');
  });
});
