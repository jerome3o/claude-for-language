import { describe, it, expect } from 'vitest';
import { copyFieldChanges } from '../relationships';

const base = {
  id: 'n',
  hanzi: '苹果',
  pinyin: 'píng guǒ',
  english: 'apple',
  audio_url: null,
  fun_facts: null,
  sentence_clue: null,
  sentence_clue_pinyin: null,
  sentence_clue_translation: null,
  sentence_clue_audio_url: null,
  sentence_clue_audio_provider: null,
  alternatives: null,
  updated_at: '2026-09-01 10:00:00',
};

describe('copyFieldChanges (tutor edits → student copy)', () => {
  it('carries newer text fields over, only the ones that differ', () => {
    const source = { ...base, id: 's', english: 'apple (fruit)', sentence_clue: '我吃苹果。', updated_at: '2026-09-02 10:00:00' };
    const target = { ...base, id: 't' };
    expect(copyFieldChanges(source, target)).toEqual([
      { column: 'english', value: 'apple (fruit)' },
      { column: 'sentence_clue', value: '我吃苹果。' },
    ]);
  });

  it('leaves a copy alone when the student edited it more recently', () => {
    const source = { ...base, id: 's', english: 'apple (fruit)', updated_at: '2026-09-02 10:00:00' };
    const target = { ...base, id: 't', english: 'my own gloss', updated_at: '2026-09-03 10:00:00' };
    expect(copyFieldChanges(source, target)).toEqual([]);
  });

  it('never blanks a field the tutor cleared', () => {
    const source = { ...base, id: 's', fun_facts: null, updated_at: '2026-09-02 10:00:00' };
    const target = { ...base, id: 't', fun_facts: 'student note' };
    expect(copyFieldChanges(source, target)).toEqual([]);
  });

  it('returns nothing when nothing differs', () => {
    const source = { ...base, id: 's', updated_at: '2026-09-02 10:00:00' };
    expect(copyFieldChanges(source, { ...base, id: 't' })).toEqual([]);
  });
});
