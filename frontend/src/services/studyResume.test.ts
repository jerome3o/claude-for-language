import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetStudyResume,
  claimCelebration,
  clearResumePoint,
  coachReturnPath,
  loadResumePoint,
  loadUndoSnapshot,
  resumeExtras,
  saveResumeExtras,
  saveResumePoint,
  saveUndoSnapshot,
  setCoachReturn,
} from './studyResume';
import { getLocalDateString } from '../api/client';

describe('study resume store', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    _resetStudyResume();
  });

  const point = () => ({ day: getLocalDateString(), scope: 'all', card_id: 'c1', revealed: true, answer: '你好', elapsed_ms: 5_000 });

  it('keeps the point through a reload and clears it only for its own card', () => {
    saveResumePoint(point());
    _resetStudyResume(); // reload: memory gone, localStorage kept
    expect(loadResumePoint()).toEqual(point());
    clearResumePoint('other');
    expect(loadResumePoint()).not.toBeNull();
    clearResumePoint('c1');
    expect(loadResumePoint()).toBeNull();
  });

  it('keeps the recording / grid in memory for that card only', () => {
    const blob = new Blob(['x']);
    saveResumeExtras({ cardId: 'c1', recording: blob, mc: null });
    expect(resumeExtras('c1')?.recording).toBe(blob);
    expect(resumeExtras('c2')).toBeNull();
    clearResumePoint('c1');
    expect(resumeExtras('c1')).toBeNull();
  });

  it('undo is kept per scope for today', () => {
    saveUndoSnapshot('all', { eventId: 'e1' });
    expect(loadUndoSnapshot('all')).toEqual({ eventId: 'e1' });
    expect(loadUndoSnapshot('deck-1')).toBeNull();
    saveUndoSnapshot('all', null);
    expect(loadUndoSnapshot('all')).toBeNull();
  });

  it('celebrates emptying the queue once, and again after more cards were cleared', () => {
    expect(claimCelebration(0, true)).toBe(false);
    expect(claimCelebration(30, false)).toBe(false);
    expect(claimCelebration(30, true)).toBe(true);
    expect(claimCelebration(30, true)).toBe(false); // back to Study later: quiet
    expect(claimCelebration(34, true)).toBe(true); // more became due and were cleared
  });

  it('remembers the way back from the coach to a study card only', () => {
    setCoachReturn('/study?autostart=true');
    expect(coachReturnPath()).toBe('/study?autostart=true');
    setCoachReturn('/admin');
    expect(coachReturnPath()).toBeNull();
    setCoachReturn(null);
    expect(coachReturnPath()).toBeNull();
  });
});
