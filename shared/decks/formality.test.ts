import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWordTagLexicon } from '../cards/word-tags';
import type { AiWordTags } from '../cards/word-tags-ai';
import {
  FORMALITY_EVERYDAY,
  FORMALITY_FORMAL,
  FORMALITY_NEUTRAL,
  lexiconFormality,
  noteFormality,
  noteFormalityMap,
} from './formality';
import { checkPerfBudgets, fastestTimes } from '../testing/perf';

const lexicon = parseWordTagLexicon(readFileSync(join(__dirname, '../data/word-tags/word-tags.txt'), 'utf8'));
const ai = (o: Partial<AiWordTags>): AiWordTags => ({ v: 2, confidence: 'high', ...o });

describe('lexiconFormality', () => {
  it('formal / literary → formal, rude / derogatory → neutral, colloquial / informal / slang → everyday, else nothing', () => {
    expect(lexiconFormality(['F'])).toBe(FORMALITY_FORMAL);
    expect(lexiconFormality(['P', 'F'])).toBe(FORMALITY_FORMAL);
    expect(lexiconFormality(['L'])).toBe(FORMALITY_FORMAL);
    expect(lexiconFormality(['S', 'R'])).toBe(FORMALITY_NEUTRAL);
    expect(lexiconFormality(['C'])).toBe(FORMALITY_EVERYDAY);
    expect(lexiconFormality(['I', 'G'])).toBe(FORMALITY_EVERYDAY);
    expect(lexiconFormality(['S'])).toBe(FORMALITY_EVERYDAY);
    expect(lexiconFormality(['P'])).toBeNull();
    expect(lexiconFormality([])).toBeNull();
  });
});

describe('noteFormality (shipped lexicon)', () => {
  it('reads the lexicon register', () => {
    expect(noteFormality('抵达', lexicon, null)).toBe(FORMALITY_FORMAL); // F
    expect(noteFormality('用餐', lexicon, null)).toBe(FORMALITY_FORMAL); // F
    expect(noteFormality('搞定', lexicon, null)).toBe(FORMALITY_EVERYDAY); // C
    expect(noteFormality('咱们', lexicon, null)).toBe(FORMALITY_EVERYDAY); // C
    expect(noteFormality('牛逼', lexicon, null)).toBe(FORMALITY_NEUTRAL); // slang + rude: never pushed forward
    expect(noteFormality('买', lexicon, null)).toBe(FORMALITY_NEUTRAL);
  });

  it('the AI verdict where the lexicon says nothing: register, then Everyday speech; low confidence ignored', () => {
    expect(noteFormality('告知', lexicon, ai({ register: 'formal', register_note: 'formal written; in speech use 告诉' }))).toBe(FORMALITY_FORMAL);
    expect(noteFormality('购置', lexicon, ai({ register: 'literary' }))).toBe(FORMALITY_FORMAL);
    expect(noteFormality('告知', lexicon, ai({ register: 'formal', confidence: 'low' }))).toBe(FORMALITY_NEUTRAL);
    expect(noteFormality('结账', lexicon, ai({ register: 'neutral', spoken: 'everyday', spoken_confidence: 'high' }))).toBe(FORMALITY_EVERYDAY);
    expect(noteFormality('结账', lexicon, ai({ spoken: 'everyday', spoken_confidence: 'medium' }))).toBe(FORMALITY_NEUTRAL);
    // Everyday speech is about speech, not the register's confidence.
    expect(noteFormality('结账', lexicon, ai({ confidence: 'low', spoken: 'everyday', spoken_confidence: 'high' }))).toBe(FORMALITY_EVERYDAY);
    expect(noteFormality('买', lexicon, ai({ register: 'informal' }))).toBe(FORMALITY_EVERYDAY);
    expect(noteFormality('买', lexicon, ai({ register: 'slang' }))).toBe(FORMALITY_EVERYDAY);
    expect(noteFormality('买', lexicon, ai({ register: 'rude', spoken: 'everyday', spoken_confidence: 'high' }))).toBe(FORMALITY_NEUTRAL);
    // A formal register wins over Everyday speech.
    expect(noteFormality('告知', lexicon, ai({ register: 'formal', spoken: 'everyday', spoken_confidence: 'high' }))).toBe(FORMALITY_FORMAL);
    expect(noteFormality('买', lexicon, ai({ register: 'polite' }))).toBe(FORMALITY_NEUTRAL);
  });

  it('the lexicon wins where both speak (as the word-tag pills)', () => {
    expect(noteFormality('搞定', lexicon, ai({ register: 'formal' }))).toBe(FORMALITY_EVERYDAY);
    expect(noteFormality('抵达', lexicon, ai({ spoken: 'everyday', spoken_confidence: 'high' }))).toBe(FORMALITY_FORMAL);
    // 您 is Polite in the lexicon: its register is the lexicon's, the AI register is not consulted…
    expect(noteFormality('您', lexicon, ai({ register: 'formal' }))).toBe(FORMALITY_NEUTRAL);
    // …but Everyday speech still counts (Polite says nothing about formality).
    expect(noteFormality('不好意思', lexicon, ai({ spoken: 'everyday', spoken_confidence: 'high' }))).toBe(FORMALITY_EVERYDAY);
  });

  it('sentences and long phrases are neutral; no lexicon → neutral', () => {
    expect(noteFormality('咱们走吧。', lexicon, ai({ register: 'informal' }))).toBe(FORMALITY_NEUTRAL);
    expect(noteFormality('咱们一起去吃饭', lexicon, null)).toBe(FORMALITY_NEUTRAL); // 7 characters
    expect(noteFormality('搞定', null, null)).toBe(FORMALITY_NEUTRAL);
    expect(noteFormality('', lexicon, null)).toBe(FORMALITY_NEUTRAL);
  });
});

describe('noteFormalityMap', () => {
  it('lists only the notes that are not neutral, parsing stored AI tags', () => {
    const map = noteFormalityMap([
      { id: 'a', hanzi: '抵达' },
      { id: 'b', hanzi: '告知', word_tags: JSON.stringify(ai({ register: 'formal' })) },
      { id: 'c', hanzi: '搞定', word_tags: 'not json' },
      { id: 'd', hanzi: '买' },
      { id: 'e', hanzi: '结账', word_tags: { v: 2, spoken: 'everyday', spoken_confidence: 'high', confidence: 'high' } },
      { id: 'f', hanzi: null },
    ], lexicon);
    expect([...map]).toEqual([['a', 2], ['b', 2], ['c', 0], ['e', 0]]);
    expect(noteFormalityMap([{ id: 'a', hanzi: '抵达' }], null).size).toBe(0);
  });

  it('maps 10k notes in a few ms (built on every queue build)', () => {
    const words = [...lexicon.words.keys()].filter(w => [...w].length >= 2 && [...w].length <= 4);
    const tags = JSON.stringify(ai({ register: 'formal' }));
    const notes = Array.from({ length: 10_000 }, (_, i) => ({ id: `n${i}`, hanzi: words[(i * 7919) % words.length], word_tags: i % 2 ? tags : null }));
    const [ms] = fastestTimes([() => noteFormalityMap(notes, lexicon)]);
    console.log(`noteFormalityMap, 10k notes: ${ms.toFixed(1)} ms`);
    if (checkPerfBudgets()) expect(ms).toBeLessThan(100);
  });
});
