/**
 * E2E_TEST_MODE only (and the unit tests): a stand-in for Haiku in the lesson answer check
 * (services/answer-check.ts), so end-to-end tests and screenshots exercise the whole flow. It
 * knows Jerome's three real answers (docs/STUDY_SESSION.md "Claude checks your answer") and
 * answers the way the check_answer / reply tools would; anything else is "correct" when it equals
 * the model answer and "acceptable" otherwise.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { normalizeHanziAnswer } from '@shared/lesson/answer-check';

export const ANSWER_CHECK_FIXTURES: Array<{ answer: string; model: string; english: string; result: Record<string, unknown> }> = [
  {
    english: "Even if it's cheap, I won't buy it.",
    model: '即使很便宜，我也不买。',
    answer: '即使便宜，我也不买。',
    result: {
      verdict: 'correct',
      headline: 'Correct and natural — 很 is optional here.',
      corrected: '',
      tips: [{ text: '很 is optional inside a 即使 clause; 即使再便宜 ("however cheap") is an idiomatic way to stress it.', quote: '即使便宜' }],
      alternative: { hanzi: '即使再便宜，我也不买。', english: 'However cheap it is, I won\'t buy it.' },
    },
  },
  {
    english: "Even if you don't remember these words, don't worry — just practise more.",
    model: '即使你不记得这些词，也别着急，多练习就好了。',
    answer: '即使你不记得这些词，也不着急，就多练习。',
    result: {
      verdict: 'almost',
      headline: 'The 即使…也 is right — make "don\'t worry" a command.',
      corrected: '即使你不记得这些词，也别着急，你就多练习吧。',
      tips: [
        { text: '也不着急 is a statement ("you\'re also not anxious"); a command needs 别 or 不要 → 也别着急.', quote: '也不着急' },
        { text: 'Bare 就多练习 sounds clipped — add a subject and 吧: 你就多练习吧.', quote: '就多练习' },
      ],
      alternative: { hanzi: '多练习就好了。', english: 'Just practise more and it\'ll be fine.' },
    },
  },
  {
    english: 'The doctor told me to take medicine and rest well.',
    model: '医生让我吃药，好好休息。',
    answer: '医生让我吃药和好好休息。',
    result: {
      verdict: 'almost',
      headline: '和 can\'t join two actions — use a comma.',
      corrected: '医生让我吃药，好好休息。',
      tips: [{ text: '和 links nouns (药和水), not two verb phrases — use a comma, or 并且 / 然后.', quote: '和' }],
    },
  },
];

function lineValue(text: string, label: RegExp): string {
  const m = text.match(label);
  return m ? m[1].trim() : '';
}

/** A fake Anthropic client for the check_answer and reply tools. */
export function fakeAnswerCheckClient(): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: async (params: { messages: Array<{ content: unknown }>; tool_choice?: { name?: string } }) => {
        const text = String(params.messages[0]?.content ?? '');
        if (params.tool_choice?.name === 'reply') {
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 300 + text.length, output_tokens: 40 },
            content: [{ type: 'tool_use', id: 'fake', name: 'reply', input: { text: '别 makes it a command ("don\'t…"); 不 only describes. So 也别着急 tells them not to worry, while 也不着急 says they aren\'t worried.' } }],
          };
        }
        const answer = lineValue(text, /Learner's answer[^:]*: (.+)/);
        const model = lineValue(text, /Model answer: ([^(\n]+)/);
        const known = ANSWER_CHECK_FIXTURES.find((f) => normalizeHanziAnswer(f.answer) === normalizeHanziAnswer(answer));
        const result = known?.result ?? (normalizeHanziAnswer(answer) === normalizeHanziAnswer(model)
          ? { verdict: 'correct', headline: 'Correct — exactly the model answer.', corrected: '', tips: [] }
          : { verdict: 'acceptable', headline: 'Different wording, same meaning — that works.', corrected: '', tips: [] });
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 600 + text.length, output_tokens: 120 },
          content: [{ type: 'tool_use', id: 'fake', name: 'check_answer', input: result }],
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
