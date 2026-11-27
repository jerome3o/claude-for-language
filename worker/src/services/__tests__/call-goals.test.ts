/**
 * 🎯 Structures in a video call (services/calls/goals.ts): the model check — the E2E stand-in first,
 * the forced tool's answer cleaned, the cache per structure + sentence — and the call listener's key.
 */
import { describe, expect, it } from 'vitest';
import { checkStructureUse, cleanStructureCheck, fakeStructureCheck, structureCheckKey } from '../calls/goals';
import { mintLiveSession, LIVE_CALL_MAX_SESSION_SECONDS } from '../live-transcription';

const input = { name: '一…就…', line: '一 + V + 就 + V', meaning: 'as soon as', fixed: ['一', '就'], sentence: '我一到家就睡觉了' };

function fakeClient(replies: Array<{ used: unknown; reason: unknown }>) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    client: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          const reply = replies.shift();
          return { stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't', name: 'judge', input: reply }] };
        },
      },
    },
  };
}

describe('checkStructureUse', () => {
  it('E2E_TEST_MODE answers with the stand-in first (even with a key)', async () => {
    const f = fakeClient([]);
    expect(await checkStructureUse({ ANTHROPIC_API_KEY: 'k', E2E_TEST_MODE: 'true' }, { ...input, sentence: '我一到家就随便说说' }, { client: f.client as never })).toMatchObject({ ok: false, cached: false });
    expect(f.calls).toHaveLength(0);
    expect(fakeStructureCheck(input).ok).toBe(true);
  });

  it('asks the small model once with a forced tool, then serves the cache', async () => {
    const f = fakeClient([{ used: false, reason: '  一 is the number here  ' }]);
    const s = { ...input, sentence: '一个人就在家' };
    const r = await checkStructureUse({ ANTHROPIC_API_KEY: 'k' }, s, { client: f.client as never });
    expect(r).toEqual({ ok: false, reason: '一 is the number here', cached: false });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].tool_choice).toEqual({ type: 'tool', name: 'judge' });
    expect(JSON.stringify(f.calls[0].messages)).toContain('一个人就在家');
    expect(await checkStructureUse({ ANTHROPIC_API_KEY: 'k' }, { ...s, sentence: ' 一个人就在家 ' }, { client: f.client as never })).toMatchObject({ ok: false, cached: true });
    expect(f.calls).toHaveLength(1);
  });

  it('cleans the answer and keys the cache by structure + sentence', () => {
    expect(() => cleanStructureCheck({ reason: 'x' })).toThrow();
    expect(cleanStructureCheck({ used: true, reason: 'a'.repeat(300) }).reason).toHaveLength(160);
    expect(structureCheckKey({ name: 'A', sentence: 'x  y' })).toBe(structureCheckKey({ name: 'A ', sentence: 'x y' }));
  });
});

describe('the call listener key', () => {
  it('a call key allows one long session', async () => {
    let body: Record<string, unknown> = {};
    const spy = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ api_key: 'snx_temp_1' }), { status: 201 });
    }) as unknown as typeof fetch;
    await mintLiveSession({ SONIOX_API_KEY: 'k' }, 'u', spy, 'call');
    expect(body.max_session_duration_seconds).toBe(LIVE_CALL_MAX_SESSION_SECONDS);
    await mintLiveSession({ SONIOX_API_KEY: 'k' }, 'u', spy);
    expect(body.max_session_duration_seconds).toBe(420);
  });
});
