import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  clampSentenceCount,
  normalizeGeneratedSentences,
  coerceSentenceArray,
  generateSentenceSet,
  SENTENCE_SET_DEFAULT_COUNT,
  SENTENCE_SET_MIN_COUNT,
  SENTENCE_SET_MAX_COUNT,
  sentenceAudioRetryDelay,
  SENTENCE_AUDIO_RETRY_DELAYS_S,
} from '../sentence-set';

describe('clampSentenceCount', () => {
  it('defaults when no count is given', () => {
    expect(clampSentenceCount(undefined)).toBe(SENTENCE_SET_DEFAULT_COUNT);
  });

  it('defaults on non-numeric input', () => {
    expect(clampSentenceCount(NaN)).toBe(SENTENCE_SET_DEFAULT_COUNT);
    expect(clampSentenceCount(0)).toBe(SENTENCE_SET_DEFAULT_COUNT);
  });

  it('clamps to the supported range', () => {
    expect(clampSentenceCount(1)).toBe(SENTENCE_SET_MIN_COUNT);
    expect(clampSentenceCount(50)).toBe(SENTENCE_SET_MAX_COUNT);
  });

  it('passes through in-range counts', () => {
    expect(clampSentenceCount(5)).toBe(5);
    expect(clampSentenceCount(10)).toBe(10);
  });

  it('rounds fractional counts', () => {
    expect(clampSentenceCount(6.4)).toBe(6);
  });
});

describe('normalizeGeneratedSentences', () => {
  it('keeps well-formed sentences in order', () => {
    const result = normalizeGeneratedSentences(
      [
        { hanzi: '我明白了。', pinyin: 'Wǒ míngbai le.', translation: 'I understand.', focus: 'core' },
        {
          hanzi: '明天我就明白了。',
          pinyin: 'Míngtiān wǒ jiù míngbai le.',
          translation: "Tomorrow I'll understand.",
          focus: 'shared_character',
          focus_note: '明天 shares 明 with 明白',
        },
      ],
      6
    );

    expect(result).toHaveLength(2);
    expect(result[0].focus).toBe('core');
    expect(result[1].focus).toBe('shared_character');
    expect(result[1].focusNote).toBe('明天 shares 明 with 明白');
  });

  it('drops entries with no hanzi', () => {
    const result = normalizeGeneratedSentences(
      [{ hanzi: '  ' }, { hanzi: '我懂。', focus: 'core' }, {}],
      6
    );
    expect(result).toHaveLength(1);
    expect(result[0].hanzi).toBe('我懂。');
  });

  it('coerces an unknown focus to core', () => {
    const result = normalizeGeneratedSentences([{ hanzi: '我懂。', focus: 'nonsense' }], 6);
    expect(result[0].focus).toBe('core');
  });

  it('never returns more sentences than requested', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ hanzi: `第${i}句。` }));
    expect(normalizeGeneratedSentences(raw, 5)).toHaveLength(5);
  });

  it('handles a missing sentences array', () => {
    expect(normalizeGeneratedSentences(undefined, 6)).toEqual([]);
  });

  it('normalizes whitespace and empty optional fields', () => {
    const result = normalizeGeneratedSentences(
      [{ hanzi: ' 我  明白 ', pinyin: '  ', translation: undefined }],
      6
    );
    expect(result[0].hanzi).toBe('我 明白');
    expect(result[0].pinyin).toBe('');
    expect(result[0].translation).toBe('');
    expect(result[0].focusNote).toBeNull();
  });
});

