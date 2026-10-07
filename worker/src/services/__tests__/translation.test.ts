import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  TRANSLATE_FALLBACK_MODEL,
  TRANSLATE_MODEL,
  normalizeSegmentation,
  segmentChineseText,
  segmentationBudget,
  translateAndSegment,
  translateChineseText,
  translationBudget,
} from '../translation';

type Params = { model: string; max_tokens: number; thinking: unknown; tool_choice: { name: string }; messages: Array<{ content: string }> };
type Reply = Record<string, unknown> | Error;

/** A fake Anthropic client answering per tool from a queue. */
function fakeClient(replies: Record<string, Reply[]>) {
  const calls: Params[] = [];
  const client = {
    messages: {
      create: async (params: Params) => {
        calls.push(params);
        const next = replies[params.tool_choice.name]?.shift();
        if (!next) throw new Error(`no more replies for ${params.tool_choice.name}`);
        if (next instanceof Error) throw next;
        return next;
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const toolReply = (input: unknown, stop_reason = 'tool_use', output_tokens = 20) => ({
  stop_reason,
  usage: { input_tokens: 100, output_tokens },
  content: [{ type: 'tool_use', id: 't', name: 'x', input }],
});

// The tutor's 135-character message that broke Translate on 7 Oct 2026 was this long.
const LONG = '明天我们上课的时候先复习一下上次学的生词，然后我会给你讲一个新的语法点，就是“把”字句。'.repeat(3);
const sleep = async () => {};

describe('translateChineseText', () => {
  it('is one short forced-tool reply on Haiku with thinking off', async () => {
    const { client, calls } = fakeClient({ give_translation: [toolReply({ translation: '  See you tomorrow!  ' })] });
    expect(await translateChineseText('k', '明天见！', { client, sleep })).toBe('See you tomorrow!');
    expect(calls[0]).toMatchObject({ model: TRANSLATE_MODEL, thinking: { type: 'disabled' }, tool_choice: { name: 'give_translation' } });
    expect(calls[0].messages[0].content).toContain('明天见！');
    expect(calls[0].max_tokens).toBe(translationBudget('明天见！'));
  });

  it('falls back to another model when Haiku fails, and retries an empty answer', async () => {
    const { client, calls } = fakeClient({ give_translation: [toolReply({ translation: '' }), toolReply({ translation: 'Hello' })] });
    expect(await translateChineseText('k', '你好', { client, sleep })).toBe('Hello');
    expect(calls.map((c) => c.model)).toEqual([TRANSLATE_MODEL, TRANSLATE_FALLBACK_MODEL]);
  });

  it('throws a retryable StructuredCallError when every attempt fails (the route answers 503)', async () => {
    const { client } = fakeClient({ give_translation: [new Error('overloaded'), new Error('overloaded')] });
    await expect(translateChineseText('k', '你好', { client, sleep })).rejects.toMatchObject({ retryable: true });
  });
});

describe('segmentChineseText', () => {
  it('scales its budget with the message (a long message no longer hits a fixed 2000-token cap)', () => {
    expect(segmentationBudget('你好')).toBe(1500);
    expect(segmentationBudget(LONG)).toBeGreaterThan(2000);
    expect(segmentationBudget('字'.repeat(5000))).toBe(8000);
  });

  it('retries a reply cut off at max_tokens with double the budget (regression: 7 Oct 2026)', async () => {
    const good = { pinyin: 'míngtiān jiàn', english: 'See you tomorrow', chunks: [{ hanzi: '明天', pinyin: 'míngtiān', english: 'tomorrow' }, { hanzi: '见', pinyin: 'jiàn', english: 'See you' }] };
    const { client, calls } = fakeClient({ give_breakdown: [toolReply({ chunks: [{ hanzi: '明' }] }, 'max_tokens', 4650), toolReply(good)] });
    const r = await segmentChineseText('k', LONG, { client, sleep });
    expect(r.chunks.map((c) => c.hanzi)).toEqual(['明天', '见']);
    expect(calls[1].max_tokens).toBe(calls[0].max_tokens * 2);
  });
});

describe('normalizeSegmentation', () => {
  it('finds the English highlight indices itself, in order, and keeps notes', () => {
    const r = normalizeSegmentation(
      {
        english: 'I want to buy this',
        chunks: [
          { hanzi: '我', pinyin: 'wǒ', english: 'I' },
          { hanzi: '想', pinyin: 'xiǎng', english: 'want to', note: 'desire' },
          { hanzi: '买', pinyin: 'mǎi', english: 'buy' },
          { hanzi: '这个', pinyin: 'zhège', english: 'this one' },
          { hanzi: '', pinyin: 'x', english: 'y' },
        ],
      },
      '我想买这个',
    );
    expect(r.hanzi).toBe('我想买这个');
    expect(r.pinyin).toBe('wǒ xiǎng mǎi zhège');
    expect(r.chunks).toHaveLength(4);
    expect(r.chunks[1]).toMatchObject({ englishStart: 2, englishEnd: 9, note: 'desire' });
    expect(r.chunks[2]).toMatchObject({ englishStart: 10, englishEnd: 13 });
    expect(r.chunks[3]).toMatchObject({ englishStart: 0, englishEnd: 0 }); // not in the sentence: no highlight
  });

  it('rejects a breakdown with no chunks or no translation (retried)', () => {
    expect(() => normalizeSegmentation({ english: 'x', chunks: [] }, '你')).toThrow();
    expect(() => normalizeSegmentation({ english: '', chunks: [{ hanzi: '你' }] }, '你')).toThrow();
  });
});

describe('translateAndSegment', () => {
  it('still translates when the word-by-word breakdown fails (segmented: false, chunk-less stand-in)', async () => {
    const { client } = fakeClient({
      give_translation: [toolReply({ translation: 'Tomorrow we review first.' })],
      give_breakdown: [toolReply({}, 'max_tokens', 1500), toolReply({}, 'max_tokens', 3000)],
    });
    const r = await translateAndSegment('k', LONG, { client, sleep });
    expect(r.translation).toBe('Tomorrow we review first.');
    expect(r.segmented).toBe(false);
    expect(r.segmentation).toMatchObject({ hanzi: LONG, english: 'Tomorrow we review first.', chunks: [] });
  });

  it('uses the breakdown English when the translation call fails', async () => {
    const { client } = fakeClient({
      give_translation: [new Error('boom'), new Error('boom')],
      give_breakdown: [toolReply({ english: 'Hello', chunks: [{ hanzi: '你好', pinyin: 'nǐ hǎo', english: 'Hello' }] })],
    });
    const r = await translateAndSegment('k', '你好', { client, sleep });
    expect(r).toMatchObject({ translation: 'Hello', segmented: true });
  });

  it('skips the translation call when one is already stored', async () => {
    const { client, calls } = fakeClient({ give_breakdown: [toolReply({ english: 'Hello', chunks: [{ hanzi: '你好', english: 'Hello' }] })] });
    const r = await translateAndSegment('k', '你好', { client, sleep, knownTranslation: 'Hi' });
    expect(r.translation).toBe('Hi');
    expect(calls.map((c) => c.tool_choice.name)).toEqual(['give_breakdown']);
  });

  it('throws when neither half worked', async () => {
    const { client } = fakeClient({ give_translation: [new Error('a'), new Error('a')], give_breakdown: [new Error('b'), new Error('b')] });
    await expect(translateAndSegment('k', '你好', { client, sleep })).rejects.toBeTruthy();
  });
});
