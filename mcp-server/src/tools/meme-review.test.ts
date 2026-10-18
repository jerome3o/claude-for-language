import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerMemeReviewTools, shapeMemeIssue } from './meme-review';
import type { ToolContext } from './context';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function fakeContext(responses: Record<string, unknown>) {
  const tools = new Map<string, Handler>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      return responses[`GET ${path}`];
    },
    post: async (path: string, body: unknown) => {
      calls.push({ method: 'POST', path, body });
      return responses[`POST ${path}`];
    },
  };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerMemeReviewTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

const ready = {
  month: '2026-10', status: 'ready', progress: null, error: null, updated_at: null,
  issue: {
    month: '2026-10', title: '十月梗回顾', title_en: 'October', intro: { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hi' }, covers: { from: '2026-08-23', to: '2026-10-18' },
    items: [{ id: 'm1', hanzi: '搭子', pinyin: 'dāzi', english: 'buddy', picture: { prompt: 'p', image_key: 'meme-review/images/x.png' }, sources: [] }],
    quiz: [], generator_version: 1,
  },
};

describe('meme review tools', () => {
  it('get_meme_review reads the newest ready issue without picture keys', async () => {
    const { tools, calls } = fakeContext({
      'GET /api/meme-review': { issues: [{ month: '2026-11', status: 'generating', title: null, item_count: 0 }, { month: '2026-10', status: 'ready', title: '十月梗回顾', item_count: 1 }], current_month: '2026-11' },
      'GET /api/meme-review/2026-10': { issue: ready, lesson: null },
    });
    const out = JSON.parse(text(await tools.get('get_meme_review')!({})));
    expect(calls.map((c) => c.path)).toEqual(['/api/meme-review', '/api/meme-review/2026-10']);
    expect(out.issue).toMatchObject({ month: '2026-10', status: 'ready', app_path: '/meme-review/2026-10' });
    expect(out.issue.items[0].picture).toBeUndefined();
    expect(out.months).toHaveLength(2);
  });

  it('generate_meme_review posts as mcp', async () => {
    const { tools, calls } = fakeContext({ 'POST /api/meme-review/generate': { started: true, issue: { ...ready, status: 'generating', issue: null, progress: 'Researching…' } } });
    const out = JSON.parse(text(await tools.get('generate_meme_review')!({ month: '2026-10' })));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/meme-review/generate', body: { month: '2026-10', via: 'mcp' } });
    expect(out).toMatchObject({ started: true, issue: { status: 'generating', progress: 'Researching…' } });
  });

  it('shapes the other states', () => {
    expect(shapeMemeIssue({ month: '2026-09', status: 'missing', issue: null, progress: null, error: null, updated_at: null })).toMatchObject({ status: 'missing' });
    expect(shapeMemeIssue({ month: '2026-09', status: 'failed', issue: null, progress: null, error: 'x', updated_at: null })).toMatchObject({ error: 'x' });
  });
});
