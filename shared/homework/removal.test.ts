import { describe, it, expect } from 'vitest';
import { removalCopy, removalMenuLabel, removalToast, removalUndoLabel, studentFirstName } from './removal';

describe('homework removal words', () => {
  it('names the student by first name', () => {
    expect(studentFirstName('Jerome Swannack')).toBe('Jerome');
    expect(studentFirstName('  ')).toBe('your student');
    expect(removalMenuLabel('deck', 'Jerome Swannack')).toBe("Remove from Jerome's decks");
    expect(removalMenuLabel('lesson', 'Jerome')).toBe("Remove from Jerome's lessons");
    expect(removalUndoLabel('Jerome')).toBe('Undo — remove from Jerome');
  });

  it('a deck not started loses nothing', () => {
    const c = removalCopy({ kind: 'deck', title: 'HSK 1', words_met: 0, words_total: 319, can_delete_source: true }, 'Jerome');
    expect(c.title).toBe("Remove “HSK 1” from Jerome's decks?");
    expect(c.body).toBe("Jerome hasn't started this — nothing is lost.");
    expect(c.sourceOption).toBe('Also delete my copy');
  });

  it('a started deck says how much progress goes', () => {
    const c = removalCopy({ kind: 'deck', title: 'Lesson 8', words_met: 12, words_total: 40 }, 'Jerome');
    expect(c.body).toBe('Jerome has met 12 of 40 words; their progress on these words will be deleted.');
    expect(c.sourceOption).toBeNull();
  });

  it('lessons and readers count times', () => {
    expect(removalCopy({ kind: 'lesson', title: 'Tones', times: 0 }, 'Jerome').body).toBe("Jerome hasn't done this lesson yet — nothing is lost.");
    expect(removalCopy({ kind: 'lesson', title: 'Tones', times: 2 }, 'Jerome').body).toBe('Jerome has done this lesson twice; that history will be deleted.');
    expect(removalCopy({ kind: 'reader', title: '小猫', times: 3 }, 'Jerome').body).toBe('Jerome has read this 3 times; that history will be deleted.');
    expect(removalCopy({ kind: 'reader', title: '小猫', times: 1, can_delete_source: true }, 'Jerome').sourceOption).toBeNull();
  });

  it('a copy already gone', () => {
    expect(removalCopy({ kind: 'deck', title: 'X', copy_gone: true }, 'Jerome').body).toBe('Jerome already deleted their copy — nothing is lost.');
  });

  it('toast', () => {
    expect(removalToast('deck', 'HSK 1', 'Jerome')).toBe("Removed “HSK 1” from Jerome's decks");
    expect(removalToast('deck', 'HSK 1', 'Jerome', true)).toBe("Removed “HSK 1” from Jerome's decks and deleted your copy");
  });
});
