import { describe, it, expect } from 'vitest';
import { parseWordList } from './parse';
import { planImport, summarizePlan } from './plan';

const existing = [
  { id: 'n1', hanzi: '苹果', pinyin: 'píng guǒ', english: 'apple', fun_facts: null, sentence_clue: null },
  { id: 'n2', hanzi: '香蕉', pinyin: 'xiāng jiāo', english: 'banana', fun_facts: 'yellow', sentence_clue: '我喜欢香蕉。' },
];

describe('planImport', () => {
  it('classifies add / update / unchanged and lists field changes', () => {
    const { rows } = parseWordList('苹果\tpíng guǒ\tapple\n香蕉\txiāngjiāo\tbanana (fruit)\n葡萄\tpú tao\tgrape');
    const plan = planImport(rows, existing, 'update');
    expect(plan.map(p => p.action)).toEqual(['unchanged', 'update', 'add']);
    expect(plan[1].changes).toEqual([
      { field: 'pinyin', from: 'xiāng jiāo', to: 'xiāngjiāo' },
      { field: 'english', from: 'banana', to: 'banana (fruit)' },
    ]);
    expect(summarizePlan(plan)).toEqual({ add: 1, update: 1, unchanged: 1, skipped: 0, problems: 0 });
  });

  it('never blanks an existing field from an empty pasted cell', () => {
    const { rows } = parseWordList('香蕉');
    const plan = planImport(rows, existing, 'update');
    expect(plan[0].action).toBe('unchanged');
  });

  it('applies the skip and duplicate policies', () => {
    const { rows } = parseWordList('苹果\tpíng guǒ\tapple!');
    expect(planImport(rows, existing, 'skip')[0]).toMatchObject({ action: 'skip', reason: 'policy' });
    expect(planImport(rows, existing, 'duplicate')[0].action).toBe('add');
  });

  it('marks incomplete adds as problems with what is missing', () => {
    const { rows } = parseWordList('葡萄\n西瓜\txī guā');
    const plan = planImport(rows, existing, 'update');
    expect(plan[0]).toMatchObject({ action: 'problem', reason: 'incomplete', missing: ['pinyin', 'english'] });
    expect(plan[1]).toMatchObject({ action: 'problem', reason: 'incomplete', missing: ['english'] });
  });

  it('skips excluded rows and in-paste duplicates, flags no-Chinese rows', () => {
    const { rows } = parseWordList('葡萄\tpú tao\tgrape\n葡萄\tpú tao\tgrapes\nhello\tworld');
    const plan = planImport(rows, existing, 'update', new Set([1]));
    expect(plan.map(p => [p.action, p.reason])).toEqual([
      ['skip', 'duplicate_in_paste'],
      ['skip', 'excluded'],
      ['problem', 'no_chinese'],
    ]);
  });

  it('matches existing notes ignoring spacing and punctuation', () => {
    const { rows } = parseWordList('苹 果。\tpíng guǒ\tapple');
    expect(planImport(rows, existing, 'update')[0].action).toBe('unchanged');
  });
});
