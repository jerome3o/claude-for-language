import { describe, it, expect } from 'vitest';
import { coachReplyPollMs, COACH_POLL_FAST_MS, COACH_POLL_SLOW_MS } from './poll';

describe('coachReplyPollMs', () => {
  it('every second for the first 15 s, then every 2.5 s', () => {
    expect(coachReplyPollMs(0)).toBe(COACH_POLL_FAST_MS);
    expect(coachReplyPollMs(14_999)).toBe(1000);
    expect(coachReplyPollMs(15_000)).toBe(COACH_POLL_SLOW_MS);
    expect(coachReplyPollMs(120_000)).toBe(2500);
    expect(coachReplyPollMs(Number.NaN)).toBe(2500);
  });
});
