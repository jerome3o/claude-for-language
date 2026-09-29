import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  BRIEF_EXPLAIN_MODEL,
  explainSentenceBriefly,
  normalizeBriefExplanation,
  parseClientBriefExplanation,
  toCoachBreakdown,
} from '../sentence-explain-brief';

function fakeClient(replies: Array<Record<string, unknown> | Error>) {
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
  content: [{ type: 'tool_use', id: 't', name: 'explain_sentence', input }],
});

const good = {
  translation: 'I went to the shop yesterday to buy apples.',
  words: [
    { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
    { hanzi: '昨天', pinyin: 'zuótiān', gloss: 'yesterday' },
    { hanzi: '去了', pinyin: 'qù le', gloss: 'went' },
    { hanzi: '商店', pinyin: 'shāngdiàn', gloss: 'shop' },
    { hanzi: '买', pinyin: 'mǎi', gloss: 'buy' },
    { hanzi: '苹果', pinyin: 'píngguǒ', gloss: 'apples' },
  ],
  construction: 'Time word before the verb; 去 + place + verb says what you went there to do.',
};

describe('explainSentenceBriefly (structuredCall)', () => {
  it('forces the tool on Haiku with thinking off and returns the translation + words', async () => {
    const { client, calls } = fakeClient([toolReply(good)]);
    const r = await explainSentenceBriefly('k', { hanzi: '我昨天去了商店买苹果' }, { client, sleep: async () => {} });
    expect(r.translation).toBe(good.translation);
    expect(r.words.map((w) => w.hanzi)).toEqual(['我', '昨天', '去了', '商店', '买', '苹果']);
    expect(calls[0]).toMatchObject({
      model: BRIEF_EXPLAIN_MODEL,
      thinking: { type: 'disabled' },
      tool_choice: { type: 'tool', name: 'explain_sentence' },
    });
    expect(calls[0].tools[0].input_schema.required).toContain('translation');
  });

  it('retries a reply with no words, on the same fast model', async () => {
    const { client, calls } = fakeClient([toolReply({ words: [], construction: '' }), toolReply(good)]);
    const r = await explainSentenceBriefly('k', { hanzi: '我昨天去了商店买苹果' }, { client, sleep: async () => {} });
    expect(r.words).toHaveLength(6);
    expect(calls.map((c) => c.model)).toEqual([BRIEF_EXPLAIN_MODEL, BRIEF_EXPLAIN_MODEL]);
  });

  it('retries a cut-off reply with a bigger budget', async () => {
    const { client, calls } = fakeClient([toolReply(good, 'max_tokens'), toolReply(good)]);
    await explainSentenceBriefly('k', { hanzi: '我' }, { client, sleep: async () => {} });
    expect(calls.map((c) => c.max_tokens)).toEqual([1200, 2400]);
  });
});

describe('normalizeBriefExplanation', () => {
  it('trims, drops empty words and falls back to the supplied translation', () => {
    const r = normalizeBriefExplanation(
      { words: [{ hanzi: ' 你 ', pinyin: 'nǐ ', gloss: ' you' }, { hanzi: '  ' }], construction: ' x ' },
      { translation: 'You.' },
    );
    expect(r).toEqual({ words: [{ hanzi: '你', pinyin: 'nǐ', gloss: 'you' }], construction: 'x', translation: 'You.' });
  });

  it('leaves the translation out when there is none (older shape)', () => {
    expect(normalizeBriefExplanation({ words: [{ hanzi: '你' }] })).toEqual({
      words: [{ hanzi: '你', pinyin: '', gloss: '' }],
      construction: '',
    });
  });

  it('throws on no words so the call is retried', () => {
    expect(() => normalizeBriefExplanation({ words: [] })).toThrow();
    expect(() => normalizeBriefExplanation(null)).toThrow();
  });
});

describe('parseClientBriefExplanation (a breakdown the device had cached)', () => {
  it('accepts a full breakdown', () => {
    expect(parseClientBriefExplanation(good)?.words).toHaveLength(6);
  });

  it('rejects junk and a cached breakdown without a translation line', () => {
    expect(parseClientBriefExplanation('nope')).toBeNull();
    expect(parseClientBriefExplanation({ words: [] })).toBeNull();
    expect(parseClientBriefExplanation({ words: good.words, construction: 'x' })).toBeNull();
  });
});

describe('toCoachBreakdown', () => {
  it('keeps the sentence and joins the word pinyin', () => {
    const b = toCoachBreakdown('我昨天去了商店买苹果', normalizeBriefExplanation(good));
    expect(b.hanzi).toBe('我昨天去了商店买苹果');
    expect(b.pinyin).toBe('wǒ zuótiān qù le shāngdiàn mǎi píngguǒ');
    expect(b.translation).toBe(good.translation);
  });
});
