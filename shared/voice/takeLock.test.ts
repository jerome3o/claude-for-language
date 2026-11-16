import { describe, expect, it } from 'vitest';
import { mergeTakePhases, takeFooter, takeGuard, takeLocked, takeLockPhase, TAKE_CHECKING, TAKE_STOP_RECORDING } from './takeLock';
import { sentenceStopBar, SENTENCE_PRACTISE_CHECKING_TAKE, SENTENCE_PRACTISE_STOP_RECORDING } from '../study/sentencePractise';
import { readAloudLocksPage, READ_ALOUD_STOP_RECORDING } from '../reader/readAloud';

describe('take lock', () => {
  it('maps every recorder phase', () => {
    expect(['listening', 'recording', 'starting'].map(takeLockPhase)).toEqual(['recording', 'recording', 'recording']);
    expect(['finishing', 'checking', 'transcribing'].map(takeLockPhase)).toEqual(['checking', 'checking', 'checking']);
    expect(['idle', 'review', 'editing', 'failed', 'done', '', null, undefined, ' listening '].map(takeLockPhase))
      .toEqual(['idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'recording']);
  });

  it('merges takes: recording wins, then checking', () => {
    expect(mergeTakePhases([])).toBe('idle');
    expect(mergeTakePhases(['idle', 'review'])).toBe('idle');
    expect(mergeTakePhases(['finishing', 'idle'])).toBe('checking');
    expect(mergeTakePhases(['finishing', 'listening', 'idle'])).toBe('recording');
  });

  it('locks, footer and guard follow the phase', () => {
    expect(takeLocked('listening')).toBe(true);
    expect(takeLocked('finishing')).toBe(true);
    expect(takeLocked('review')).toBe(false);
    expect([takeFooter('listening'), takeFooter('finishing'), takeFooter('failed')]).toEqual(['stop', 'checking', null]);
    expect([takeGuard('recording'), takeGuard('checking'), takeGuard('idle')]).toEqual(['stop', 'wait', 'run']);
  });

  it('the sentence rows and the reader answer from it', () => {
    expect(sentenceStopBar(true, false)).toBe('stop');
    expect(sentenceStopBar(false, true)).toBe('checking');
    expect(sentenceStopBar(true, true)).toBe('stop');
    expect(sentenceStopBar(false, false)).toBeNull();
    expect(['idle', 'listening', 'finishing', 'failed', 'review'].map(readAloudLocksPage)).toEqual([false, true, true, false, false]);
    expect(SENTENCE_PRACTISE_STOP_RECORDING).toBe(TAKE_STOP_RECORDING);
    expect(READ_ALOUD_STOP_RECORDING).toBe(TAKE_STOP_RECORDING);
    expect(SENTENCE_PRACTISE_CHECKING_TAKE).toBe(TAKE_CHECKING);
  });
});
