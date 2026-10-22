import { describe, it, expect } from 'vitest';
import {
  LESSON_REVISION_GAP_DAYS,
  computeLessonLearnState,
  fnv1a32,
  isRevisionDue,
  parseRunOutcome,
  revisionDaysAway,
  revisionDueText,
  revisionExtraCount,
  revisionKeys,
  runEndLine,
  runOutcome,
  toGetRightLabel,
  type LessonRunRecord,
} from './lessonRevision';
import { lessonSteps } from './lessonRun';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-10T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const run = (id: string, at: number, missed: string[] | null, rating: number | null = null, keys = ['s0e1', 's0e2', 's1e1']): LessonRunRecord => ({
  id, at: iso(at), rating, outcome: missed ? { keys, missed } : null,
});

describe('runOutcome', () => {
  it('main-pass scored rows only; partial conversations are missed', () => {
    const out = runOutcome({
      exercises: [
        { section: 0, index: 0, correct: null, points: 0, max_points: 0 },
        { section: 0, index: 1, correct: false, points: 0, max_points: 1 },
        { section: 0, index: 2, correct: true, points: 1, max_points: 1 },
        { section: 1, index: 0, correct: true, points: 2, max_points: 3 },
        { section: 0, index: 1, correct: true, points: 1, max_points: 1, retry: 1 },
      ],
    });
    expect(out).toEqual({ keys: ['s0e1', 's0e2', 's1e0'], missed: ['s0e1', 's1e0'] });
    expect(runOutcome(null)).toBeNull();
  });
  it('parseRunOutcome keeps only real keys, missed ⊆ keys', () => {
    expect(parseRunOutcome('{"keys":["s0e1","bad","s0e2"],"missed":["s0e2","s9e9"]}')).toEqual({ keys: ['s0e1', 's0e2'], missed: ['s0e2'] });
    expect(parseRunOutcome('nope')).toBeNull();
    expect(parseRunOutcome({ keys: 1 })).toBeNull();
  });
});

describe('computeLessonLearnState', () => {
  it('new before any run', () => {
    expect(computeLessonLearnState([]).status).toBe('new');
  });
  it('all right first time → done forever', () => {
    const s = computeLessonLearnState([run('a', T0, [])]);
    expect(s).toMatchObject({ status: 'done', due_ms: null, runs: 1 });
  });
  it('mistakes → a revision a week later with what was missed', () => {
    const s = computeLessonLearnState([run('a', T0, ['s0e2'])]);
    expect(s).toMatchObject({ status: 'revision', revision: 1, missed: ['s0e2'], full: false, last_run_id: 'a' });
    expect(s.due_ms).toBe(T0 + LESSON_REVISION_GAP_DAYS * DAY);
  });
  it('the latest run decides; the revision number counts runs with mistakes in a row', () => {
    const s = computeLessonLearnState([run('b', T0 + 7 * DAY, ['s1e1']), run('a', T0, ['s0e2'])]);
    expect(s).toMatchObject({ status: 'revision', revision: 2, missed: ['s1e1'] });
    expect(computeLessonLearnState([run('a', T0, ['s0e2']), run('b', T0 + 7 * DAY, [])]).status).toBe('done');
    // Done, then an imperfect replay: back to revision 1.
    expect(computeLessonLearnState([run('a', T0, []), run('b', T0 + 9 * DAY, ['s0e1'])]).revision).toBe(1);
  });
  it('legacy finishes without answers: Again / Hard → a revision of the whole lesson, else done', () => {
    expect(computeLessonLearnState([run('a', T0, null, 0)])).toMatchObject({ status: 'revision', full: true });
    expect(computeLessonLearnState([run('a', T0, null, 1)])).toMatchObject({ status: 'revision', full: true });
    expect(computeLessonLearnState([run('a', T0, null, 2)]).status).toBe('done');
    expect(computeLessonLearnState([run('a', T0, null, 3)]).status).toBe('done');
    expect(computeLessonLearnState([run('a', T0, null, null)]).status).toBe('done');
  });
  it('Done for good (legacy retire) = done forever; Bring back undoes it; a later run supersedes it', () => {
    const runs = [run('a', T0, ['s0e1'])];
    const retire = { id: 'm1', at: iso(T0 + 1000), action: 'retire' as const };
    expect(computeLessonLearnState(runs, [retire]).status).toBe('done');
    expect(computeLessonLearnState(runs, [retire, { id: 'm2', at: iso(T0 + 2000), action: 'restore' }]).status).toBe('revision');
    expect(computeLessonLearnState([...runs, run('b', T0 + 5000, ['s0e2'])], [retire]).status).toBe('revision');
  });
  it('due by the cutoff of the day it falls on', () => {
    const s = computeLessonLearnState([run('a', T0, ['s0e2'])]);
    const dueDayEnd = T0 + 7 * DAY + 12 * 3600_000;
    expect(isRevisionDue(s, dueDayEnd)).toBe(true);
    expect(isRevisionDue(s, dueDayEnd - DAY)).toBe(false);
    expect(revisionDaysAway(s, dueDayEnd - DAY)).toBe(1);
    expect(revisionDueText(s, dueDayEnd - 3 * DAY)).toBe('in 3 days');
    expect(revisionDueText(s, dueDayEnd)).toBe('due today');
  });
});

