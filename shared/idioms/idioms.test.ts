import { describe, expect, it } from 'vitest';
import { applyYiBuToneChanges, pinyinSyllables } from '../pinyin/toneChange';
import { cardTextProblems } from '../cards/standard';
import {
  SAMPLE_IDIOM_ENTRY,
  STARTER_IDIOMS,
  checkIdiomEntry,
  idiomCardFields,
  idiomKeyProblem,
  idiomOriginLine,
  idiomQuizScoreLine,
  isIdiomShaped,
  isStarterIdiom,
  normalizeIdiomHanzi,
  showIdiomLink,
  validateIdiomGeneration,
  IdiomValidationError,
} from './index';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('starter list', () => {
  it('has about forty idioms, each four Han characters, all unique', () => {
    expect(STARTER_IDIOMS.length).toBeGreaterThanOrEqual(40);
    const seen = new Set<string>();
    for (const s of STARTER_IDIOMS) {
      expect(isIdiomShaped(s.hanzi), s.hanzi).toBe(true);
      expect(seen.has(s.hanzi), `duplicate ${s.hanzi}`).toBe(false);
      seen.add(s.hanzi);
      expect(normalizeIdiomHanzi(s.hanzi)).toBe(s.hanzi);
      expect(s.english.length).toBeGreaterThan(3);
    }
  });

  it('writes one syllable per character with the 一 / 不 tone changes (card standard)', () => {
    for (const s of STARTER_IDIOMS) {
      expect(pinyinSyllables(s.pinyin)?.length, s.hanzi).toBe(4);
      expect(applyYiBuToneChanges(s.hanzi, s.pinyin), s.hanzi).toBe(s.pinyin);
      expect(cardTextProblems({ hanzi: s.hanzi, pinyin: s.pinyin })).toEqual([]);
    }
  });

  it('knows its members', () => {
    expect(isStarterIdiom('画蛇添足')).toBe(true);
    expect(isStarterIdiom('银行')).toBe(false);
  });
});

describe('normalizeIdiomHanzi / idiomKeyProblem', () => {
  it('strips spaces, punctuation and brackets, NFKC, traditional → simplified', () => {
    expect(normalizeIdiomHanzi(' 《画蛇添足》 ')).toBe('画蛇添足');
    expect(normalizeIdiomHanzi('画 蛇 添 足。')).toBe('画蛇添足');
    expect(normalizeIdiomHanzi('畫蛇添足')).toBe('画蛇添足');
  });

  it('explains what can not be looked up', () => {
    expect(idiomKeyProblem('')).toMatch(/Chinese characters/);
    expect(idiomKeyProblem('hua she')).toMatch(/Chinese characters only/);
    expect(idiomKeyProblem('银行')).toMatch(/at least 3/);
    expect(idiomKeyProblem('一二三四五六七八九十一二三')).toMatch(/longer/);
    expect(idiomKeyProblem('画蛇添足')).toBeNull();
    expect(idiomKeyProblem('不入虎穴焉得虎子')).toBeNull();
  });
});

describe('showIdiomLink', () => {
  it('needs four Han characters and a reason', () => {
    expect(showIdiomLink('画蛇添足')).toBe(true); // starter
    expect(showIdiomLink('多此一举')).toBe(false);
    expect(showIdiomLink('多此一举', { known: true })).toBe(true);
    expect(showIdiomLink('多此一举', { senses: ['to do something superfluous (idiom)'] })).toBe(true);
    expect(showIdiomLink('图书馆员', { senses: ['librarian'] })).toBe(false);
    expect(showIdiomLink('银行', { known: true })).toBe(false);
  });
});

