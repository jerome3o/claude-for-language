import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerPinyinScanTools, shapeScan, type ScanResponse } from './pinyin-scan';
import { pinyinReply, pinyinSuffix } from './content/specs';
import type { ToolContext } from './context';
import type { ApiClient } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const FIX = {
  path: 'sections[0].exercises[1].lines[0].pinyin',
  where: 'section 1 · exercise 2 (conversation) · line 1',
  hanzi: '扶梯在哪儿？',
  before: 'Fúqī zài nǎr?',
  after: 'Fútī zài nǎr?',
  reason: 'reading' as const,
  words: [{ hanzi: '扶梯', from: 'Fúqī', to: 'Fútī' }],
};

function response(apply: boolean): ScanResponse {
  return {
    apply,
    kinds: ['lesson', 'library', 'reader'],
    scanned: { lesson: 3, library: 1, reader: 2 },
    items: [{ kind: 'lesson', id: 'L1', title: 'At the mall', owner: 'mine', fixes: [FIX], ...(apply ? { status: 'applied' } : {}) }],
    fix_count: 1,
    applied: apply ? 1 : 0,
    report: 'Scanned 3 lesson(s)…\n\nLesson "At the mall" [L1]\n  - section 1 · exercise 2 (conversation) · line 1: 扶梯在哪儿？',
  };
}

function fakeContext() {
  const calls: Array<{ path: string; body: any }> = [];
  const api = {
    post: async (path: string, body: any) => {
      calls.push({ path, body });
      return response(body.apply === true);
    },
  };
  const tools = new Map<string, Handler>();
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); } };
  registerPinyinScanTools({ server, api: api as unknown as ApiClient, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

describe('scan_content_pinyin', () => {
  it('is a dry run by default: the readable report first, then the items; nothing applied', async () => {
    const { tools, calls } = fakeContext();
    const out = await tools.get('scan_content_pinyin')!({});
    expect(calls).toEqual([{ path: '/api/me/pinyin-scan', body: { apply: false } }]);
    const [report, json] = out.content.map((c) => (c.type === 'text' ? c.text : ''));
    expect(report).toContain('Lesson "At the mall" [L1]');
    const data = JSON.parse(json);
    expect(data.dry_run).toBe(true);
    expect(data.items[0].fixes).toEqual([{ where: FIX.where, hanzi: FIX.hanzi, before: FIX.before, after: FIX.after }]);
    expect(data.next).toMatch(/only when they say to apply/);
  });

  it('dry_run: false applies (and narrows by kinds)', async () => {
    const { tools, calls } = fakeContext();
    const out = await tools.get('scan_content_pinyin')!({ dry_run: false, kinds: ['lesson'] });
    expect(calls).toEqual([{ path: '/api/me/pinyin-scan', body: { apply: true, kinds: ['lesson'] } }]);
    const data = JSON.parse(out.content[1].type === 'text' ? out.content[1].text : '');
    expect(data).toMatchObject({ dry_run: false, applied_items: 1, items: [{ status: 'applied' }] });
    expect(data.next).toBeUndefined();
  });

  it('shapeScan drops JSON paths and flags student copies', () => {
    const r = response(false);
    r.items[0].owner = 'student_copy';
    expect(shapeScan(r).items[0]).toMatchObject({ id: 'L1', student_copy: true });
  });
});

describe('pinyin fixes in the create / update replies', () => {
  it('pinyinReply / pinyinSuffix', () => {
    expect(pinyinReply(undefined)).toEqual({});
    expect(pinyinReply([])).toEqual({});
    expect(pinyinReply([FIX])).toEqual({ pinyin_fixes: [{ where: FIX.where, hanzi: FIX.hanzi, before: FIX.before, after: FIX.after }] });
    expect(pinyinSuffix([])).toBe('');
    expect(pinyinSuffix([FIX])).toBe(' Pinyin corrected automatically on save (1): 扶梯: Fúqī → Fútī — see pinyin_fixes.');
  });
});
