import { describe, expect, it } from 'vitest';
import { handwritingKeys, lessonHasHandwriting, skippedHandwritingRows, typedInsteadOfHandwriting, sanitizeAttemptData } from './index';
import type { CustomLessonSpec } from './types';
import { lessonSteps, savedRunBar, lessonShape, NEW_RUN } from '../study/lessonRun';
import { computeLessonLearnState } from '../study/lessonRevision';

const sentence = { hanzi: '我写字', pinyin: 'wǒ xiě zì', english: 'I write characters' };
const spec: CustomLessonSpec = {
  title: 'Writing',
  sections: [
    { exercises: [{ type: 'note', title: 'Hi', body: 'x' }, { type: 'write_handwriting', answer: sentence }, { type: 'translate', english: 'I write', hanzi: '我写' }] },
    { exercises: [{ type: 'dictation', audio: sentence, input: 'handwrite' }, { type: 'write_handwriting', answer: sentence }] },
  ],
} as unknown as CustomLessonSpec;

describe('Skip handwriting exercises', () => {
  it('finds the handwriting', () => {
    expect(lessonHasHandwriting(spec)).toBe(true);
    expect(handwritingKeys(spec)).toEqual(['s0e1', 's1e1']);
    expect(lessonHasHandwriting({ sections: [{ exercises: [{ type: 'dictation', audio: sentence }] }] } as unknown as CustomLessonSpec)).toBe(false);
  });

  it('leaves write_handwriting out of the run (keys kept) and types a handwritten dictation', () => {
    expect(lessonSteps(spec).map(s => s.key)).toEqual(['s0e0', 's0e1', 's0e2', 's1e0', 's1e1']);
    expect(lessonSteps(spec, null, { skipHandwriting: true }).map(s => s.key)).toEqual(['s0e0', 's0e2', 's1e0']);
    expect(lessonSteps(spec, ['s0e1', 's0e2'], { skipHandwriting: true }).map(s => s.key)).toEqual(['s0e0', 's0e2']);
    const dictation = spec.sections[1].exercises[0];
    expect(typedInsteadOfHandwriting(dictation)).toMatchObject({ type: 'dictation', input: 'type' });
    expect(typedInsteadOfHandwriting(spec.sections[0].exercises[2])).toBe(spec.sections[0].exercises[2]);
  });

  it('rows for the tutor: skipped, never scored', () => {
    const rows = skippedHandwritingRows(spec);
    expect(rows).toEqual([
      { section: 0, index: 1, type: 'write_handwriting', correct: null, points: 0, max_points: 0, duration_ms: 0, skipped: 'handwriting' },
      { section: 1, index: 1, type: 'write_handwriting', correct: null, points: 0, max_points: 0, duration_ms: 0, skipped: 'handwriting' },
    ]);
    expect(skippedHandwritingRows(spec, ['s0e2'])).toEqual([]);
    const clean = sanitizeAttemptData({ started_at: 'x', duration_ms: 1, exercises: [{ ...rows[0], correct: false, max_points: 3 }] });
    expect(clean?.exercises[0]).toMatchObject({ skipped: 'handwriting', correct: null, max_points: 0 });
  });

  it('earlier misses on handwriting stop counting', () => {
    const run = { id: 'r1', at: '2026-10-01T10:00:00Z', rating: null, outcome: { keys: ['s0e1', 's0e2'], missed: ['s0e1'] } };
    expect(computeLessonLearnState([run]).status).toBe('revision');
    expect(computeLessonLearnState([run], [], handwritingKeys(spec)).status).toBe('done');
  });
});

describe('savedRunBar — a row bar only for a run in progress', () => {
  const saved = (state: typeof NEW_RUN, shape = lessonShape(spec)) => ({
    lesson_id: 'l1', shape, mode: 'full' as const, keys: null, state, correct: 0, total: 0, started_at: 'x', saved_at: 'x',
  });
  it('null when not started, another shape, none saved', () => {
    expect(savedRunBar(null, 'l1', spec)).toBeNull();
    expect(savedRunBar(saved(NEW_RUN), 'l1', spec)).toBeNull();
    expect(savedRunBar(saved({ pos: 2, owed: [], fixed: 0, retried: 0 }, 'other'), 'l1', spec)).toBeNull();
  });
  it('the run retry bar: answered blue, owed orange', () => {
    const bar = savedRunBar(saved({ pos: 3, owed: ['s0e2'], fixed: 0, retried: 0 }), 'l1', spec);
    expect(bar).toMatchObject({ answered: 3, fresh: 2, retries: 1, slots: 6 });
    // With handwriting skipped the steps are fewer.
    const skip = savedRunBar(saved({ pos: 2, owed: ['s0e2'], fixed: 0, retried: 0 }), 'l1', spec, { skipHandwriting: true });
    expect(skip).toMatchObject({ answered: 2, fresh: 1, retries: 1 });
  });
});
