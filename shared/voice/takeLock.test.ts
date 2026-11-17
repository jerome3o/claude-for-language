import { describe, expect, it } from 'vitest';
import {
  combineTakePhases,
  TAKE_LOCK_CHECKING,
  TAKE_LOCK_STOP,
  TAKE_PHASES,
  takeLockFooter,
  takeLockLeave,
  takeLockMayProceed,
  takeLockRow,
  takePhase,
} from './takeLock';
import { sentenceStopBar, SENTENCE_PRACTISE_CHECKING_TAKE, SENTENCE_PRACTISE_STOP_RECORDING } from '../study/sentencePractise';

describe('the take lock', () => {
  it('reads a take from its recorder flags (recording wins)', () => {
    expect(takePhase(false, false)).toBe('idle');
    expect(takePhase(true, false)).toBe('recording');
    expect(takePhase(false, true)).toBe('checking');
    expect(takePhase(true, true)).toBe('recording');
  });

  it('combines several takes on one screen: recording > checking > idle', () => {
    expect(combineTakePhases([])).toBe('idle');
    expect(combineTakePhases(['idle', 'idle'])).toBe('idle');
    expect(combineTakePhases(['idle', 'checking'])).toBe('checking');
    expect(combineTakePhases(['checking', 'recording', 'idle'])).toBe('recording');
  });

  it('turns the primary action into Stop recording while recording, never proceeding mid-take', () => {
    expect(takeLockFooter('idle')).toBe('proceed');
    expect(takeLockFooter('recording')).toBe('stop');
    expect(takeLockFooter('checking')).toBe('checking');
    expect(TAKE_PHASES.filter(takeLockMayProceed)).toEqual(['idle']);
  });

  it('a row of buttons shows ONE stop: its own, or none when the screen pins a stop bar for the take', () => {
    // No pinned bar: the row becomes the stop (as before).
    expect(takeLockRow('recording', false)).toBe('stop');
    expect(takeLockRow('checking', false)).toBe('checking');
    expect(takeLockRow('idle', false)).toBe('proceed');
    // The pinned "■ Stop recording" is up (the Sentence round, the answer side's sentence rows): the row is held —
    // greyed, untappable, no second stop button.
    expect(takeLockRow('recording', true)).toBe('held');
    expect(takeLockRow('checking', true)).toBe('held');
    // Nothing under way: the row itself, pinned bar or not.
    expect(takeLockRow('idle', true)).toBe('proceed');
  });

  it('back / ✕ stop a recording take first, and leave otherwise', () => {
    expect(takeLockLeave('recording')).toBe('stop_take');
    expect(takeLockLeave('checking')).toBe('leave');
    expect(takeLockLeave('idle')).toBe('leave');
  });

  it('is the study sentence rows’ stop bar: same states, same words', () => {
    for (const listening of [false, true]) {
      for (const finishing of [false, true]) {
        const footer = takeLockFooter(takePhase(listening, finishing));
        expect(sentenceStopBar(listening, finishing)).toBe(footer === 'proceed' ? null : footer);
      }
    }
    expect(SENTENCE_PRACTISE_STOP_RECORDING).toBe(TAKE_LOCK_STOP);
    expect(SENTENCE_PRACTISE_CHECKING_TAKE).toBe(TAKE_LOCK_CHECKING);
  });
});
