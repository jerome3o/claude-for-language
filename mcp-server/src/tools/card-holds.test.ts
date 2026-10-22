import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerCardHoldTools, shapeHolds, type ApiHold } from './card-holds';
import type { ToolContext } from './context';
import type { ApiClient } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const HOLD: ApiHold = {
  id: 'h1', card_id: 'c-bank-h', kind: 'suspend', until: null, created_at: '2026-10-20T08:00:00.000Z',
  note_id: 'n-bank', card_type: 'hanzi_to_meaning', hanzi: '银行', pinyin: 'yínháng', english: 'bank', deck_name: 'HSK 2',
};

function fakeContext() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => { calls.push({ method: 'GET', path }); return { holds: [HOLD, { ...HOLD, card_id: 'c2', kind: 'snooze', until: '2026-10-29' }] }; },
    post: async (path: string, body: unknown) => {
      calls.push({ method: 'POST', path, body });
      if (path.endsWith('/clear')) return { cleared: 1, holds: [] };
      return { holds: [HOLD], added: ['c-bank-h'], already: [], not_found: [] };
    },
  };
  const tools = new Map<string, Handler>();
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerCardHoldTools({ server, api: api as unknown as ApiClient, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('card hold tools', () => {
  it('suspend_cards posts kind suspend with source mcp to the user’s own endpoint', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('suspend_cards')!({ hanzi: ['银行'], card_types: ['hanzi_to_meaning'] })));
    expect(calls).toEqual([{ method: 'POST', path: '/api/me/card-holds', body: { note_ids: undefined, hanzi: ['银行'], card_ids: undefined, card_types: ['hanzi_to_meaning'], kind: 'suspend', source: 'mcp' } }]);
    expect(out.suspended).toBe(1);
    expect(out.held[0]).toMatchObject({ hanzi: '银行', card: 'Hanzi → Meaning', status: 'suspended' });
    expect((await tools.get('suspend_cards')!({})).isError).toBe(true);
  });

  it('unsuspend_cards clears; list_suspended_cards shows suspended and snoozed', async () => {
    const { tools, calls } = fakeContext();
    const un = JSON.parse(text(await tools.get('unsuspend_cards')!({ card_ids: ['c-bank-h'] })));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/me/card-holds/clear' });
    expect(un.released).toBe(1);
    const list = JSON.parse(text(await tools.get('list_suspended_cards')!({})));
    expect(list.count).toBe(2);
    expect(list.suspended).toBe(1);
    expect(list.held[1].status).toBe('snoozed until 2026-10-29');
  });

  it('never registers a tool that writes a student’s account', () => {
    const { tools } = fakeContext();
    expect([...tools.keys()].sort()).toEqual(['list_suspended_cards', 'suspend_cards', 'unsuspend_cards']);
    expect(shapeHolds([])).toEqual([]);
  });
});
