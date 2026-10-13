import { describe, expect, it } from 'vitest';
import { cardNewCharacters, markCharactersSeen, newCharacterMask, newCharactersIn, newCharactersLabel, seenCharactersOf } from './newCharacters';
import { seenFrom } from '../decks/novelty';

describe('new characters (the shimmer)', () => {
  const seen = seenCharactersOf(['银子', '你好！', 'hello', '大学生']);

  it('seen = the Han characters of the reviewed notes’ hanzi (as the queue’s New characters first)', () => {
    expect([...seen].sort()).toEqual(['你', '子', '大', '好', '学', '生', '银'].sort());
    // Same set the queue's novelty rule builds.
    expect(seen).toEqual(seenFrom(['银子', '你好！', 'hello', '大学生']).chars);
  });

  it('a card’s never-seen characters, distinct and in order', () => {
    expect(newCharactersIn('银行', seen)).toEqual(['行']);
    expect(newCharactersIn('谢谢你', seen)).toEqual(['谢']);
    expect(newCharactersIn('你好', seen)).toEqual([]);
    expect(newCharactersIn('OK，行吗？', seen)).toEqual(['行', '吗']);
  });

  it('the mask marks every occurrence, never punctuation / Latin', () => {
    expect(newCharacterMask('谢谢你。', seen)).toEqual([true, true, false, false]);
    expect(newCharacterMask('A行', seen)).toEqual([false, true]);
    expect(newCharacterMask('', seen)).toEqual([]);
    // A supplementary-plane character is ONE entry (code points, like [...text]).
    expect(newCharacterMask('𠮷好', seen)).toEqual([true, false]);
  });

  it('rating a card makes its characters seen for the next card', () => {
    const s = seenCharactersOf([]);
    expect(newCharactersIn('银行', s)).toEqual(['银', '行']);
    markCharactersSeen(s, '银行');
    expect(newCharactersIn('银行', s)).toEqual([]);
    expect(newCharactersIn('行人', s)).toEqual(['人']);
  });

  it('labels for screen readers', () => {
    expect(newCharactersLabel([])).toBe('');
    expect(newCharactersLabel(['行'])).toBe('New character: 行');
    expect(newCharactersLabel(['银', '行'])).toBe('New characters: 银, 行');
  });

  it('only in the flashcard study session, and only once the seen set is loaded', () => {
    expect(cardNewCharacters('银行', seen, true)).toEqual(['行']);
    // Homework pass / tutor-notes practice / previews: never.
    expect(cardNewCharacters('第一节课前半小时', seen, false)).toEqual([]);
    expect(cardNewCharacters('银行', new Set(), false)).toEqual([]);
    // Not loaded is not "nothing seen": no shimmer at all.
    expect(cardNewCharacters('第一节课前半小时', null, true)).toEqual([]);
    expect(cardNewCharacters('第一节课前半小时', undefined, true)).toEqual([]);
    // A loaded but empty set (no reviews on the account yet) is real: everything is new.
    expect(cardNewCharacters('银行', new Set(), true)).toEqual(['银', '行']);
  });
});
