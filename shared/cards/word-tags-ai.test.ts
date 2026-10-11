import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWordTagLexicon, wordTags } from './word-tags';
import {
  AI_WORD_TAG_NOTICE,
  cleanRegisterNote,
  estimateWordTagsCost,
  explainWordTag,
  mergeAiWordTags,
  parseAiWordTags,
  pickAiWordTags,
  visibleAiWordTags,
  wordTagsWithAi,
  type AiWordTags,
} from './word-tags-ai';

const lexicon = parseWordTagLexicon(readFileSync(join(__dirname, '..', 'data', 'word-tags', 'word-tags.txt'), 'utf8'));
const ai = (o: Partial<AiWordTags>): AiWordTags => ({ v: 1, confidence: 'high', ...o });
const show = (hanzi: string, verdict: AiWordTags | null) =>
  wordTagsWithAi(hanzi, lexicon, verdict).map((t) => `${t.ai ? '✨' : ''}${t.label}`);

describe('pickAiWordTags / parseAiWordTags', () => {
  it('keeps the known fields in a fixed order', () => {
    const v = pickAiWordTags({ confidence: 'medium', register_note: 'formal written', register: 'formal', separable: false, transitivity: 'transitive', v: 1 });
    expect(v).toEqual({ v: 1, transitivity: 'transitive', separable: false, register: 'formal', register_note: 'formal written', confidence: 'medium' });
    expect(Object.keys(v!)).toEqual(['v', 'transitivity', 'separable', 'register', 'register_note', 'confidence']);
  });

  it('drops unknown values and needs a confidence', () => {
    expect(pickAiWordTags({ transitivity: 'ditransitive', register: 'posh', separable: 'yes', confidence: 'high' })).toEqual({ v: 1, confidence: 'high' });
    expect(pickAiWordTags({ transitivity: 'transitive' })).toBeNull();
    expect(pickAiWordTags({ confidence: 'sure' })).toBeNull();
    expect(pickAiWordTags({ v: 0, confidence: 'high' })).toBeNull();
    expect(pickAiWordTags({ v: 1.5, confidence: 'high' })).toBeNull();
    expect(pickAiWordTags([])).toBeNull();
    expect(pickAiWordTags(null)).toBeNull();
  });

  it('cuts the register note to 60 characters, whitespace collapsed', () => {
    expect(cleanRegisterNote('  formal   written;\n in speech use 告诉 ')).toBe('formal written; in speech use 告诉');
    expect(cleanRegisterNote('x'.repeat(80))).toHaveLength(60);
    expect(cleanRegisterNote(42)).toBe('');
    expect(pickAiWordTags({ register_note: '   ', confidence: 'high' })).toEqual({ v: 1, confidence: 'high' });
  });

  it('parses stored JSON and survives junk', () => {
    expect(parseAiWordTags('{"v":1,"transitivity":"intransitive","confidence":"high"}')).toEqual({ v: 1, transitivity: 'intransitive', confidence: 'high' });
    expect(parseAiWordTags('not json')).toBeNull();
    expect(parseAiWordTags('')).toBeNull();
    expect(parseAiWordTags(null)).toBeNull();
    expect(parseAiWordTags({ confidence: 'low' })).toEqual({ v: 1, confidence: 'low' });
  });

  it('hides low confidence', () => {
    expect(visibleAiWordTags(ai({ confidence: 'low', transitivity: 'transitive' }))).toBeNull();
    expect(visibleAiWordTags(ai({ confidence: 'medium' }))).not.toBeNull();
    expect(show('告诉', ai({ confidence: 'low', transitivity: 'transitive', register: 'formal' }))).toEqual(show('告诉', null));
  });
});

