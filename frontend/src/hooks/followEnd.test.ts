import { describe, it, expect } from 'vitest';
import { isNearEnd, nextFollow, FOLLOW_SLACK_PX } from './followEnd';

const at = (scrollTop: number, scrollHeight = 3000, clientHeight = 800) => ({ scrollTop, scrollHeight, clientHeight });

describe('follow the end of a thread', () => {
  it('is at the end within the slack', () => {
    expect(isNearEnd(at(2200))).toBe(true);
    expect(isNearEnd(at(2200 - FOLLOW_SLACK_PX))).toBe(true);
    expect(isNearEnd(at(2200 - FOLLOW_SLACK_PX - 1))).toBe(false);
  });

  it('scrolling up away from the end stops following; back at the end follows again', () => {
    let follow = true;
    follow = nextFollow(follow, 2200, at(1900));
    expect(follow).toBe(false);
    // A reply grows meanwhile (no scroll event): still not following. Moving down but not at the end: unchanged.
    follow = nextFollow(follow, 1900, at(2000, 3600));
    expect(follow).toBe(false);
    follow = nextFollow(follow, 2000, at(2800, 3600));
    expect(follow).toBe(true);
  });

  it('our own smooth scroll on its way down never stops following', () => {
    let follow = true;
    for (const top of [400, 900, 1500, 2100]) follow = nextFollow(follow, top - 300, at(top, 4000));
    expect(follow).toBe(true);
  });
});