describe('revisionKeys', () => {
  const big = {
    sections: [
      { exercises: [{ type: 'note' }, ...Array.from({ length: 6 }, () => ({ type: 'choice' }))] },
      { exercises: [{ type: 'note' }, ...Array.from({ length: 5 }, () => ({ type: 'translate' }))] },
      { exercises: Array.from({ length: 4 }, () => ({ type: 'scramble' })) },
    ],
  } as never;
  const steps = lessonSteps(big);
  it('every missed one + ~20% of the others (1–3), spread across types, deterministic', () => {
    const state = computeLessonLearnState([run('r1', T0, ['s0e2', 's1e3'], null, steps.filter(s => s.scored).map(s => s.key))]);
    const keys = revisionKeys(state, steps, 'L1');
    expect(keys).toContain('s0e2');
    expect(keys).toContain('s1e3');
    expect(keys.length).toBe(2 + 3); // 13 candidates → round(2.6) = 3
    expect(revisionKeys(state, steps, 'L1')).toEqual(keys);
    const extras = keys.filter(k => k !== 's0e2' && k !== 's1e3');
    const types = new Set(extras.map(k => steps.find(s => s.key === k)!.type));
    expect(types.size).toBe(3);
    // Another run id → another pick, still the missed ones.
    const other = revisionKeys({ ...state, last_run_id: 'r2' }, steps, 'L1');
    expect(other).toContain('s0e2');
  });
  it('lesson order', () => {
    const state = computeLessonLearnState([run('r1', T0, ['s2e3', 's0e1'])]);
    const keys = revisionKeys(state, steps, 'L9');
    const order = steps.map(s => s.key);
    expect([...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(keys);
  });
  it('a whole-lesson revision, or missed ones edited away → every scored exercise', () => {
    const full = computeLessonLearnState([run('a', T0, null, 1)]);
    expect(revisionKeys(full, steps, 'L1').length).toBe(15);
    const gone = computeLessonLearnState([run('a', T0, ['s9e9'])]);
    expect(revisionKeys(gone, steps, 'L1').length).toBe(15);
  });
  it('revisionExtraCount', () => {
    expect([0, 1, 2, 4, 7, 8, 12, 13, 40].map(revisionExtraCount)).toEqual([0, 1, 1, 1, 1, 2, 2, 3, 3]);
  });
  it('fnv1a32 matches the reference vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});

describe('labels', () => {
  it('toGetRightLabel / runEndLine', () => {
    const s = computeLessonLearnState([run('a', T0, ['s0e1', 's0e2', 's1e1'])]);
    expect(toGetRightLabel(s, 10)).toBe('3 to get right');
    expect(toGetRightLabel(computeLessonLearnState([run('a', T0, null, 0)]), 10)).toBe('10 to get right');
    expect(runEndLine({ keys: ['a'], missed: [] }, false)).toBe('All right first time — done for good! 🎉');
    expect(runEndLine({ keys: ['a', 'b'], missed: ['a'] }, true)).toBe('Back in a week as a revision: the 1 you missed first time + a few you got');
  });
});
