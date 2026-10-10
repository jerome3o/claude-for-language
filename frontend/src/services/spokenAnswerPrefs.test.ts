import { beforeEach, describe, expect, it } from 'vitest';
import { readSpokenSkipReview, writeSpokenSkipReview } from './spokenAnswerPrefs';

const KEY = 'spoken-answer-auto-submit-v1';

describe('spoken answers: "Skip the review" switch', () => {
  beforeEach(() => localStorage.clear());

  it('is off by default: a device that never touched the old switch gets the review', () => {
    expect(readSpokenSkipReview()).toBe(false);
  });

  it('keeps a choice made on purpose with the old switch (same key, same meaning)', () => {
    localStorage.setItem(KEY, '1'); // "Submit spoken answers automatically" switched on
    expect(readSpokenSkipReview()).toBe(true);
    localStorage.setItem(KEY, '0'); // switched off: the transcript waited — now on the review
    expect(readSpokenSkipReview()).toBe(false);
  });

  it('round-trips', () => {
    writeSpokenSkipReview(true);
    expect(readSpokenSkipReview()).toBe(true);
    writeSpokenSkipReview(false);
    expect(readSpokenSkipReview()).toBe(false);
  });
});
