import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerUpNextTools, shapeAddResult, shapeUpNext, type ApiUpNext } from './up-next';
import type { ToolContext } from './context';
import type { ApiClient } from '../api';
import { ApiError } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const entry = (note_id: string, hanzi: string, extra: Partial<ApiUpNext> = {}): ApiUpNext => ({
  id: `u-${note_id}`, note_id, position: 0, created_at: '2026-10-12T08:00:00.000Z', source: 'mcp', added_by_name: null,
  hanzi, pinyin: 'pīnyīn', english: 'meaning', deck_id: 'd1', deck_name: 'HSK 2', status: 'new', new_cards: 3, total_cards: 3, ...extra,
});
const LIST = [entry('n-bank', '银行'), entry('n-student', '学生'), entry('n-noodle', '面条', { status: 'started', new_cards: 2, added_by_name: 'Minghui' })];

function fakeContext(opts: { notFound?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path === '/api/me/bumps') return { bumps: [{ note_id: 'n-x', created_at: 'now', bumped_by_name: null, hanzi: '火车', pinyin: 'huǒchē', english: 'train', deck_name: 'Travel' }] };
      return { up_next: LIST };
    },
    post: async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body });
      if (opts.notFound) throw new ApiError(404, 'None of those words are in your decks', { up_next: [], added: [], already: [], moved: [], no_new_cards: [], not_found: body.hanzi ?? [], over_limit: [] });
      return { up_next: LIST, added: [{ note_id: 'n-bank', hanzi: '银行' }], already: [], moved: [], no_new_cards: [{ note_id: 'n-rice', hanzi: '米饭' }], not_found: [], over_limit: [] };
    },
    put: async (path: string, body: any) => {
      calls.push({ method: 'PUT', path, body });
      const byId = new Map(LIST.map((e) => [e.note_id, e]));
      return { up_next: (body.note_ids as string[]).map((id) => byId.get(id)!) };
    },
    delete: async (path: string) => { calls.push({ method: 'DELETE', path }); return { removed: 1, up_next: LIST.slice(1) }; },
  };
  const tools = new Map<string, Handler>();
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerUpNextTools({ server, api: api as unknown as ApiClient, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('up next tools', () => {
  it('get_up_next returns the list (1-based) and today’s pocket', async () => {
    const { tools } = fakeContext();
    const out = JSON.parse(text(await tools.get('get_up_next')!({})));
    expect(out.up_next_count).toBe(3);
    expect(out.up_next[2]).toMatchObject({ position: 3, hanzi: '面条', status: 'Started · 2 new cards left', added_by: 'Minghui' });
    expect(out.today_pocket[0].hanzi).toBe('火车');
  });

  it('add_to_up_next posts with source mcp and a 0-based position; studied words get the bump hint', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('add_to_up_next')!({ hanzi: ['银行', '米饭'], position: 1 })));
    expect(calls).toEqual([{ method: 'POST', path: '/api/me/up-next', body: { note_ids: undefined, hanzi: ['银行', '米饭'], position: 0, source: 'mcp' } }]);
    expect(out.message).toBe('↑ 银行 is up next');
    expect(out.already_studied).toEqual(['米饭']);
    expect(out.hint).toMatch(/bump_cards/);
    expect((await tools.get('add_to_up_next')!({})).isError).toBe(true);
  });

  it('words the user does not have come back as not_found, not an error', async () => {
    const { tools } = fakeContext({ notFound: true });
    const out = JSON.parse(text(await tools.get('add_to_up_next')!({ hanzi: ['火车'], position: 'top' })));
    expect(out.not_found).toEqual(['火车']);
    expect(out.message).toMatch(/add them as new notes/);
  });

  it('move_in_up_next PUTs the whole new order', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('move_in_up_next')!({ hanzi: '面 条', to: 'top' })));
    expect(calls.at(-1)).toEqual({ method: 'PUT', path: '/api/me/up-next/order', body: { note_ids: ['n-noodle', 'n-bank', 'n-student'] } });
    expect(out.message).toBe('面条 is now #1 of 3');
    await tools.get('move_in_up_next')!({ note_id: 'n-bank', to: 'down' });
    expect(calls.at(-1)?.body).toEqual({ note_ids: ['n-student', 'n-bank', 'n-noodle'] });
    await tools.get('move_in_up_next')!({ note_id: 'n-bank', to: 3 });
    expect(calls.at(-1)?.body).toEqual({ note_ids: ['n-student', 'n-noodle', 'n-bank'] });
    expect((await tools.get('move_in_up_next')!({ hanzi: '火车', to: 'top' })).isError).toBe(true);
  });

  it('remove_from_up_next by hanzi; the tutor variants hit the student routes', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('remove_from_up_next')!({ hanzi: '银行' })));
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/api/me/up-next/n-bank' });
    expect(out.removed).toBe(1);
    await tools.get('get_student_up_next')!({ relationship_id: 'rel-1' });
    expect(calls.at(-1)).toEqual({ method: 'GET', path: '/api/relationships/rel-1/student-up-next' });
    await tools.get('add_to_student_up_next')!({ relationship_id: 'rel-1', hanzi: ['学生'], position: 'top' });
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/api/relationships/rel-1/student-up-next', body: { note_ids: undefined, hanzi: ['学生'], position: 'top' } });
    await tools.get('move_in_student_up_next')!({ relationship_id: 'rel-1', note_id: 'n-student', to: 'top' });
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/api/relationships/rel-1/student-up-next/order' });
    await tools.get('remove_from_student_up_next')!({ relationship_id: 'rel-1', note_id: 'n-student' });
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/api/relationships/rel-1/student-up-next/n-student' });
  });

  it('shapes', () => {
    expect(shapeUpNext(LIST).map((e) => e.position)).toEqual([1, 2, 3]);
    expect(shapeAddResult({ up_next: [], added: [], already: [], moved: [{ note_id: 'n', hanzi: '银行' }], no_new_cards: [], not_found: [], over_limit: [] }).message).toBe('Moved 银行');
  });
});
