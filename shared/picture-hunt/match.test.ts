import { describe, expect, it } from 'vitest';
import type { HuntObject } from './types';
import { hintText, matchHuntAnswer, normalizeHanziAnswer, pickHintTarget, pinyinKey, toSimplified } from './match';

function obj(id: string, hanzi: string, pinyin: string, alternatives: string[] = [], area = 0.1): HuntObject {
  return { id, hanzi, pinyin, english: id, alternatives, regions: [{ box: { x: 0, y: 0, w: area, h: 1 } }] };
}

const OBJECTS = [
  obj('cup', '茶杯', 'chábēi', ['杯子', '杯']),
  obj('table', '桌子', 'zhuōzi', ['饭桌']),
  obj('chair', '椅子', 'yǐzi'),
  obj('tv', '电视', 'diànshì', ['电视机'], 0.3),
  obj('book', '书', 'shū'),
];

describe('matchHuntAnswer', () => {
  it('finds the primary hanzi', () => {
    expect(matchHuntAnswer('茶杯', OBJECTS, [])).toEqual({ kind: 'found', objectId: 'cup', via: 'hanzi', typed: '茶杯' });
  });
  it('accepts an alternative', () => {
    expect(matchHuntAnswer('杯子', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'cup', via: 'alternative' });
  });
  it('ignores spaces, punctuation and full-width forms', () => {
    expect(matchHuntAnswer(' 桌 子。', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'table' });
  });
  it('drops a leading numeral + measure word', () => {
    expect(matchHuntAnswer('一张桌子', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'table' });
    expect(matchHuntAnswer('这本书', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'book' });
    // 杯 alone is a listed alternative, not stripped as a measure word
    expect(normalizeHanziAnswer('杯子')).toBe('杯子');
  });
  it('converts traditional characters', () => {
    expect(toSimplified('電視')).toBe('电视');
    expect(matchHuntAnswer('電視機', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'tv', via: 'alternative' });
    expect(matchHuntAnswer('書', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'book' });
  });
  it('says already when the object was found', () => {
    expect(matchHuntAnswer('杯子', OBJECTS, ['cup'])).toEqual({ kind: 'already', objectId: 'cup' });
  });
  it('prefers an unfound object when an alternative is shared', () => {
    const objs = [obj('a', '水杯', 'shuǐbēi', ['杯子']), obj('b', '茶杯', 'chábēi', ['杯子'])];
    expect(matchHuntAnswer('杯子', objs, ['a'])).toMatchObject({ kind: 'found', objectId: 'b' });
  });
  it('treats a shared meaningful character as close', () => {
    expect(matchHuntAnswer('茶壶', OBJECTS, [])).toEqual({ kind: 'close', objectId: 'cup', reason: 'shares_character', shared: '茶' });
    // 子 alone is too common to count
    expect(matchHuntAnswer('被子', OBJECTS, [])).toEqual({ kind: 'none' });
  });
  it('does not call a found object close', () => {
    expect(matchHuntAnswer('茶壶', OBJECTS, ['cup'])).toEqual({ kind: 'none' });
  });
  it('accepts pinyin with tone marks or numbers', () => {
    expect(matchHuntAnswer('chá bēi', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'cup', via: 'pinyin' });
    expect(matchHuntAnswer('cha2bei1', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'cup', via: 'pinyin' });
    expect(matchHuntAnswer('zhuo1 zi5', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'table' });
    expect(matchHuntAnswer('Dian4shi4', OBJECTS, [])).toMatchObject({ kind: 'found', objectId: 'tv' });
  });
  it('calls toneless pinyin close and wrong tones none', () => {
    expect(matchHuntAnswer('chabei', OBJECTS, [])).toMatchObject({ kind: 'close', reason: 'missing_tones', objectId: 'cup' });
    expect(matchHuntAnswer('cha1bei1', OBJECTS, [])).toEqual({ kind: 'none' });
  });
  it('handles empty and unrelated input', () => {
    expect(matchHuntAnswer('  。', OBJECTS, [])).toEqual({ kind: 'empty' });
    expect(matchHuntAnswer('狗', OBJECTS, [])).toEqual({ kind: 'none' });
    expect(matchHuntAnswer('hello', OBJECTS, [])).toEqual({ kind: 'none' });
  });
});

describe('pinyinKey', () => {
  it('reads marks, numbers and ü / v alike', () => {
    expect(pinyinKey('lǜ sè')).toEqual({ letters: 'lvse', tones: '44', hasTones: true });
    expect(pinyinKey('lv4se4')).toEqual({ letters: 'lvse', tones: '44', hasTones: true });
    expect(pinyinKey('lüse')).toEqual({ letters: 'lvse', tones: '', hasTones: false });
  });
});

describe('hints', () => {
  it('picks the least-hinted, then biggest unfound object', () => {
    expect(pickHintTarget(OBJECTS, [], {})?.id).toBe('tv');
    expect(pickHintTarget(OBJECTS, [], { tv: 1 })?.id).toBe('cup');
    expect(pickHintTarget(OBJECTS, OBJECTS.map((o) => o.id), {})).toBeNull();
  });
  it('shows more with each level', () => {
    expect(hintText(OBJECTS[0], 1)).toBe('茶＿');
    expect(hintText(OBJECTS[0], 2)).toBe('茶＿ · chábēi');
    expect(hintText(OBJECTS[0], 3)).toBe('茶＿ · chábēi · cup');
  });
});

import { huntFeedback } from './feedback';

describe('huntFeedback', () => {
  it('says what was found, never the answer on a near miss', () => {
    expect(huntFeedback(matchHuntAnswer('杯子', OBJECTS, []), OBJECTS)).toEqual({ tone: 'found', text: '✓ 茶杯 (also 杯子) · chábēi · cup' });
    expect(huntFeedback(matchHuntAnswer('茶杯', OBJECTS, []), OBJECTS)?.text).toBe('✓ 茶杯 · chábēi · cup');
    expect(huntFeedback(matchHuntAnswer('茶壶', OBJECTS, []), OBJECTS)).toEqual({ tone: 'close', text: 'So close — something here has 茶 in its name' });
    expect(huntFeedback(matchHuntAnswer('chabei', OBJECTS, []), OBJECTS)?.tone).toBe('close');
    expect(huntFeedback(matchHuntAnswer('狗', OBJECTS, []), OBJECTS)?.tone).toBe('miss');
    expect(huntFeedback(matchHuntAnswer('杯子', OBJECTS, ['cup']), OBJECTS)?.text).toBe('Already found 茶杯');
    expect(huntFeedback(matchHuntAnswer(' ', OBJECTS, []), OBJECTS)).toBeNull();
  });
});
