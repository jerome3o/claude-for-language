import { describe, it, expect } from 'vitest';
import {
  EMPTY_CALL_END_MS,
  MISSED_ALERT_MAX_AGE_MS,
  PRESENCE_TIMEOUT_MS,
  UNJOINED_CALL_END_MS,
  isSocketPresent,
  planRoom,
  presentUserIds,
  shouldAlertMissed,
  type RoomTimeline,
} from './presence';

const NOW = 1_790_000_000_000;
const base = (over: Partial<RoomTimeline> = {}): RoomTimeline => ({
  now: NOW,
  createdAt: NOW - 60_000,
  firstKnownAt: NOW - 60_000,
  everJoined: false,
  emptySince: null,
  ended: false,
  sockets: [],
  ...over,
});

describe('presence', () => {
  it('counts an open socket heard from within the timeout, not a left or silent one', () => {
    expect(isSocketPresent({ userId: 'a', seen: NOW - PRESENCE_TIMEOUT_MS, open: true }, NOW)).toBe(true);
    expect(isSocketPresent({ userId: 'a', seen: NOW - PRESENCE_TIMEOUT_MS - 1, open: true }, NOW)).toBe(false);
    expect(isSocketPresent({ userId: 'a', seen: NOW, open: false }, NOW)).toBe(false);
    expect(isSocketPresent({ userId: 'a', seen: NOW, open: true, left: true }, NOW)).toBe(false);
    expect(presentUserIds([
      { userId: 'b', seen: NOW, open: true },
      { userId: 'a', seen: NOW, open: true },
      { userId: 'b', seen: NOW - 1000, open: true },
      { userId: 'c', seen: NOW, open: true, left: true },
    ], NOW)).toEqual(['a', 'b']);
  });
});

describe('planRoom', () => {
  it('someone present: no end, wake just after the oldest socket would time out, stale sockets listed', () => {
    const plan = planRoom(base({
      everJoined: true,
      emptySince: NOW - 10_000,
      sockets: [
        { userId: 'a', seen: NOW - 20_000, open: true },
        { userId: 'b', seen: NOW - 50_000, open: true },
        { userId: 'c', seen: NOW - 5_000, open: true },
      ],
    }));
    expect(plan.present).toEqual(['a', 'c']);
    expect(plan.stale).toEqual([1]);
    expect(plan.end).toBe(false);
    expect(plan.emptySince).toBeNull();
    expect(plan.wakeAt).toBe(NOW - 20_000 + PRESENCE_TIMEOUT_MS + 1_000);
  });

  it('never joined: ends UNJOINED_CALL_END_MS after creation (or first sight), not before', () => {
    expect(planRoom(base({ createdAt: NOW - UNJOINED_CALL_END_MS + 1 }))).toMatchObject({ end: false, wakeAt: NOW + 1, emptySince: null });
    expect(planRoom(base({ createdAt: NOW - UNJOINED_CALL_END_MS }))).toMatchObject({ end: true, wakeAt: null });
    expect(planRoom(base({ createdAt: null, firstKnownAt: NOW - 3 * 3600_000 }))).toMatchObject({ end: true });
  });

  it('everyone left: the grace starts now, and ends the call once it has passed', () => {
    const first = planRoom(base({ everJoined: true }));
    expect(first).toMatchObject({ end: false, emptySince: NOW, wakeAt: NOW + EMPTY_CALL_END_MS });
    expect(planRoom(base({ everJoined: true, emptySince: NOW - EMPTY_CALL_END_MS + 1 }))).toMatchObject({ end: false });
    expect(planRoom(base({ everJoined: true, emptySince: NOW - EMPTY_CALL_END_MS }))).toMatchObject({ end: true });
  });

  it('a lingering socket that timed out starts the grace like a leave', () => {
    const plan = planRoom(base({ everJoined: true, sockets: [{ userId: 'a', seen: NOW - PRESENCE_TIMEOUT_MS - 5_000, open: true }] }));
    expect(plan.stale).toEqual([0]);
    expect(plan.present).toEqual([]);
    expect(plan).toMatchObject({ end: false, emptySince: NOW, wakeAt: NOW + EMPTY_CALL_END_MS });
  });

  it('an ended room does nothing', () => {
    expect(planRoom(base({ ended: true, sockets: [{ userId: 'a', seen: NOW, open: true }] }))).toMatchObject({ end: false, wakeAt: null, present: [] });
  });
});

describe('shouldAlertMissed', () => {
  it('only for a call that ended soon after it started', () => {
    expect(shouldAlertMissed(NOW - MISSED_ALERT_MAX_AGE_MS, NOW)).toBe(true);
    expect(shouldAlertMissed(NOW - MISSED_ALERT_MAX_AGE_MS - 1, NOW)).toBe(false);
    expect(shouldAlertMissed(null, NOW)).toBe(false);
  });
});
