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
  canUndoRun,
  runUndoFrame,
  undoKeepsAnswer,
  undoRun,
  type LessonRunStep,
  type LessonRunUndoFrame,
  type LessonRunState,
  type SavedLessonRunCore,
} from './lessonRun';
import { runOutcome } from './lessonRevision';

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

// ============ ↺ Undo ============

/** The player's bookkeeping (StudyCustomLesson / Lab LessonPlayer) around advanceRun + the undo stack. */
interface Run {
  state: LessonRunState;
  correct: number;
  total: number;
  rows: Array<{ section: number; index: number; type: string; correct: boolean | null; points: number; max_points: number; retry?: number }>;
  recordings: string[];
  undo: LessonRunUndoFrame[];
}

function newRun(): Run {
  return { state: NEW_RUN, correct: 0, total: 0, rows: [], recordings: [], undo: [] };
}

function grade(run: Run, steps: readonly LessonRunStep[], verdict: boolean | null, recording = false): Run {
  const cur = runCurrent(run.state, steps)!;
  const frame = runUndoFrame(run.state, steps, run, run.rows.length, run.recordings.length)!;
  const max = cur.step.scored && verdict !== null ? 1 : 0;
  const points = verdict ? max : 0;
  const retry = cur.phase === 'retry' ? retryNumber(run.rows, cur.step.key) : 0;
  return {
    state: advanceRun(run.state, steps, verdict),
    correct: cur.phase === 'main' && max ? run.correct + points : run.correct,
    total: cur.phase === 'main' && max ? run.total + max : run.total,
    rows: [...run.rows, { section: cur.step.section, index: cur.step.index, type: cur.step.type, correct: verdict, points, max_points: max, ...(retry ? { retry } : {}) }],
    recordings: recording ? [...run.recordings, `${cur.step.key}-${run.rows.length}`] : run.recordings,
    undo: [...run.undo, frame],
  };
}

function undo(run: Run): Run {
  const u = undoRun(run.undo)!;
  return {
    state: u.frame.state,
    correct: u.frame.correct,
    total: u.frame.total,
    rows: run.rows.slice(0, u.frame.attempts),
    recordings: run.recordings.slice(0, u.frame.recordings),
    undo: u.stack,
  };
}

const outcomeOf = (run: Run) => runOutcome({ exercises: run.rows });