describe('sentenceAudioRetryDelay', () => {
  it('spaces retries out, then gives the row up to the sweep', () => {
    expect(sentenceAudioRetryDelay(1)).toBe(SENTENCE_AUDIO_RETRY_DELAYS_S[0]);
    expect(sentenceAudioRetryDelay(2)).toBe(SENTENCE_AUDIO_RETRY_DELAYS_S[1]);
    expect(sentenceAudioRetryDelay(3)).toBe(SENTENCE_AUDIO_RETRY_DELAYS_S[2]);
    expect(sentenceAudioRetryDelay(4)).toBeNull();
    expect(sentenceAudioRetryDelay(99)).toBeNull();
  });

  it('treats a missing or nonsense attempt as the first', () => {
    expect(sentenceAudioRetryDelay(0)).toBe(SENTENCE_AUDIO_RETRY_DELAYS_S[0]);
    expect(sentenceAudioRetryDelay(NaN)).toBe(SENTENCE_AUDIO_RETRY_DELAYS_S[0]);
  });
});

// Production, Oct 2026: about 1 in 25 replies carried `sentences` as a JSON
// STRING, and the set failed with "(raw || []).filter is not a function" —
// "Could not generate sentences" on the study card (曾).
describe('sentences in an unexpected shape', () => {
  const rows = [
    { hanzi: '他曾来过。', pinyin: 'Tā céng láiguo.', translation: 'He once came.', focus: 'core' },
    {
      hanzi: '我曾经去过北京。',
      pinyin: 'Wǒ céngjīng qùguo Běijīng.',
      translation: "I've been to Beijing.",
      focus: 'shared_character',
      focus_note: '曾经 shares 曾',
    },
  ];

  it('parses a stringified array', () => {
    expect(normalizeGeneratedSentences(JSON.stringify(rows), 6)).toHaveLength(2);
    expect(normalizeGeneratedSentences({ sentences: JSON.stringify(rows) }, 6)[1].focusNote).toBe(
      '曾经 shares 曾'
    );
  });

  it('parses a stringified wrapper, a fenced string and index-keyed objects', () => {
    expect(coerceSentenceArray(JSON.stringify({ sentences: rows }))).toHaveLength(2);
    expect(coerceSentenceArray('```json\n' + JSON.stringify(rows) + '\n```')).toHaveLength(2);
    expect(coerceSentenceArray({ 0: rows[0], 1: rows[1] })).toHaveLength(2);
  });

  it('never throws on junk', () => {
    for (const junk of ['not json', '[broken', 42, true, null, { sentences: 7 }, [null, 3, 'x']]) {
      expect(() => normalizeGeneratedSentences(junk, 6)).not.toThrow();
      expect(normalizeGeneratedSentences(junk, 6)).toEqual([]);
    }
  });
});

describe('generateSentenceSet', () => {
  const input = { hanzi: '曾', pinyin: 'céng', english: 'once, at some time in the past' };
  const reply = (toolInput: unknown) => ({
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'tool_use', id: 't', name: 'create_sentence_set', input: toolInput }],
  });
  const fake = (replies: unknown[]) => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          const next = replies.shift();
          if (next instanceof Error) throw next;
          return next;
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>;
    return { client, calls };
  };
  const row = {
    hanzi: '他曾在中国工作。',
    pinyin: 'Tā céng zài Zhōngguó gōngzuò.',
    translation: 'He once worked in China.',
    focus: 'core',
  };
  const noSleep = async () => {};

  it('accepts the sentences as a JSON string (the production failure)', async () => {
    const { client, calls } = fake([reply({ sentences: JSON.stringify([row]) })]);
    const out = await generateSentenceSet('k', input, 6, { client, sleep: noSleep });
    expect(out.map((s) => s.hanzi)).toEqual(['他曾在中国工作。']);
    expect(calls).toHaveLength(1);
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'create_sentence_set' });
  });

  it('retries an unusable reply instead of failing the set', async () => {
    const { client, calls } = fake([reply({ sentences: 'garbage' }), reply({ sentences: [row] })]);
    const out = await generateSentenceSet('k', input, 6, { client, sleep: noSleep });
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('throws a retryable error when every attempt fails', async () => {
    const { client } = fake([new Error('overloaded'), new Error('overloaded'), new Error('overloaded')]);
    await expect(generateSentenceSet('k', input, 6, { client, sleep: noSleep })).rejects.toMatchObject({
      retryable: true,
    });
  });
});
