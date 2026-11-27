/**
 * E2E_TEST_MODE only (and the unit tests): a stand-in for the model behind sentence_making's check and its
 * ✨ Show a fixed version (services/sentence-making.ts), so end-to-end tests and screenshots run the whole flow.
 * It knows Jerome's two real sentences (docs/STUDY_SESSION.md "Sentence making: an honest verdict"):
 * - 本来 + 要: 我本来要去健身馆，但是我学中文。 → needs_work (the second half doesn't follow), fixed as
 *   我本来要去健身房，可是后来去学中文了。;
 * - 不知道 + 有没有, said with pauses: 我不知道我妹妹有不有新电脑 (scrubbed) → needs_work on 不有 only, never the split;
 * - 角度 (从…的角度): 从我妈妈的角度来看我和我妹妹住在很远的地方 → needs_work for MEANING (the angle reveals no view of
 *   hers), a reason long enough to be cut on screen. Its fix only comes when the request says what's wrong (the
 *   check's problem in the turn, or the repair note): without it the stand-in does what both real models did in
 *   Nov 2026 — hands his sentence back with punctuation added (refused as "the same sentence").
 * anything with every target word is right, a target word missing is wrong.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { normalizeHanziAnswer } from '@shared/lesson/answer-check';

export const SENTENCE_FIXTURES: Array<{
  words: string[]; sentence: string; check: Record<string, unknown>; fix: Record<string, unknown>;
  /** Without being told the problem, the "fix" is this (his sentence re-punctuated). */
  naiveFix?: Record<string, unknown>;
}> = [
  {
    words: ['本来', '要'],
    sentence: '我本来要去健身馆，但是我学中文。',
    check: {
      grade: 'needs_work',
      headline: '本来…要 used right — the second half doesn’t follow',
      reason: '但是我学中文 states another plan; say what actually happened instead.',
      more: '健身馆 is usually 健身房.',
      fixable: true,
      uses_all_words: true,
    },
    fix: { hanzi: '我本来要去健身房，可是后来去学中文了。', pinyin: 'Wǒ běnlái yào qù jiànshēnfáng, kěshì hòulái qù xué Zhōngwén le.', english: 'I was going to go to the gym, but then I went to study Chinese.' },
  },
  {
    words: ['不知道', '有没有'],
    sentence: '我不知道我妹妹有不有新电脑',
    check: {
      grade: 'needs_work',
      headline: '不知道 used right — 有没有 came out as 有不有',
      reason: 'The yes-no question with 有 is 有没有, never 有不有.',
      fixable: true,
      uses_all_words: true,
    },
    fix: { hanzi: '我不知道我妹妹有没有新电脑', pinyin: 'Wǒ bù zhīdào wǒ mèimei yǒu méiyǒu xīn diànnǎo', english: 'I don’t know whether my younger sister has a new computer.' },
  },
  {
    words: ['角度'],
    sentence: '从我妈妈的角度来看我和我妹妹住在很远的地方',
    check: {
      grade: 'needs_work',
      headline: '从…的角度 used right — unclear what the angle reveals',
      reason: 'From your mother’s point of view should lead to what she thinks or feels, but 我和我妹妹住在很远的地方 only states where you live.',
      more: 'Add her view, e.g. 她觉得我们住得太远了.',
      fixable: true,
      uses_all_words: true,
    },
    naiveFix: { hanzi: '从我妈妈的角度来看，我和我妹妹住在很远的地方。', english: 'From my mother’s point of view, my sister and I live very far away.' },
    fix: { hanzi: '从我妈妈的角度来看，我和我妹妹住得太远了。', pinyin: 'Cóng wǒ māma de jiǎodù lái kàn, wǒ hé wǒ mèimei zhù de tài yuǎn le.', english: 'From my mum’s point of view, my sister and I live too far away.' },
  },
];

/** The problem the request carries: the check's line in the turn, or the repair note's (after "so the problem is gone: "). */
function problemOf(text: string, messages: Array<{ content: unknown }>): string {
  const line = lineValue(text, /What the check found wrong: (.+)/);
  if (line && !line.startsWith('(not given')) return line;
  const repair = JSON.stringify(messages.slice(1));
  return repair.match(/the problem is gone: (.+?)\. Keep their words/)?.[1] ?? '';
}

const lineValue = (text: string, re: RegExp) => (text.match(re)?.[1] ?? '').trim();
const key = (s: string) => normalizeHanziAnswer(s);

export function fakeSentenceMakingClient(): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: async (params: { messages: Array<{ content: unknown }>; tool_choice?: { name?: string } }) => {
        const text = String(params.messages[0]?.content ?? '');
        const words = lineValue(text, /Target words: (.+)/).split('、').map((w) => w.trim()).filter(Boolean);
        const sentence = lineValue(text, /The learner's sentence[^:]*: (.+)/);
        const fixture = SENTENCE_FIXTURES.find((f) => key(f.sentence) === key(sentence));
        const name = params.tool_choice?.name === 'fix_sentence' ? 'fix_sentence' : 'check_sentence';
        let input: Record<string, unknown>;
        if (name === 'fix_sentence') {
          input = fixture?.naiveFix && !problemOf(text, params.messages)
            ? fixture.naiveFix
            : fixture?.fix ?? { hanzi: `${sentence.replace(/[。.！!？?]+$/u, '')}了。`, english: '(fixed)' };
        } else if (fixture) {
          input = fixture.check;
        } else {
          const missing = words.filter((w) => !key(sentence).includes(key(w)));
          input = missing.length
            ? { grade: 'wrong', headline: `${missing[0]} is missing`, reason: 'Use every target word.', fixable: true, uses_all_words: false }
            : { grade: 'right', headline: 'Natural and correct', reason: 'Every target word fits naturally.', fixable: false, uses_all_words: true };
        }
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 400 + text.length, output_tokens: 60 },
          content: [{ type: 'tool_use', id: 'fake', name, input }],
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
