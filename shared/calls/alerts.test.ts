import { describe, it, expect } from 'vitest';
import {
  CALL_BANNER_MAX_AGE_MS,
  CALL_RING_WINDOW_MS,
  callIdFromPath,
  callMissedPush,
  callStartedPush,
  callToRing,
  parseCallTime,
  pickCallBanner,
  type LiveCallLike,
} from './alerts';

const NOW = Date.parse('2026-09-28T10:00:00Z');
const sqlTime = (msAgo: number) => new Date(NOW - msAgo).toISOString().replace('T', ' ').slice(0, 19);
const call = (id: string, over: Partial<LiveCallLike> = {}): LiveCallLike => ({
  id,
  relationship_id: 'rel-1',
  created_by: 'tutor',
  status: 'live',
  created_at: sqlTime(30_000),
  other_user_name: '王老师',
  ...over,
});

describe('parseCallTime / callIdFromPath', () => {
  it('reads SQLite datetimes as UTC and ISO strings as they are', () => {
    expect(parseCallTime('2026-09-28 10:00:00')).toBe(NOW);
    expect(parseCallTime('2026-09-28T10:00:00Z')).toBe(NOW);
    expect(parseCallTime('nope')).toBeNaN();
    expect(parseCallTime(null)).toBeNaN();
  });

  it('knows a live call page from its review', () => {
    expect(callIdFromPath('/calls/abc')).toBe('abc');
    expect(callIdFromPath('/calls/abc/')).toBe('abc');
    expect(callIdFromPath('/calls/abc/review')).toBeNull();
    expect(callIdFromPath('/calls')).toBeNull();
  });
});

describe('pickCallBanner', () => {
  const ctx = { myUserId: 'me', path: '/', now: NOW };

  it('announces an incoming call with the caller\'s name', () => {
    expect(pickCallBanner([call('c1')], ctx)).toMatchObject({ call_id: 'c1', kind: 'incoming', title: '王老师 is calling', action: 'Join', url: '/calls/c1' });
  });

  it('offers to rejoin my own call, but an incoming call wins', () => {
    const mine = call('mine', { created_by: 'me', created_at: sqlTime(1000) });
    expect(pickCallBanner([mine], ctx)).toMatchObject({ kind: 'rejoin', title: 'Your call with 王老师 is still on', action: 'Rejoin' });
    expect(pickCallBanner([mine, call('theirs')], ctx)?.call_id).toBe('theirs');
  });

  it('picks the newest incoming call', () => {
    expect(pickCallBanner([call('old', { created_at: sqlTime(600_000) }), call('new', { created_at: sqlTime(5_000) })], ctx)?.call_id).toBe('new');
  });

  it('leaves out the call on screen, dismissed calls, ended and stale ones', () => {
    expect(pickCallBanner([call('c1')], { ...ctx, path: '/calls/c1' })).toBeNull();
    expect(pickCallBanner([call('c1')], { ...ctx, path: '/calls/c1/review' })?.call_id).toBe('c1');
    expect(pickCallBanner([call('c1')], { ...ctx, dismissed: ['c1'] })).toBeNull();
    expect(pickCallBanner([call('c1', { status: 'ended' })], ctx)).toBeNull();
    expect(pickCallBanner([call('c1', { created_at: sqlTime(CALL_BANNER_MAX_AGE_MS + 1000) })], ctx)).toBeNull();
    expect(pickCallBanner([call('c1', { created_at: 'garbage' })], ctx)).toBeNull();
  });

  it('filters to one relationship when asked', () => {
    const other = call('c2', { relationship_id: 'rel-2' });
    expect(pickCallBanner([other], { ...ctx, relationshipId: 'rel-1' })).toBeNull();
    expect(pickCallBanner([other, call('c1')], { ...ctx, relationshipId: 'rel-1' })?.call_id).toBe('c1');
  });

  it('shows a solo test call only when asked, after real calls', () => {
    const solo = call('solo', { relationship_id: null, created_by: 'me', other_user_name: null });
    expect(pickCallBanner([solo], ctx)).toBeNull();
    expect(pickCallBanner([solo], { ...ctx, includeTest: true })).toMatchObject({ kind: 'test', action: 'Open' });
    expect(pickCallBanner([solo, call('c1', { created_by: 'me' })], { ...ctx, includeTest: true })?.kind).toBe('rejoin');
  });

  it('says "Your partner" without a name', () => {
    expect(pickCallBanner([call('c1', { other_user_name: null })], ctx)?.title).toBe('Your partner is calling');
  });
});

describe('callToRing', () => {
  const ctx = { myUserId: 'me', now: NOW, rung: [] as string[], mode: 'ring' as const, path: '/' };

  it('rings for a fresh incoming call', () => {
    expect(callToRing([call('c1')], ctx)?.id).toBe('c1');
  });

  it('does not ring for my own call, a solo call, an old call, or one already rung', () => {
    expect(callToRing([call('c1', { created_by: 'me' })], ctx)).toBeNull();
    expect(callToRing([call('c1', { relationship_id: null })], ctx)).toBeNull();
    expect(callToRing([call('c1', { created_at: sqlTime(CALL_RING_WINDOW_MS + 1000) })], ctx)).toBeNull();
    expect(callToRing([call('c1')], { ...ctx, rung: ['c1'] })).toBeNull();
    expect(callToRing([call('c1', { status: 'ended' })], ctx)).toBeNull();
  });

  it('respects the silent setting and the open call page', () => {
    expect(callToRing([call('c1')], { ...ctx, mode: 'silent' })).toBeNull();
    expect(callToRing([call('c1')], { ...ctx, path: '/calls/c1' })).toBeNull();
  });

  it('rings for the newest of several', () => {
    expect(callToRing([call('a', { created_at: sqlTime(60_000) }), call('b', { created_at: sqlTime(10_000) })], ctx)?.id).toBe('b');
  });
});

describe('push payloads', () => {
  it('ring and missed-call notices share a tag so one replaces the other', () => {
    const start = callStartedPush('c1', '王老师');
    const missed = callMissedPush('c1', '王老师', 'rel-1');
    expect(start).toMatchObject({ type: 'call', url: '/calls/c1', title: '📹 王老师 is calling' });
    expect(missed).toMatchObject({ type: 'call_missed', url: '/connections/rel-1' });
    expect(start.tag).toBe(missed.tag);
  });
});
