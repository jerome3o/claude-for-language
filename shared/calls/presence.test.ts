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

  it('5 Oct: leave, reconnect after a crash, leave for good — the call ends 10 min after the LAST leave, however often the room is asked', () => {
    // Both pages crashed and sent "leave" at once, came back seconds later, then left for good.
    let plan = planRoom(base({ everJoined: true, sockets: [{ userId: 'a', seen: NOW, open: false, left: true }, { userId: 'b', seen: NOW, open: false, left: true }] }));
    expect(plan).toMatchObject({ end: false, emptySince: NOW, wakeAt: NOW + EMPTY_CALL_END_MS });
    const back = NOW + 7_000;
    plan = planRoom(base({ now: back, everJoined: true, emptySince: plan.emptySince, sockets: [{ userId: 'a', seen: back, open: true }, { userId: 'b', seen: back, open: true }] }));
    expect(plan).toMatchObject({ end: false, emptySince: null, present: ['a', 'b'] });
    const gone = NOW + 30 * 60_000;
    plan = planRoom(base({ now: gone, everJoined: true, emptySince: plan.emptySince, sockets: [] }));
    expect(plan).toMatchObject({ end: false, emptySince: gone, wakeAt: gone + EMPTY_CALL_END_MS });
    // The list endpoint asking every few seconds never moves the deadline.
    for (const dt of [5_000, 60_000, EMPTY_CALL_END_MS - 1]) {
      expect(planRoom(base({ now: gone + dt, everJoined: true, emptySince: plan.emptySince }))).toMatchObject({ end: false, wakeAt: gone + EMPTY_CALL_END_MS });
    }
    expect(planRoom(base({ now: gone + EMPTY_CALL_END_MS, everJoined: true, emptySince: plan.emptySince }))).toMatchObject({ end: true, wakeAt: null });
  });

  it('stored times that are not usable count from now — never a NaN deadline or alarm (the room would never end the call)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, NOW + 3600_000, 'x' as unknown as number]) {
      const plan = planRoom(base({ everJoined: true, emptySince: bad }));
      expect(plan).toMatchObject({ end: false, emptySince: NOW, wakeAt: NOW + EMPTY_CALL_END_MS });
      const unjoined = planRoom(base({ createdAt: bad, firstKnownAt: bad }));
      expect(unjoined).toMatchObject({ end: false, wakeAt: NOW + UNJOINED_CALL_END_MS });
    }
    expect(planRoom(base({ createdAt: Number.NaN, firstKnownAt: NOW - UNJOINED_CALL_END_MS }))).toMatchObject({ end: true });
  });
});

describe('shouldAlertMissed', () => {
  it('only for a call that ended soon after it started', () => {
    expect(shouldAlertMissed(NOW - MISSED_ALERT_MAX_AGE_MS, NOW)).toBe(true);
    expect(shouldAlertMissed(NOW - MISSED_ALERT_MAX_AGE_MS - 1, NOW)).toBe(false);
    expect(shouldAlertMissed(null, NOW)).toBe(false);
  });
});