describe('mergeAiWordTags', () => {
  it('adds transitivity to a verb, after the part of speech', () => {
    expect(show('告诉', ai({ transitivity: 'transitive' }))).toEqual(['Verb', '✨Takes an object', 'HSK 1', 'Trad. 告訴']);
    expect(show('休息', ai({ transitivity: 'intransitive' }))).toEqual(['Verb', '✨No object', 'HSK 1']);
    expect(show('吃', ai({ transitivity: 'both' }))).toEqual(['Verb', '✨Object optional', 'HSK 1']);
    expect(show('吃', ai({ transitivity: 'n/a' }))).toEqual(['Verb', 'HSK 1']);
  });

  it('puts transitivity after the lexicon’s separable pill', () => {
    expect(show('见面', ai({ transitivity: 'intransitive', separable: true }))).toEqual(['Verb', 'Separable verb', '✨No object', 'HSK 1', 'Trad. 見面']);
  });

  it('never gives a noun, an adjective or a sentence a transitivity', () => {
    expect(show('书', ai({ transitivity: 'transitive' }))).toEqual(show('书', null));
    expect(show('漂亮', ai({ transitivity: 'intransitive' }))).toEqual(show('漂亮', null));
    expect(show('我今天很忙。', ai({ transitivity: 'intransitive', separable: true }))).toEqual(show('我今天很忙。', null));
    expect(show('hello', ai({ transitivity: 'transitive' }))).toEqual([]);
  });

  it('a phrase the lexicon has no part of speech for may get one', () => {
    expect(show('喝咖啡', ai({ transitivity: 'n/a', register: 'neutral' }))).toEqual(['Phrase']);
    expect(show('看一下', ai({ transitivity: 'transitive', register: 'informal' }))).toEqual(['Phrase', '✨Takes an object', '✨Informal']);
  });

  it('an AI separable verb only when the lexicon has none', () => {
    expect(show('散步', ai({ separable: true }))).toEqual(show('散步', null));
    expect(show('休息', ai({ separable: true }))).toEqual(['Verb', '✨Separable verb', 'HSK 1']);
    expect(show('书', ai({ separable: true }))).toEqual(show('书', null));
    const merged = wordTagsWithAi('游泳', lexicon, ai({ separable: true }));
    expect(merged.some((t) => t.kind === 'separable')).toBe(true);
    expect(merged.filter((t) => t.kind === 'separable')).toHaveLength(1);
  });

  it('the lexicon’s register always wins', () => {
    expect(show('打扰', ai({ register: 'informal' }))).toEqual(show('打扰', null));
    expect(show('您', ai({ register: 'formal' }))).toEqual(show('您', null));
    expect(show('告诉', ai({ register: 'formal', register_note: 'x' }))).toEqual(['Verb', '✨Formal', 'HSK 1', 'Trad. 告訴']);
    expect(show('告诉', ai({ register: 'neutral' }))).toEqual(show('告诉', null));
  });

  it('a register for a sentence', () => {
    expect(show('您慢走。', null)).toEqual(['Polite']);
    expect(show('我今天很忙。', ai({ register: 'informal' }))).toEqual(['✨Informal']);
  });

  it('applies the exclude after merging; no lexicon → nothing', () => {
    expect(wordTagsWithAi('告诉', lexicon, ai({ transitivity: 'transitive' }), { exclude: ['transitivity'] }).map((t) => t.id)).toEqual(['pos:v', 'hsk', 'trad']);
    expect(wordTagsWithAi('告诉', null, ai({ transitivity: 'transitive' }))).toEqual([]);
    expect(mergeAiWordTags('告诉', wordTags('告诉', lexicon), null)).toEqual(wordTags('告诉', lexicon));
  });

  it('keeps a frequency rank where it was', () => {
    expect(wordTagsWithAi('告诉', lexicon, ai({ transitivity: 'transitive', register: 'formal' }), { rank: 300 }).map((t) => t.kind)).toEqual([
      'pos',
      'transitivity',
      'register',
      'hsk',
      'frequency',
      'trad',
    ]);
  });
});

describe('explainWordTag', () => {
  const verdict = ai({ transitivity: 'transitive', register: 'formal', register_note: 'formal written; in speech use 告诉', separable: true });
  const tags = wordTagsWithAi('通告', lexicon, verdict);

  it('says it is an AI suggestion, with the register note', () => {
    const reg = tags.find((t) => t.kind === 'register')!;
    const e = explainWordTag(reg, '通告', lexicon, verdict);
    expect(e).toMatchObject({ title: 'Formal', ai: true, note: 'formal written; in speech use 告诉' });
    expect(AI_WORD_TAG_NOTICE).toBe('Suggested by AI — may be wrong');
  });

  it('explains transitivity', () => {
    const t = wordTagsWithAi('告诉', lexicon, verdict).find((x) => x.kind === 'transitivity')!;
    const e = explainWordTag(t, '告诉', lexicon, verdict);
    expect(e.title).toBe('Takes an object');
    expect(e.ai).toBe(true);
    expect(e.example).toBe('我喜欢音乐。');
    expect(e.note).toBeUndefined();
  });

  it('leaves the lexicon’s pills alone', () => {
    const t = wordTags('告诉', lexicon)[0];
    expect(explainWordTag(t, '告诉', lexicon, verdict).ai).toBeUndefined();
  });
});

describe('estimateWordTagsCost', () => {
  it('is about a dollar and a half for 5.6k notes', () => {
    expect(estimateWordTagsCost(0)).toBe(0);
    const usd = estimateWordTagsCost(5600);
    expect(usd).toBeGreaterThan(0.8);
    expect(usd).toBeLessThan(2);
  });
});
