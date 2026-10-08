import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { SAMPLE_IDIOM_ENTRY, STARTER_IDIOMS } from '@shared/idioms';
import { createSqliteD1 } from './sqlite-d1';
import { generateIdiomEntry, getIdiom, listIdioms, requestIdiom, runIdiomJob, IDIOM_SYSTEM, IDIOM_TOOL } from '../idioms';
import { fakeIdiomClient } from '../idioms-fake';
import type { Env } from '../../types';

type Reply = { stop_reason: string; input?: unknown } | Error;

/** A model that answers each call from the list (an Error = the call throws). */
function scripted(replies: Reply[]) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    messages: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        calls.push(params);
        const r = replies.shift() ?? new Error('no more replies');
        if (r instanceof Error) throw r;
        return { stop_reason: r.stop_reason, usage: { input_tokens: 10, output_tokens: 10 }, content: r.input === undefined ? [] : [{ type: 'tool_use', id: 't', name: IDIOM_TOOL.name, input: r.input }] };
      }),
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const noSleep = async () => undefined;

async function env(): Promise<Env> {
  const db = await createSqliteD1();
  return { DB: db, ANTHROPIC_API_KEY: 'test-key' } as unknown as Env;
}

describe('generateIdiomEntry', () => {
  it('forces the tool with thinking off and asks for the requested idiom', async () => {
    const { client, calls } = scripted([{ stop_reason: 'tool_use', input: { is_idiom: true, ...SAMPLE_IDIOM_ENTRY } }]);
    const g = await generateIdiomEntry({ apiKey: 'k', hanzi: '画蛇添足', client, sleep: noSleep });
    expect(g).toEqual({ kind: 'idiom', entry: SAMPLE_IDIOM_ENTRY });
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'write_idiom_entry' });
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
    expect(String((calls[0].messages as Array<{ content: string }>)[0].content)).toContain('画蛇添足');
  });

  it('retries a broken entry and a cut-off reply, on the same model (no Haiku fallback)', async () => {
    const { client, calls } = scripted([
      { stop_reason: 'tool_use', input: { is_idiom: true, hanzi: '画蛇添足' } },
      { stop_reason: 'max_tokens', input: {} },
      { stop_reason: 'tool_use', input: { is_idiom: true, ...SAMPLE_IDIOM_ENTRY } },
    ]);
    const g = await generateIdiomEntry({ apiKey: 'k', hanzi: '画蛇添足', client, sleep: noSleep });
    expect(g.kind).toBe('idiom');
    expect(calls.map((c) => c.model)).toEqual(['claude-sonnet-5', 'claude-sonnet-5', 'claude-sonnet-5']);
    expect(calls[2].max_tokens).toBe(12000);
  });

  it('tells Claude never to invent a source', () => {
    expect(IDIOM_SYSTEM).toMatch(/Never invent a book/);
    expect(IDIOM_SYSTEM).toMatch(/uncertain/);
  });
});

describe('requestIdiom / runIdiomJob', () => {
  it('generates once, stores the entry for everyone, and serves it from the row afterwards', async () => {
    const e = await env();
    const { client } = scripted([{ stop_reason: 'tool_use', input: { is_idiom: true, ...SAMPLE_IDIOM_ENTRY } }]);
    const queued: string[] = [];
    (e as unknown as { IDIOM_QUEUE: unknown }).IDIOM_QUEUE = { send: async (m: { hanzi: string }) => void queued.push(m.hanzi) };

    const first = await requestIdiom(e, '画蛇添足');
    expect(first).toMatchObject({ started: true, record: { status: 'generating' } });
    expect(queued).toEqual(['画蛇添足']);

    // A second request while it is generating does not queue again.
    expect((await requestIdiom(e, '画蛇添足')).started).toBe(false);
    expect(queued).toHaveLength(1);

    expect(await runIdiomJob(e, '画蛇添足', { client, sleep: noSleep })).toBe('ready');
    const record = await getIdiom(e.DB, '画蛇添足');
    expect(record.status).toBe('ready');
    expect(record.entry).toEqual(SAMPLE_IDIOM_ENTRY);
    expect((await requestIdiom(e, '画蛇添足')).started).toBe(false);

    const list = await listIdioms(e.DB);
    expect(list.starter).toHaveLength(STARTER_IDIOMS.length);
    expect(list.starter.find((s) => s.hanzi === '画蛇添足')?.status).toBe('ready');
    expect(list.starter.find((s) => s.hanzi === '守株待兔')?.status).toBe('missing');
  });

  it('records not-an-idiom with the suggestion, and a failure with a readable message (Retry restarts it)', async () => {
    const e = await env();
    const queued: string[] = [];
    (e as unknown as { IDIOM_QUEUE: unknown }).IDIOM_QUEUE = { send: async (m: { hanzi: string }) => void queued.push(m.hanzi) };
    await requestIdiom(e, '画蛇添脚');
    expect(await runIdiomJob(e, '画蛇添脚', { client: fakeIdiomClient() })).toBe('not_idiom');
    expect(await getIdiom(e.DB, '画蛇添脚')).toMatchObject({ status: 'not_idiom', suggestion: '画蛇添足' });

    const { client } = scripted([new Error('overloaded'), new Error('overloaded'), new Error('overloaded')]);
    await e.DB.prepare(`INSERT INTO idioms (hanzi, status) VALUES ('守株待兔', 'generating')`).run();
    expect(await runIdiomJob(e, '守株待兔', { client, sleep: noSleep })).toBe('failed');
    const failed = await getIdiom(e.DB, '守株待兔');
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/try again/);

    expect((await requestIdiom(e, '守株待兔')).record.status).toBe('generating');
    expect(queued).toEqual(['画蛇添脚', '守株待兔']);
  });

  it('marks a stale generating row failed', async () => {
    const e = await env();
    await e.DB.prepare(`INSERT INTO idioms (hanzi, status, started_at) VALUES ('自相矛盾', 'generating', datetime('now', '-30 minutes'))`).run();
    expect((await getIdiom(e.DB, '自相矛盾')).status).toBe('failed');
  });

  it('without an API key (and not E2E) nothing starts', async () => {
    const e = await env();
    (e as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY = undefined;
    expect(await requestIdiom(e, '画蛇添足')).toMatchObject({ started: false, record: { status: 'missing' } });
  });
});
