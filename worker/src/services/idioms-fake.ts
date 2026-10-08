/**
 * E2E_TEST_MODE only: a stand-in for Claude in the idiom generator (services/idioms.ts), so the
 * end-to-end tests and screenshots exercise the whole flow. 画蛇添足 gets the hand-written
 * sample (shared/idioms/sample.ts); 画蛇添脚 is "not an idiom — did you mean 画蛇添足?"; any other
 * request gets a short generic entry built from the starter list. Slow enough (1.2 s) that the
 * page shows "Claude is writing…" first.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { SAMPLE_IDIOM_ENTRY, starterIdiom } from '@shared/idioms';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function genericEntry(hanzi: string): Record<string, unknown> {
  const s = starterIdiom(hanzi);
  const chars = Array.from(hanzi);
  const pinyin = s?.pinyin ?? chars.map(() => 'zì').join(' ');
  return {
    is_idiom: true,
    hanzi,
    pinyin,
    literal: chars.map((c, i) => ({ hanzi: c, pinyin: pinyin.split(' ')[i] ?? '', gloss: `(E2E) ${c}` })),
    literal_english: '(E2E) literal meaning',
    meaning: s?.english ?? '(E2E) the figurative meaning',
    explanation_zh: '这是一个常用的成语。',
    explanation_pinyin: 'zhè shì yí gè chángyòng de chéngyǔ.',
    origin: {
      kind: 'uncertain',
      source: '',
      era: '',
      summary: '(E2E) Where it comes from.',
      story: [{ hanzi: '很久以前，有一个故事。', pinyin: 'hěn jiǔ yǐqián, yǒu yí gè gùshi.', english: '(E2E) Long ago there was a story.' }],
      note: '',
    },
    usage: {
      roles: ['谓语'],
      register: 'both',
      sentiment: 'neutral',
      note: '(E2E) How it is used.',
      collocations: [],
      examples: [
        { hanzi: `他说这是${hanzi}。`, pinyin: `tā shuō zhè shì ${pinyin}.`, english: '(E2E) He said so.' },
        { hanzi: `我觉得${hanzi}。`, pinyin: `wǒ juéde ${pinyin}.`, english: '(E2E) I think so.' },
      ],
      mistake: '(E2E) The common mistake.',
    },
    synonyms: [],
    antonyms: [],
    quiz: [{ kind: 'meaning', prompt: `${hanzi} means…`, options: [s?.english ?? '(E2E) right', '(E2E) wrong'], answer: 0, explanation: '(E2E)' }],
    confidence: 'medium',
    confidence_note: '(E2E) A stand-in entry.',
  };
}

export function fakeIdiomClient(): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: async (params: { messages: Array<{ content: unknown }> }) => {
        await sleep(1200);
        const text = String(params.messages[0]?.content ?? '');
        const hanzi = text.match(/Write the entry for: (\S+)/)?.[1] ?? '';
        const input =
          hanzi === '画蛇添足'
            ? { is_idiom: true, ...SAMPLE_IDIOM_ENTRY }
            : hanzi === '画蛇添脚'
              ? { is_idiom: false, not_idiom_reason: 'This is not a set expression.', did_you_mean: '画蛇添足' }
              : genericEntry(hanzi);
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 2500, output_tokens: 1800 },
          content: [{ type: 'tool_use', id: 'fake', name: 'write_idiom_entry', input }],
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
