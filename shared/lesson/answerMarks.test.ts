import { describe, expect, it } from 'vitest';
import { answerMarks, markedChars, REORDERED_NOTE, sameCharacters } from './feedback';

describe('answerMarks (Jerome, Nov 2026: 我 painted red on a pure reordering under ✓ Also right)', () => {
  const said = '因为这个问题，我睡不着觉。';
  const model = '我因为这个问题睡不着觉。';

  it('a reordering of the same characters is never marked: the neutral note instead', () => {
    expect(sameCharacters(said, model)).toBe(true);
    expect(answerMarks(said, model)).toEqual({ marks: false, note: REORDERED_NOTE });
    expect(answerMarks(said, model, 'almost')).toEqual({ marks: false, note: REORDERED_NOTE });
    // (markedChars alone marks 我 on both rows — the bug the screenshot showed.)
    expect(markedChars(said, model, 'answer').filter((c) => !c.hit).map((c) => c.ch)).toEqual(['我']);
    expect(markedChars(said, model, 'model').filter((c) => !c.hit).map((c) => c.ch)).toEqual(['我']);
  });

  it('a right verdict takes the marks away; before it (or almost / wrong) they show', () => {
    const other = '这个问题让我睡不着。';
    expect(answerMarks(other, model)).toEqual({ marks: true, note: null });
    expect(answerMarks(other, model, null)).toEqual({ marks: true, note: null });
    expect(answerMarks(other, model, 'acceptable')).toEqual({ marks: false, note: null });
    expect(answerMarks(other, model, 'correct')).toEqual({ marks: false, note: null });
    expect(answerMarks(other, model, 'almost')).toEqual({ marks: true, note: null });
    expect(answerMarks(other, model, 'wrong')).toEqual({ marks: true, note: null });
  });

  it('the model answer itself (punctuation aside) or nothing said: no marks, no note', () => {
    expect(answerMarks('我因为这个问题睡不着觉', model)).toEqual({ marks: false, note: null });
    expect(answerMarks('', model)).toEqual({ marks: false, note: null });
    expect(answerMarks('。', model)).toEqual({ marks: false, note: null });
    expect(sameCharacters('我我', '我')).toBe(false);
    expect(sameCharacters('', '')).toBe(false);
  });
});
