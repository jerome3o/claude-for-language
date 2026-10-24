import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerClipTools, shapeClip } from './clips';
import type { ToolContext } from './context';
import { SAMPLE_CLIP } from '../../../shared/clips/sample';
import type { ClipRecord } from '../../../shared/clips/types';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function fakeContext(responses: Record<string, unknown>) {
  const tools = new Map<string, { description: string; handler: Handler }>();
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
  const server = { tool: (name: string, description: string, _s: unknown, handler: Handler) => { tools.set(name, { description, handler }); } };
  registerClipTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

const clip: ClipRecord = {
  id: 'c1', status: 'ready', source: 'agent', title: SAMPLE_CLIP.title, topic: '刚 vs 刚才', theme: 'neon', spec: SAMPLE_CLIP,
  images: { p: 'lesson-images/x.png' }, progress: null, error: null, created_at: '2026-10-24 10:00:00',
  state: { viewed: true, completed: false, liked: true, saved: false, skips: 0 }, lesson: null,
};

describe('clip tools', () => {
  it('create_clip carries the spec doc, pre-checks, then imports as agent', async () => {
    const { tools, calls } = fakeContext({ 'POST /api/clips': { clip, pinyin_fixes: [{ where: 'x', hanzi: '饭', before: 'fān', after: 'fàn', path: 'p', reason: 'r' }] } });
    const create = tools.get('create_clip')!;
    expect(create.description).toContain('Clip spec v1');
    const bad = await create.handler({ spec: { v: 1 } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('title is required');
    expect(calls).toEqual([]);
    const ok = JSON.parse(text(await create.handler({ spec: SAMPLE_CLIP })));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/clips', body: { source: 'agent' } });
    expect(ok.clip).toMatchObject({ id: 'c1', app_path: '/clips/c1', length: '0:41', watched: 'started', liked: true });
    expect(ok.pinyin_fixes).toEqual([{ where: 'x', hanzi: '饭', before: 'fān', after: 'fàn' }]);
  });

  it('list_clips filters and trims; get_clip has the spec; generate_clips posts', async () => {
    const generating = { ...clip, id: 'c2', status: 'generating', spec: null, progress: 'Writing the clip…' } as ClipRecord;
    const { tools, calls } = fakeContext({
      'GET /api/clips': { clips: [generating, clip] },
      'GET /api/clips/c1': { clip },
      'POST /api/clips/generate': { clips: [generating] },
    });
    const list = JSON.parse(text(await tools.get('list_clips')!.handler({ status: 'ready' })));
    expect(list.total).toBe(2);
    expect(list.clips.map((c: { id: string }) => c.id)).toEqual(['c1']);
    expect(list.clips[0].spec).toBeUndefined();
    const one = JSON.parse(text(await tools.get('get_clip')!.handler({ clip_id: 'c1' })));
    expect(one.clip.spec.title).toBe(SAMPLE_CLIP.title);
    const gen = JSON.parse(text(await tools.get('generate_clips')!.handler({ topic: '打车', count: 2 })));
    expect(gen.started).toBe(1);
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/api/clips/generate', body: { topic: '打车', count: 2, via: 'mcp' } });
    expect(shapeClip(generating)).toMatchObject({ status: 'generating', progress: 'Writing the clip…' });
  });
});
