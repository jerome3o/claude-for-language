import { describe, it, expect } from 'vitest';
import {
  NEW_RUN,
  advanceRun,
  canResumeRun,
  lessonShape,
  lessonSteps,
  resumeLine,
  retryLine,
  retryMediaKey,
  retryNumber,
  runCurrent,
  runFinished,
  runRetryBar,
  verdictWrong,
  type LessonRunState,
  type SavedLessonRunCore,
} from './lessonRun';

const spec = {
  sections: [
    { exercises: [{ type: 'note' }, { type: 'choice' }, { type: 'scramble' }] },
    { exercises: [{ type: 'note' }, { type: 'translate' }, { type: 'conversation' }] },
  ],
} as never;

describe('lessonSteps', () => {
  it('the whole lesson, in order, notes unscored', () => {
    const steps = lessonSteps(spec);
    expect(steps.map(s => s.key)).toEqual(['s0e0', 's0e1', 's0e2', 's1e0', 's1e1', 's1e2']);
    expect(steps.map(s => s.scored)).toEqual([false, true, true, false, true, true]);
  });
  it('a revision: the chosen exercises with the note before each, in lesson order', () => {
    expect(lessonSteps(spec, ['s1e2', 's0e2']).map(s => s.key)).toEqual(['s0e0', 's0e2', 's1e0', 's1e2']);
    // A note asked for directly is not a question.
    expect(lessonSteps(spec, ['s0e0']).map(s => s.key)).toEqual([]);
  });
});

describe('lessonShape', () => {
  it('only the types count (text fixes and pictures keep the run)', () => {
    expect(lessonShape(spec)).toBe('note,choice,scramble|note,translate,conversation');
  });
});

describe('the retry round', () => {
  const steps = lessonSteps(spec);
  it('owes every scored exercise missed on the main pass, then asks them until right', () => {
    let st: LessonRunState = { ...NEW_RUN, owed: [] };
    const verdicts = [null, false, true, null, false, true];
    for (const v of verdicts) st = advanceRun(st, steps, v);
    expect(st).toEqual({ pos: 6, owed: ['s0e1', 's1e1'], fixed: 0, retried: 0 });
    expect(runCurrent(st, steps)).toMatchObject({ phase: 'retry', step: { key: 's0e1' } });
    expect(runRetryBar(st, steps)).toMatchObject({ answered: 6, slots: 8, retries: 2, fresh: 0, onRetries: true, itemsDone: 4 });
    st = advanceRun(st, steps, false); // wrong again → to the back
    expect(st.owed).toEqual(['s1e1', 's0e1']);
    st = advanceRun(st, steps, true);
    st = advanceRun(st, steps, true);
    expect(st).toEqual({ pos: 6, owed: [], fixed: 2, retried: 3 });
    expect(runFinished(st, steps)).toBe(true);
    expect(runRetryBar(st, steps)).toMatchObject({ answered: 9, slots: 9, retries: 0, complete: true, itemsDone: 6 });
  });
  it('an unscored exercise is never owed', () => {
    const st = advanceRun(NEW_RUN, steps, false);
    expect(st.owed).toEqual([]);
  });
  it('the bar never runs backwards as mistakes are made', () => {
    let st: LessonRunState = NEW_RUN;
    let last = 0;
    for (const v of [null, false, false, null, false, false, false, true, false, true, true, true, true]) {
      st = advanceRun(st, steps, v);
      const p = runRetryBar(st, steps);
      expect(p.doneFraction).toBeGreaterThanOrEqual(last);
      last = p.doneFraction;
    }
  });
  it('verdictWrong: a conversation with a missed question is wrong', () => {
    expect(verdictWrong(true, 2, 3)).toBe(true);
    expect(verdictWrong(true, 3, 3)).toBe(false);
    expect(verdictWrong(null, 0, 0)).toBe(false);
    expect(verdictWrong(false, 0, 1)).toBe(true);
  });
  it('retry rows and media keys', () => {
    expect(retryNumber([{ section: 0, index: 1 }, { section: 0, index: 1, retry: 1 }], 's0e1')).toBe(2);
    expect(retryNumber([], 's0e1')).toBe(1);
    expect(retryMediaKey(0, 1, 0)).toBe('s0e1');
    expect(retryMediaKey(0, 1, 2)).toBe('s0e1r2');
    expect(retryLine(1)).toBe("Let's put this one right · last one");
    expect(retryLine(3)).toBe("Let's put this one right · 3 left");
  });
});

describe('the saved run', () => {
  const steps = lessonSteps(spec);
  const saved: SavedLessonRunCore = {
    lesson_id: 'L1', shape: lessonShape(spec), mode: 'full', keys: null,
    state: { pos: 3, owed: ['s0e1'], fixed: 0 }, correct: 1, total: 2,
    started_at: '2026-10-01T20:00:00.000Z', saved_at: '2026-10-01T20:05:00.000Z',
  };
  it('continues across days — no day or age bound', () => {
    expect(canResumeRun(saved, 'L1', lessonShape(spec))).toBe(true);
    expect(canResumeRun({ ...saved, saved_at: '2026-09-01T00:00:00.000Z' }, 'L1', lessonShape(spec))).toBe(true);
  });
  it('not another lesson, another shape, or nothing answered', () => {
    expect(canResumeRun(saved, 'L2', lessonShape(spec))).toBe(false);
    expect(canResumeRun(saved, 'L1', 'note')).toBe(false);
    expect(canResumeRun({ ...saved, state: { pos: 0, owed: [], fixed: 0 } }, 'L1', lessonShape(spec))).toBe(false);
    expect(canResumeRun(null, 'L1', 'x')).toBe(false);
  });
  it('resumeLine', () => {
    expect(resumeLine(saved.state, steps)).toBe('Continue where you left off (4 of 6)');
    expect(resumeLine({ pos: 6, owed: ['s0e1', 's1e1'], fixed: 0 }, steps)).toBe('Continue where you left off (2 mistakes to put right)');
    expect(resumeLine({ pos: 6, owed: ['s0e1'], fixed: 1 }, steps)).toBe('Continue where you left off (1 mistake to put right)');
  });
});
