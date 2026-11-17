/**
 * The E2E stand-in for sentence-set generation (E2E_TEST_MODE: no model call — CLAUDE.md "E2E is
 * hermetic"): top-ups and the generate route ("+ More sentences"); a note's first background set is not made
 * in E2E (specs stub GET /api/notes/:id/sentences and expect the device to have none). Deterministic SHORT sentences around the word, each new one not already in `existing`, so a
 * top-up really adds sentences; with a structure listed, one sentence uses the first one (除了…还…-style:
 * its fixed words around the word) and is tagged with it.
 */
import type { GeneratedSentence, SentenceSetInput } from './sentence-set';

const TEMPLATES: Array<[string, string]> = [
  ['我有{w}。', 'I have {e}.'],
  ['{w}很好。', '{e} is good.'],
  ['这是{w}吗？', 'Is this {e}?'],
  ['我想要{w}。', 'I want {e}.'],
  ['他喜欢{w}。', 'He likes {e}.'],
  ['{w}在这儿。', '{e} is here.'],
  ['你的{w}呢？', 'What about your {e}?'],
  ['今天没有{w}。', 'There is no {e} today.'],
  ['她也说{w}。', 'She says {e} too.'],
  ['我们去看{w}。', "Let's go and see {e}."],
  ['老师问{w}。', 'The teacher asks about {e}.'],
  ['{w}太多了。', 'Too much {e}.'],
  ['我又听到{w}了。', 'I heard {e} again.'],
  ['妈妈也要{w}。', 'Mum wants {e} too.'],
  ['明天再说{w}。', "Let's talk about {e} tomorrow."],
  ['{w}，我知道。', 'I know {e}.'],
];

export function fakeSentenceSet(input: SentenceSetInput, count: number): GeneratedSentence[] {
  const word = input.hanzi.replace(/[。！？!?.，,\s]+$/u, '');
  const english = (input.english || word).split(/[;；,]/)[0].trim() || word;
  const existing = new Set((input.existing || []).map((s) => s.trim()));
  const out: GeneratedSentence[] = [];
  const structure = (input.structures || []).find((s) => s.fixed.length >= 1);
  if (structure) {
    const hanzi = `${structure.fixed[0]}${word}${structure.fixed.slice(1).join('')}。`;
    if (!existing.has(hanzi)) {
      out.push({ hanzi, pinyin: '', translation: `(${structure.name}) ${english}.`, focus: 'core', focusNote: null, structure: structure.name });
      existing.add(hanzi);
    }
  }
  for (let round = 0; out.length < count && round < 4; round++) {
    for (const [zh, en] of TEMPLATES) {
      if (out.length >= count) break;
      const hanzi = (round === 0 ? zh : `${'又'.repeat(round)}${zh}`).replace('{w}', word);
      if (existing.has(hanzi)) continue;
      existing.add(hanzi);
      out.push({
        hanzi,
        pinyin: '',
        translation: en.replace('{e}', english),
        focus: out.length === 0 ? 'collocation' : 'core',
        focusNote: out.length === 0 ? `${word} in a short everyday sentence` : null,
        structure: null,
      });
    }
  }
  return out.slice(0, count);
}
