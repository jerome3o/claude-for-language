import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { checkMadeSentence, normalizeSentenceFeedback } from '../sentence-making';

function fakeClient(inputs: unknown[]) {
  const calls: Array<Record<string, any>> = [];
  const client = {
    messages: {
      create: async (params: Record<string, any>) => {
        calls.push(params);
        const input = inputs.shift();
        return { stop_reason: 'tool_use', usage: { output_tokens: 5 }, content: [{ type: 'tool_use', id: 't', name: 'check_sentence', input }] };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const input = { words: ['因为', '所以'], task: 'Why were you late?', sentence: '因为堵车，所以我迟到了。' };

describe('sentence making feedback', () => {
  it('forces the tool with thinking off and passes words + task', async () => {
    const { client, calls } = fakeClient([{ verdict: 'correct', uses_all_words: true, comment: 'Natural and correct.' }]);
    const fb = await checkMadeSentence('k', input, client);
    expect(fb).toEqual({ verdict: 'correct', uses_all_words: true, corrected: undefined, comment: 'Natural and correct.' });
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'check_sentence' });
    expect(calls[0].messages[0].content).toContain('因为、所以');
    expect(calls[0].messages[0].content).toContain('Why were you late?');
  });

  it('never reports a missing word as used', () => {
    const fb = normalizeSentenceFeedback(
      { verdict: 'minor', uses_all_words: true, comment: 'Add 所以.', corrected: { hanzi: '因为堵车，所以我迟到了。', pinyin: 'yīnwèi dǔchē, suǒyǐ wǒ chídào le', english: 'x' } },
      { ...input, sentence: '因为堵车我迟到了。' },
    );
    expect(fb.uses_all_words).toBe(false);
    expect(fb.corrected?.hanzi).toBe('因为堵车，所以我迟到了。');
  });

  it('rejects a reply without a verdict (retried by structuredCall)', () => {
    expect(() => normalizeSentenceFeedback({ comment: 'hm' }, input)).toThrow();
  });
});
