import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerCheckTools, checkWarningsMessage, type CheckWarning } from './checks.js';
import type { ToolContext } from './context.js';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const proposal = { id: 'p1', note_id: 'n1', hanzi: '银行', field: 'pinyin', kind: 'reading', current: 'yínxíng', proposed: 'yínháng', reason: '行 reads háng in 银行', source_note_id: 's1' };

function fake(routes: Record<string, (body?: unknown) => unknown>) {
  const tools = new Map<string, Handler>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const respond = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const fn = routes[`${method} ${path}`];
    if (!fn) return Promise.reject(new Error(`unexpected ${method} ${path}`));
    return Promise.resolve(fn(body));
  };
  const api = { get: (p: string) => respond('GET', p), post: (p: string, b?: unknown) => respond('POST', p, b) };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => tools.set(name, handler) };
  const ctx = { server, api, env: {}, userId: 'tutor', userName: null, userEmail: null } as unknown as ToolContext;
  registerCheckTools(ctx, { pollMs: 0, maxWaitMs: 1000 });
  return { tools, calls };
}

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;

describe('check tools', () => {
  it("check_deck_for_errors starts a check on the student's copy, waits, and returns proposals without applying", async () => {
    let polls = 0;
    const { tools, calls } = fake({
      'POST /api/relationships/rel/shared-decks/share/check': () => ({ job: { id: 'j1', status: 'queued', checked: 0, total: 319, proposals: [], cost_usd: 0 } }),
      'GET /api/deck-checks/j1': () => ({ job: { id: 'j1', status: ++polls > 1 ? 'done' : 'running', checked: 319, total: 319, deck_name: 'Lesson 8', proposals: [proposal], cost_usd: 0.0123 } }),
    });
    const res = await tools.get('check_deck_for_errors')!({ relationship_id: 'rel', shared_deck_id: 'share' });
    const body = JSON.parse(text(res));
    expect(body.status).toBe('done');
    expect(body.proposals).toEqual([expect.objectContaining({ proposal_id: 'p1', proposed: 'yínháng', also_in_your_source_deck: true })]);
    expect(body.message).toMatch(/Nothing was changed/);
    expect(calls.some(c => c.path.includes('/apply'))).toBe(false);
  });

  it('check_deck_for_errors needs a target', async () => {
    const { tools } = fake({});
    expect((await tools.get('check_deck_for_errors')!({})).isError).toBe(true);
  });

  it('apply_note_fixes applies exactly the approved proposals / warnings', async () => {
    const { tools, calls } = fake({
      'POST /api/deck-checks/j1/apply': () => ({ applied: ['p1'], source_applied: ['p1'], failed: [] }),
      'POST /api/notes/n2/check-issues/i2/apply': () => ({ note: {} }),
    });
    const a = JSON.parse(text(await tools.get('apply_note_fixes')!({ job_id: 'j1', proposal_ids: ['p1'], also_source: true })));
    expect(a).toMatchObject({ applied: 1, source_applied: 1 });
    expect(calls[0].body).toEqual({ proposal_ids: ['p1'], also_source: true });
    const b = JSON.parse(text(await tools.get('apply_note_fixes')!({ fixes: [{ note_id: 'n2', issue_id: 'i2' }] })));
    expect(b.applied).toBe(1);
    expect((await tools.get('apply_note_fixes')!({ job_id: 'j1' })).isError).toBe(true);
  });

  it('checkWarningsMessage says nothing changed and how to apply', () => {
    expect(checkWarningsMessage([])).toBe('');
    const w: CheckWarning = { note_id: 'n1', hanzi: '一样', issue_id: 'i1', field: 'pinyin', kind: 'tone_change', current: 'yī yàng', proposed: 'yí yàng', reason: '一 changes tone' };
    const msg = checkWarningsMessage([w]);
    expect(msg).toContain('一样 — pinyin: "yī yàng" → "yí yàng"');
    expect(msg).toContain('apply_note_fixes');
  });
});

describe('backfill_word_tags', () => {
  const progress = { total: 5600, tagged: 1200, untagged: 4400, outdated: 0, input_tokens: 90_000, output_tokens: 40_000, cost_usd: 0.29, queued_this_hour: 0, per_hour: 200 };

  it('queues the untagged notes now and reports progress + what is left', async () => {
    const { tools, calls } = fake({ 'POST /api/notes/word-tags/backfill': () => ({ ...progress, queued: 500 }) });
    const body = JSON.parse(text(await tools.get('backfill_word_tags')!({ limit: 500 })));
    expect(calls[0].body).toEqual({ limit: 500 });
    expect(body).toMatchObject({ queued: 500, tagged: 1200, total: 5600 });
    expect(body.estimated_cost_left_usd).toBeGreaterThan(0);
    expect(body.message).toContain('1200 of 5600');
    expect(body.message).toContain('queued 500');
  });

  it('says how many notes have tags of an older version, to be redone', async () => {
    const { tools } = fake({ 'GET /api/notes/word-tags/backfill': () => ({ ...progress, tagged: 0, untagged: 5600, outdated: 4400 }) });
    const body = JSON.parse(text(await tools.get('backfill_word_tags')!({ status_only: true })));
    expect(body.message).toContain('0 of 5600 notes have up-to-date AI word tags (4400 more have older tags, to be redone)');
  });

  it('status_only reads progress without queueing', async () => {
    const { tools, calls } = fake({ 'GET /api/notes/word-tags/backfill': () => progress });
    const body = JSON.parse(text(await tools.get('backfill_word_tags')!({ status_only: true })));
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(body.queued).toBe(0);
  });
});