describe('checkIdiomEntry', () => {
  it('accepts the sample unchanged (its pinyin already follows the card standard)', () => {
    const { entry, problems } = checkIdiomEntry(SAMPLE_IDIOM_ENTRY, '画蛇添足');
    expect(problems).toEqual([]);
    expect(entry).toEqual(SAMPLE_IDIOM_ENTRY);
  });

  it('applies the 一 / 不 tone changes and lines the literal row up with the syllables', () => {
    const raw = clone(SAMPLE_IDIOM_ENTRY) as unknown as Record<string, any>;
    raw.hanzi = '一举两得';
    raw.pinyin = 'yī jǔ liǎng dé';
    raw.literal = [
      { hanzi: '一', pinyin: 'yī', gloss: 'one' },
      { hanzi: '举', pinyin: 'jǔ', gloss: 'act' },
      { hanzi: '两', pinyin: 'liǎng', gloss: 'two' },
      { hanzi: '得', pinyin: 'dé', gloss: 'gain' },
    ];
    raw.usage.examples = [
      { hanzi: '骑车上班一举两得。', pinyin: 'qí chē shàngbān yī jǔ liǎng dé.', english: 'Cycling to work kills two birds with one stone.' },
      { hanzi: '这样做一举两得，不是很好吗？', pinyin: 'zhèyàng zuò yī jǔ liǎng dé, bù shì hěn hǎo ma?', english: 'Doing it this way gains two things — isn’t that great?' },
    ];
    const { entry, problems } = checkIdiomEntry(raw, '一举两得');
    expect(problems).toEqual([]);
    expect(entry!.pinyin).toBe('yì jǔ liǎng dé');
    expect(entry!.literal.map((c) => c.pinyin)).toEqual(['yì', 'jǔ', 'liǎng', 'dé']);
    expect(entry!.usage.examples[1].pinyin).toBe('zhèyàng zuò yì jǔ liǎng dé, bú shì hěn hǎo ma?');
  });

  it('drops examples without the idiom or with brackets, and refuses when too few are left', () => {
    const raw = clone(SAMPLE_IDIOM_ENTRY) as unknown as Record<string, any>;
    raw.usage.examples = [
      raw.usage.examples[0],
      { hanzi: '他（又）画蛇添足了。', pinyin: 'tā yòu huà shé tiān zú le.', english: 'He overdid it again.' },
      { hanzi: '别多此一举。', pinyin: 'bié duō cǐ yì jǔ.', english: 'Don’t overdo it.' },
    ];
    const { entry, problems } = checkIdiomEntry(raw, '画蛇添足');
    expect(entry).toBeNull();
    expect(problems.join(' ')).toMatch(/usage\.examples/);
  });

  it('drops broken quiz questions and self / duplicate references', () => {
    const raw = clone(SAMPLE_IDIOM_ENTRY) as unknown as Record<string, any>;
    raw.quiz.push({ kind: 'meaning', prompt: 'x', options: ['a', 'a'], answer: 0, explanation: '' });
    raw.quiz.push({ kind: 'meaning', prompt: 'x', options: ['a', 'b'], answer: 5, explanation: '' });
    raw.synonyms.push({ hanzi: '画蛇添足', pinyin: '', english: '' }, { hanzi: '多此一举', pinyin: '', english: '' });
    const { entry } = checkIdiomEntry(raw, '画蛇添足');
    expect(entry!.quiz).toHaveLength(2);
    expect(entry!.synonyms.map((s) => s.hanzi)).toEqual(['多此一举']);
  });

  it('keeps an uncertain origin honest: a note even when the model gave none', () => {
    const raw = clone(SAMPLE_IDIOM_ENTRY) as unknown as Record<string, any>;
    raw.origin = { kind: 'uncertain', source: null, era: null, summary: 'Nobody is sure where it comes from.', story: [], note: '' };
    const { entry } = checkIdiomEntry(raw, '画蛇添足');
    expect(entry!.origin.note).toMatch(/uncertain/);
    expect(idiomOriginLine(entry!)).toBe('Origin uncertain: Nobody is sure where it comes from.');
  });

  it('needs a story for a classical idiom', () => {
    const raw = clone(SAMPLE_IDIOM_ENTRY) as unknown as Record<string, any>;
    raw.origin.story = [];
    expect(checkIdiomEntry(raw, '画蛇添足').problems.join(' ')).toMatch(/origin\.story/);
  });
});

describe('validateIdiomGeneration', () => {
  it('returns the entry', () => {
    const g = validateIdiomGeneration({ is_idiom: true, ...SAMPLE_IDIOM_ENTRY }, '画蛇添足');
    expect(g.kind).toBe('idiom');
  });

  it('says not an idiom, with the idiom it probably meant', () => {
    expect(validateIdiomGeneration({ is_idiom: false, not_idiom_reason: 'Not a fixed expression.', did_you_mean: '画蛇添足' }, '画蛇添脚')).toEqual({
      kind: 'not_idiom',
      reason: 'Not a fixed expression.',
      suggestion: '画蛇添足',
    });
    // The model wrote up the corrected idiom instead of answering is_idiom: false.
    const g = validateIdiomGeneration({ is_idiom: true, ...SAMPLE_IDIOM_ENTRY }, '画蛇添脚');
    expect(g).toMatchObject({ kind: 'not_idiom', suggestion: '画蛇添足' });
  });

  it('throws the problem list on a broken entry (so the call is retried)', () => {
    expect(() => validateIdiomGeneration({ is_idiom: true, hanzi: '画蛇添足' }, '画蛇添足')).toThrow(IdiomValidationError);
  });
});

describe('idiomCardFields', () => {
  it('builds a card-standard card: literal breakdown, meaning, origin, usage, mistake; easiest example as the sentence', () => {
    const card = idiomCardFields(SAMPLE_IDIOM_ENTRY);
    expect(card.hanzi).toBe('画蛇添足');
    expect(card.english).toBe(SAMPLE_IDIOM_ENTRY.meaning);
    expect(card.fun_facts.split('\n')[0]).toBe('画 (huà) draw · 蛇 (shé) snake · 添 (tiān) add · 足 (zú) foot, feet — literally “draw a snake and add feet to it”.');
    expect(card.fun_facts).toContain('Origin: 《战国策·齐策二》, 战国 (Warring States) — In a snake-drawing race');
    expect(card.fun_facts).toContain('Usage: 谓语 (predicate), 宾语 (object) · 贬义 (critical) · written and spoken');
    expect(card.fun_facts).toContain('Common mistake:');
    expect(card.sentence_clue).toBe('这句话已经很好了，别画蛇添足。');
    expect(cardTextProblems(card)).toEqual([]);
  });
});

describe('idiomQuizScoreLine', () => {
  it('reads the score', () => {
    expect(idiomQuizScoreLine(2, 2)).toMatch(/^2 \/ 2 — 太棒了/);
    expect(idiomQuizScoreLine(1, 2)).toMatch(/nearly/);
    expect(idiomQuizScoreLine(0, 3)).toMatch(/once more/);
    expect(idiomQuizScoreLine(0, 0)).toBe('');
  });
});
