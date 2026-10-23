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

/** Jerome's "Annie" speaking task (docs/STUDY_SESSION.md "Claude checks your speaking"): a realistic transcript. */
export const SPEAKING_FIXTURE = {
  prompt: "A new colleague, Annie, arrives at your office. Guess who she is (① 就是…吧), tell her where two places are (② 就在), what today's meeting is about (③ 是关于…的), and how busy the team is (④ 形容词 + 到…).",
  transcript: '嗯，你好，你就是……sorry，你就是新来的Annie吧？欢迎欢迎！洗手间在……wait，洗手间就在电梯的旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动。我们团队最近忙到……忙到没有时间吃午饭了。',
  result: {
    verdict: 'acceptable',
    headline: 'All four parts are there — just close 是关于…的 with 的.',
    cleaned: '你好，你就是新来的Annie吧？欢迎欢迎！洗手间就在电梯的旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动。我们团队最近忙到没有时间吃午饭了。',
    corrected: '你好，你就是新来的Annie吧？欢迎欢迎！洗手间就在电梯旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动的。我们团队最近忙到没有时间吃午饭了。',
    parts: [
      { label: '① 就是…吧', status: 'used', note: '你就是新来的Annie吧 — a perfect friendly guess.' },
      { label: '② 就在', status: 'used', note: 'Two places: 洗手间就在… and 打印机就在….' },
      { label: '③ 是关于…的', status: 'used_with_issue', note: 'The closing 的 is missing.' },
      { label: '④ 形容词 + 到…', status: 'used', note: '忙到没有时间吃午饭 — great use.' },
    ],
    tips: [
      { text: '是关于…的 needs its closing 的: 是关于下个月的活动的 (shì guānyú xià ge yuè de huódòng de).', quote: '是关于下个月的活动', fix: '是关于下个月的活动的' },
      { text: 'With 旁边 the 的 is usually dropped: 电梯旁边 (diàntī pángbiān) sounds more natural.', quote: '电梯的旁边', fix: '电梯旁边' },
    ],
  },
};

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
        if (params.tool_choice?.name === 'check_speaking') {
          const said = lineValue(text, /Transcript of their recording[^:]*: (.+)/);
          const known = normalizeHanziAnswer(said) === normalizeHanziAnswer(SPEAKING_FIXTURE.transcript);
          const result = known ? SPEAKING_FIXTURE.result : {
            verdict: 'acceptable',
            headline: 'Clear and on task — nicely done.',
            cleaned: said.replace(/(sorry|wait|嗯)[，,]?/gi, ''),
            corrected: '',
            parts: [],
            tips: [],
          };
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 900 + text.length, output_tokens: 400 },
            content: [{ type: 'tool_use', id: 'fake', name: 'check_speaking', input: result }],
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
