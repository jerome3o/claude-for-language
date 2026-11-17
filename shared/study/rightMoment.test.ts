import { describe, it, expect } from 'vitest';
import { rightMoment, RIGHT_MOMENT_WHERE, RIGHT_MOMENT_PIECES, RIGHT_MOMENT_DONE_PIECES } from './rightMoment';
import { resultStateOf, RESULT_STATES, RESULT_STATE_ICON, RESULT_SURFACE } from './resultState';

describe('rightMoment', () => {
  it('is small every time, a dozen pieces under a second', () => {
    for (const where of RIGHT_MOMENT_WHERE) {
      const m = rightMoment(where);
      expect(m.confetti).toBeGreaterThan(0);
      expect(m.confetti).toBeLessThanOrEqual(RIGHT_MOMENT_PIECES);
      expect(m.durationMs).toBeGreaterThanOrEqual(600);
      expect(m.durationMs).toBeLessThanOrEqual(800);
      expect(m.animate).toBe(true);
      expect(m.feel).not.toBeNull();
    }
  });

  it('the round\'s last right exercise is a little bigger (round_done)', () => {
    const done = rightMoment('round_exercise', { roundDone: true });
    expect(done.feel).toBe('round_done');
    expect(done.confetti).toBe(RIGHT_MOMENT_DONE_PIECES);
    expect(done.confetti).toBeGreaterThan(rightMoment('round_exercise').confetti);
    // Only the round has a "done".
    expect(rightMoment('question', { roundDone: true })).toEqual(rightMoment('question'));
  });

  it('feels: success on the question and a typed answer, round_right on an exercise / a sentence row', () => {
    expect(rightMoment('question').feel).toBe('success');
    expect(rightMoment('typed_answer').feel).toBe('success');
    expect(rightMoment('round_exercise').feel).toBe('round_right');
    expect(rightMoment('sentence_row').feel).toBe('round_right');
  });

  it('reduce motion: no confetti, no animation — the feel stays', () => {
    const m = rightMoment('question', { reduceMotion: true });
    expect(m).toMatchObject({ confetti: 0, animate: false, feel: 'success' });
  });

  it('already celebrated on this showing: nothing but the tint', () => {
    expect(rightMoment('typed_answer', { celebrated: true })).toMatchObject({ feel: null, confetti: 0, animate: false });
  });
});

describe('resultStateOf — every surface\'s verdict word maps to ONE state', () => {
  const cases: Array<[string | null, string]> = [
    // "You said"
    ['match', 'right'], ['contains', 'close'], ['close', 'close'], ['miss', 'wrong'],
    // typed answers (shared/cards/answer.ts)
    ['exact', 'right'], ['punctuation_only', 'right'], ['equivalent', 'right'], ['alternative', 'right'], ['sounds_right', 'right'], ['wrong', 'wrong'],
    // Claude's checks (shared/lesson/answerCheck.ts)
    ['correct', 'right'], ['acceptable', 'right'], ['almost', 'close'],
    // sentence_making's needs_work (claude/sentence-making-verdict) is the yellow sibling, never a new orange
    ['needs_work', 'close'],
    // the round / Hard mode
    ['right', 'right'], ['nearly', 'close'], ['tones_off', 'close'],
    // waiting / unknown
    ['checking', 'pending'], ['pending', 'pending'], ['unknown', 'pending'], ['', 'pending'], [null, 'pending'],
    // case / spaces never matter
    [' Match ', 'right'], ['NEEDS_WORK', 'close'],
  ];
  it.each(cases)('%s → %s', (verdict, state) => {
    expect(resultStateOf(verdict)).toBe(state);
  });

  it('four states, one icon each, one surface', () => {
    expect(RESULT_STATES).toEqual(['right', 'close', 'wrong', 'pending']);
    expect(new Set(Object.values(RESULT_STATE_ICON)).size).toBe(4);
    expect(RESULT_SURFACE).toEqual({ border: 0.35, tint: 0.08, borderWidth: 1, radius: 10 });
  });
});
