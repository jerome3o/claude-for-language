import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { structuredCall, StructuredCallError } from '../structured-call';
import { normalizeCoachResult } from '../sentence-coach';
import { normalizeTranslation } from '../sentence-translate';

type Reply = Record<string, unknown> | Error;

function fakeClient(replies: Reply[]) {
  const calls: Array<Record<string, any>> = [];
  const client = {
    messages: {
      create: async (params: Record<string, any>) => {
        calls.push(params);
        const next = replies.shift();
        if (!next) throw new Error('no more replies');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const toolReply = (input: unknown, stop_reason = 'tool_use') => ({
  stop_reason,
  usage: { output_tokens: 10 },
  content: [{ type: 'tool_use', id: 't', name: 'x', input }],
});

const base = {
  apiKey: 'k',
  model: 'claude-sonnet-5',
  system: 's',
  user: 'u',
  tool: { name: 'x', description: 'd', input_schema: { type: 'object' as const, properties: {} } },
  maxTokens: 1000,
  sleep: async () => {},
};

const valid = (input: unknown) => {
  const v = input as { ok?: boolean };
  if (!v?.ok) throw new Error('bad shape');
  return v;
};

describe('structuredCall', () => {
  it('forces the tool with thinking disabled and returns the validated input', async () => {
    const { client, calls } = fakeClient([toolReply({ ok: true })]);
    expect(await structuredCall({ ...base, client, validate: valid })).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5', max_tokens: 1000, thinking: { type: 'disabled' }, tool_choice: { type: 'tool', name: 'x' } });
  });

  it('retries a cut-off reply with double the token budget', async () => {
    const { client, calls } = fakeClient([toolReply({ ok: true }, 'max_tokens'), toolReply({ ok: true })]);
    await structuredCall({ ...base, client, validate: valid });
    expect(calls.map((c) => c.max_tokens)).toEqual([1000, 2000]);
  });

  it('retries a bad shape and a network error, then falls back to Haiku on the last attempt', async () => {
    const { client, calls } = fakeClient([toolReply({ ok: false }), new Error('socket hang up'), toolReply({ ok: true })]);
    expect(await structuredCall({ ...base, client, validate: valid })).toEqual({ ok: true });
    expect(calls.map((c) => c.model)).toEqual(['claude-sonnet-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
  });

  it('jumps straight to the fallback model on a 400 from the primary', async () => {
    const bad = new Anthropic.BadRequestError(400, { error: { message: 'nope' } }, 'nope', new Headers());
    const { client, calls } = fakeClient([bad, toolReply({ ok: true })]);
    expect(await structuredCall({ ...base, client, validate: valid })).toEqual({ ok: true });
    expect(calls.map((c) => c.model)).toEqual(['claude-sonnet-5', 'claude-haiku-4-5']);
  });

  it('does not retry a refusal', async () => {
    const { client, calls } = fakeClient([{ stop_reason: 'refusal', content: [], usage: {} }]);
    await expect(structuredCall({ ...base, client, validate: valid })).rejects.toMatchObject({ retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('throws a retryable StructuredCallError when every attempt fails', async () => {
    const { client } = fakeClient([new Error('a'), new Error('b'), new Error('c')]);
    const err = await structuredCall({ ...base, client, validate: valid }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredCallError);
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('c');
  });
});

describe('coach normalizers', () => {
  it('cleans a coach result and fills the fields the UI expects', () => {
    const r = normalizeCoachResult({
      isCorrect: false,
      corrected: { hanzi: ' 我的智能体在我们的应用里加了视频通话功能。 ', pinyin: 'wǒ de zhìnéngtǐ …', english: 'My agent added video calling to our app.' },
      critique: 'Use 应用 or keep "app".',
      alternatives: [{ hanzi: '我的智能体给我们的应用加了视频通话。', pinyin: 'x', english: 'y' }, { hanzi: '' }],
    }, '我的智能体在我们的app ostensibly加了视频电话功能');
    expect(r.corrected.hanzi).toBe('我的智能体在我们的应用里加了视频通话功能。');
    expect(r.inputLanguage).toBe('chinese');
    expect(r.alternatives).toHaveLength(1);
    expect(r).toMatchObject({ issues: [], vocabSuggestions: [], originalInput: '我的智能体在我们的app ostensibly加了视频电话功能' });
  });

  it('rejects a coach result without a corrected sentence', () => {
    expect(() => normalizeCoachResult({ critique: 'x' }, '你好')).toThrow();
  });

  it('cleans a translation and back-fills the English', () => {
    const t = normalizeTranslation({ primary: { hanzi: '我要迟到了。', pinyin: 'wǒ yào chídào le.' }, alternatives: 'junk' }, "I'm running late");
    expect(t.primary.english).toBe("I'm running late");
    expect(t.alternatives).toEqual([]);
    expect(() => normalizeTranslation({ primary: {} }, 'x')).toThrow();
  });
});
