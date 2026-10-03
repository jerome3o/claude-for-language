import { describe, expect, it } from 'vitest';
import { estimateCheckCost, formatUsd, liveCheckIssues, mergeCheckIssues, parseCheckIssues, samePinyin, toneChangeIssue, type NoteCheckIssue } from './check';

describe('estimateCheckCost', () => {
  it('scales with words and batches', () => {
    const e = estimateCheckCost(319);
    expect(e.batches).toBe(8);
    expect(e.label).toMatch(/^~319 words · about \$0\.0\d$/);
    expect(estimateCheckCost(0).label).toBe('~0 words · about less than $0.01');
    expect(estimateCheckCost(1).label).toBe('~1 word · about less than $0.01');
  });
  it('formats dollars', () => {
    expect(formatUsd(0.004)).toBe('less than $0.01');
    expect(formatUsd(0.0249)).toBe('$0.02');
    expect(formatUsd(1.2)).toBe('$1.20');
  });
});

describe('parseCheckIssues / liveCheckIssues', () => {
  const issue: NoteCheckIssue = { id: 'a', field: 'pinyin', kind: 'tones', current: 'yin hang', proposed: 'yínháng', reason: 'x' };
  it('parses and drops junk', () => {
    expect(parseCheckIssues(JSON.stringify([issue, { id: 1 }, null]))).toEqual([issue]);
    expect(parseCheckIssues('nope')).toEqual([]);
    expect(parseCheckIssues(null)).toEqual([]);
  });
  it('drops issues whose field changed since', () => {
    expect(liveCheckIssues([issue], { hanzi: '银行', pinyin: 'yin hang', english: 'bank' })).toHaveLength(1);
    expect(liveCheckIssues([issue], { hanzi: '银行', pinyin: 'yínháng', english: 'bank' })).toHaveLength(0);
  });
});

describe('mergeCheckIssues', () => {
  const words = [
    { hanzi: '一样', pinyin: 'yī yàng', english: 'the same' },
    { hanzi: '银行', pinyin: 'yínxíng', english: 'bank' },
    { hanzi: '苹果', pinyin: 'píngguǒ', english: 'banana' },
    { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' },
  ];
  it('adds the 一/不 rule, keeps real model issues, drops no-ops and bad indexes', () => {
    const out = mergeCheckIssues(words, [
      { index: 1, field: 'pinyin', kind: 'reading', current: '', proposed: 'yínháng', reason: '行 reads háng in 银行' },
      { index: 2, field: 'english', kind: 'gloss', current: '', proposed: 'apple', reason: '苹果 is apple' },
      { index: 3, field: 'pinyin', kind: 'tones', current: '', proposed: 'ní hǎo', reason: 'sandhi' },
      { index: 3, field: 'english', kind: 'gloss', current: '', proposed: 'Hello', reason: 'same' },
      { index: 9, field: 'english', kind: 'gloss', current: '', proposed: 'x', reason: 'x' },
    ]);
    expect(out.map(i => [i.index, i.field, i.kind, i.proposed])).toEqual([
      [0, 'pinyin', 'tone_change', 'yí yàng'],
      [1, 'pinyin', 'reading', 'yínháng'],
      [2, 'english', 'gloss', 'apple'],
      [3, 'pinyin', 'tones', 'ní hǎo'],
    ]);
    expect(out[1].current).toBe('yínxíng');
  });
  it('applies the 一/不 rule to model proposals and drops proposals with the wrong syllable count', () => {
    const out = mergeCheckIssues([{ hanzi: '一样', pinyin: 'yi yang', english: 'same' }, { hanzi: '苹果', pinyin: 'pinguo', english: 'apple' }], [
      { index: 0, field: 'pinyin', kind: 'tones', current: '', proposed: 'yī yàng', reason: 'tones missing' },
      { index: 1, field: 'pinyin', kind: 'tones', current: '', proposed: 'píng', reason: 'x' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].proposed).toBe('yí yàng');
  });
});

describe('helpers', () => {
  it('samePinyin ignores spacing and case', () => {
    expect(samePinyin('Yí gè', 'yígè')).toBe(true);
    expect(samePinyin('yī gè', 'yí gè')).toBe(false);
  });
  it('toneChangeIssue', () => {
    expect(toneChangeIssue({ hanzi: '不是', pinyin: 'bù shì', english: 'is not' })?.proposed).toBe('bú shì');
    expect(toneChangeIssue({ hanzi: '不好', pinyin: 'bù hǎo', english: 'bad' })).toBeNull();
  });
});

import { deckCheckSummary } from './check';
describe('deckCheckSummary', () => {
  const p = { id: 'x', note_id: 'n', hanzi: '一个', field: 'pinyin' as const, kind: 'tone_change' as const, current: 'yī gè', proposed: 'yí gè', reason: 'r' };
  it('describes each state', () => {
    expect(deckCheckSummary({ status: 'queued', total: 319, checked: 0, proposals: [] })).toBe('Starting… 319 words to check');
    expect(deckCheckSummary({ status: 'running', total: 319, checked: 120, proposals: [] })).toBe('Checked 120 of 319 words');
    expect(deckCheckSummary({ status: 'done', total: 319, checked: 319, proposals: [] })).toBe('No issues found in 319 words');
    expect(deckCheckSummary({ status: 'done', total: 319, checked: 319, proposals: [p, { ...p, applied: true }] })).toBe('1 possible issue in 319 words');
    expect(deckCheckSummary({ status: 'done', total: 1, checked: 1, proposals: [{ ...p, applied: true }] })).toBe('All 1 fixes applied');
    expect(deckCheckSummary({ status: 'failed', total: 10, checked: 4, proposals: [] })).toBe('Stopped after 4 of 10 words');
  });
});
