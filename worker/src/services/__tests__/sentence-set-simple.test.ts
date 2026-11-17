/**
 * Simple sentences, known words and the learner's lesson structures in the sentence generator
 * (services/sentence-set.ts; docs/STUDY_SESSION.md "Listen in context"), and its E2E stand-in.
 */
import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { generateSentenceSet, keepSimpleSentences, SENTENCE_SET_SYSTEM_PROMPT } from '../sentence-set';
import { simpleSentenceProblems } from '@shared/study/sentenceSimplicity';

const structures = [{
  name: '除了…还…', line: '除了 + [Noun] + ， + 还 + [Verb]', meaning: 'besides A, also B', example: null,
  fixed: ['除了', '还'], first_met: '2026-11-01', last_met: '2026-11-01', lessons: 1, practised: 2,
}];
const input = { hanzi: '银行', pinyin: 'yínháng', english: 'bank', knownWords: ['去', '取钱'], structures };
const reply = (toolInput: unknown) => ({
  stop_reason: 'tool_use',
  usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: 'tool_use', id: 't', name: 'create_sentence_set', input: toolInput }],
});
const fake = (replies: unknown[]) => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    messages: { create: async (params: Record<string, unknown>) => { calls.push(params); return replies.shift(); } },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
};
const noSleep = async () => {};

describe('simple sentences, known words and the learner\'s structures', () => {
  it('the prompt asks for short one-clause sentences from known words, using his structures where natural', async () => {
    expect(SENTENCE_SET_SYSTEM_PROMPT).toMatch(/6-14 Chinese characters/);
    expect(SENTENCE_SET_SYSTEM_PROMPT).toMatch(/One clause/);
    expect(SENTENCE_SET_SYSTEM_PROMPT).toMatch(/Never force a structure/);
    expect(SENTENCE_SET_SYSTEM_PROMPT).not.toMatch(/12-25 characters/);
    const { client, calls } = fake([reply({ sentences: [{ hanzi: '我去银行。', pinyin: 'Wǒ qù yínháng.', translation: 'I go to the bank.', focus: 'core' }] })]);
    await generateSentenceSet('k', input, 4, { client, sleep: noSleep });
    const user = JSON.stringify(calls[0].messages);
    expect(user).toContain('去、取钱');
    expect(user).toContain('除了…还… (除了 + [Noun] + ， + 还 + [Verb]) — besides A, also B');
    const tool = (calls[0].tools as Array<{ input_schema: { properties: { sentences: { items: { properties: Record<string, unknown> } } } } }>)[0];
    expect(Object.keys(tool.input_schema.properties.sentences.items.properties)).toContain('structure');
  });

  it('drops new sentences that are too long, have too many clauses or miss the word; checks the structure tag', async () => {
    const { client } = fake([reply({ sentences: [
      { hanzi: '我去银行。', translation: 'I go to the bank.', focus: 'core', structure: '除了…还…' },
      { hanzi: '虽然今天下雨，但是我们还是去银行办事了，因为很急。', translation: 'long', focus: 'complex' },
      { hanzi: '我去邮局。', translation: 'no word', focus: 'core' },
      { hanzi: '除了银行，我还去邮局。', translation: 'Besides the bank, I also go to the post office.', focus: 'core', structure: '除了…还…' },
    ] })]);
    const out = await generateSentenceSet('k', input, 4, { client, sleep: noSleep });
    expect(out.map((s) => [s.hanzi, s.structure])).toEqual([['我去银行。', null], ['除了银行，我还去邮局。', '除了…还…']]);
  });

  it('asks again when every sentence is too long', async () => {
    const long = { hanzi: '虽然今天下雨，但是我们还是去银行办事了，因为很急。', translation: 'long', focus: 'complex' };
    const { client, calls } = fake([reply({ sentences: [long] }), reply({ sentences: [{ hanzi: '银行关门了。', translation: 'The bank is closed.', focus: 'core' }] })]);
    const out = await generateSentenceSet('k', input, 4, { client, sleep: noSleep });
    expect(out.map((s) => s.hanzi)).toEqual(['银行关门了。']);
    expect(calls).toHaveLength(2);
  });

  it('keepSimpleSentences: the learner\'s own instructions win over the length limit', () => {
    const long = { hanzi: '虽然今天下雨，但是我们还是去银行办事了，因为很急。', pinyin: '', translation: '', focus: 'complex' as const, focusNote: null };
    expect(keepSimpleSentences([long], { hanzi: '银行' })).toEqual([]);
    expect(keepSimpleSentences([long], { hanzi: '银行', customPrompt: 'longer please' })).toHaveLength(1);
  });

  it('E2E stand-in: deterministic short sentences with the word, new ones each time, one using a structure', async () => {
    const first = await generateSentenceSet('k', input, 6, { fake: true });
    expect(first).toHaveLength(6);
    expect(first[0]).toMatchObject({ hanzi: '除了银行还。', structure: '除了…还…' });
    for (const s of first) {
      expect(s.hanzi).toContain('银行');
      expect(simpleSentenceProblems(s.hanzi, '银行')).toEqual([]);
    }
    expect(await generateSentenceSet('k', input, 6, { fake: true })).toEqual(first);
    const more = await generateSentenceSet('k', { ...input, existing: first.map((s) => s.hanzi) }, 4, { fake: true });
    expect(more.map((s) => s.hanzi)).toEqual(['银行在这儿。', '你的银行呢？', '今天没有银行。', '她也说银行。']);
  });
});