describe('↺ undo', () => {
  const steps = lessonSteps(spec); // note, choice, scramble, note, translate, conversation

  it('nothing to undo at the start', () => {
    expect(canUndoRun([])).toBe(false);
    expect(undoRun([])).toBeNull();
    expect(undoRun(undefined)).toBeNull();
  });

  it('got it by mistake → ↺ → missed it: the score, the missed set and the retry queue follow the new grade', () => {
    let run = grade(newRun(), steps, null); // note
    run = grade(run, steps, true); // choice
    run = grade(run, steps, true); // scramble — "I got it" by mistake
    expect(run.state).toEqual({ pos: 3, owed: [], fixed: 0, retried: 0 });
    expect(run.correct).toBe(2);
    run = undo(run);
    expect(runCurrent(run.state, steps)?.step.key).toBe('s0e2');
    expect(run.state.pos).toBe(2);
    expect(run.correct).toBe(1);
    expect(run.total).toBe(1);
    expect(run.rows).toHaveLength(2);
    run = grade(run, steps, false); // Missed it
    expect(run.state.owed).toEqual(['s0e2']);
    expect(run.correct).toBe(1);
    expect(run.total).toBe(2);
    // Finish: s0e2 comes back in the retry round and the outcome has it missed.
    run = grade(run, steps, null);
    run = grade(run, steps, true);
    run = grade(run, steps, true);
    expect(runCurrent(run.state, steps)).toEqual({ step: steps[2], phase: 'retry' });
    run = grade(run, steps, true);
    expect(runFinished(run.state, steps)).toBe(true);
    expect(outcomeOf(run)).toEqual({ keys: ['s0e1', 's0e2', 's1e1', 's1e2'], missed: ['s0e2'] });
  });

  it('missed it by mistake → ↺ → got it: no longer owed, never comes back', () => {
    let run = grade(newRun(), steps, null);
    run = grade(run, steps, false); // choice missed by mistake
    expect(run.state.owed).toEqual(['s0e1']);
    run = undo(run);
    expect(run.state.owed).toEqual([]);
    run = grade(run, steps, true);
    for (const v of [true, null, true, true]) run = grade(run, steps, v);
    expect(runFinished(run.state, steps)).toBe(true);
    expect(outcomeOf(run)?.missed).toEqual([]);
    expect(run.correct).toBe(run.total);
  });

  it('notes passed since go with it: one tap lands on the graded exercise', () => {
    let run = grade(newRun(), steps, null);
    run = grade(run, steps, true);
    run = grade(run, steps, false); // scramble
    run = grade(run, steps, null); // note s1e0
    expect(runCurrent(run.state, steps)?.step.key).toBe('s1e1');
    run = undo(run);
    expect(runCurrent(run.state, steps)?.step.key).toBe('s0e2');
    expect(run.state.owed).toEqual([]);
    expect(run.undo).toHaveLength(2);
  });

  it('with only a note behind, ↺ steps back to it', () => {
    const run = undo(grade(newRun(), steps, null));
    expect(run.state).toEqual(NEW_RUN);
    expect(canUndoRun(run.undo)).toBe(false);
  });

  it('repeated ↺ back to the start of the run, across the retry round', () => {
    let run = newRun();
    for (const v of [null, false, true, null, false, true]) run = grade(run, steps, v);
    expect(runCurrent(run.state, steps)?.phase).toBe('retry');
    run = grade(run, steps, false); // s0e1 wrong again → back of the queue
    expect(run.state.owed).toEqual(['s1e1', 's0e1']);
    expect(run.state.retried).toBe(1);
    run = grade(run, steps, true); // s1e1 put right
    expect(run.state).toEqual({ pos: 6, owed: ['s0e1'], fixed: 1, retried: 2 });
    expect(run.rows.filter(r => r.retry)).toHaveLength(2);
    // ↺ in the retry round: s1e1 owed again, first in line.
    run = undo(run);
    expect(run.state).toEqual({ pos: 6, owed: ['s1e1', 's0e1'], fixed: 0, retried: 1 });
    expect(runCurrent(run.state, steps)?.step.key).toBe('s1e1');
    run = undo(run);
    expect(run.state).toEqual({ pos: 6, owed: ['s0e1', 's1e1'], fixed: 0, retried: 0 });
    // Over the boundary into the main pass.
    run = undo(run);
    expect(runCurrent(run.state, steps)).toEqual({ step: steps[5], phase: 'main' });
    while (canUndoRun(run.undo)) run = undo(run);
    expect(run).toEqual(newRun());
  });

  it('a retry number stays in step after ↺ (the next showing reuses the undone one)', () => {
    let run = newRun();
    for (const v of [null, false, true, null, true, true]) run = grade(run, steps, v);
    run = grade(run, steps, false); // retry 1 of s0e1, wrong
    expect(retryNumber(run.rows, 's0e1')).toBe(2);
    run = undo(run);
    expect(retryNumber(run.rows, 's0e1')).toBe(1);
  });

  it('recordings made in the undone answer are dropped', () => {
    let run = grade(newRun(), steps, null);
    run = grade(run, steps, true, true);
    run = grade(run, steps, true, true);
    expect(run.recordings).toHaveLength(2);
    run = undo(run);
    expect(run.recordings).toEqual(['s0e1-1']);
  });

  it('a finished run has no frame to push', () => {
    expect(runUndoFrame({ pos: 6, owed: [], fixed: 0 }, steps, { correct: 0, total: 0 }, 0, 0)).toBeNull();
  });

  it('undoKeepsAnswer: the self-checked ones come back on their answer side', () => {
    expect(undoKeepsAnswer('translate', { self_assessed: true })).toBe(true);
    expect(undoKeepsAnswer('listen_translate', { self_assessed: true })).toBe(true);
    expect(undoKeepsAnswer('describe_image', { self_assessed: true })).toBe(true);
    expect(undoKeepsAnswer('translate', {})).toBe(false);
    expect(undoKeepsAnswer('translate', null)).toBe(false);
    expect(undoKeepsAnswer('speak', { self_assessed: true })).toBe(false);
    expect(undoKeepsAnswer('choice', { self_assessed: true })).toBe(false);
  });
});
