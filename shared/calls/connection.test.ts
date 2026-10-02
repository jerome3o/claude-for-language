import { describe, expect, it } from 'vitest';
import {
  appendDiag,
  CAMERA_HALF_BELOW_BPS,
  DISCONNECT_GRACE_MS,
  initialLinkHealth,
  linkHealthOn,
  MAX_DIAG_EVENTS,
  nextIceRestartAt,
  restartBackoffMs,
  sanitizeCompose,
  sanitizeDiagEvents,
  sanitizeInstance,
  shouldAdoptPeer,
  linkSignalAction,
  linkWorthKeeping,
  tileStatus,
  videoEncodingFor,
  type CallDiagEntry,
  type LinkHealth,
} from './connection';

const connected = (at: number): LinkHealth => linkHealthOn(initialLinkHealth(0), { type: 'pc', state: 'connected', at });

describe('ICE recovery timing', () => {
  it('does nothing while connecting for the first time or connected', () => {
    expect(nextIceRestartAt(initialLinkHealth(0), true)).toBeNull();
    expect(nextIceRestartAt(connected(10), true)).toBeNull();
  });

  it('gives a disconnected link a grace period, restarts a failed one at once', () => {
    const d = linkHealthOn(connected(10), { type: 'pc', state: 'disconnected', at: 1000 });
    expect(nextIceRestartAt(d, true)).toBe(1000 + DISCONNECT_GRACE_MS);
    const f = linkHealthOn(d, { type: 'pc', state: 'failed', at: 5000 });
    expect(nextIceRestartAt(f, true)).toBe(5000);
  });

  it('backs off 2 s, 4 s, 8 s … capped at 30 s, and resets on connected', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(restartBackoffMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    let h = linkHealthOn(connected(0), { type: 'pc', state: 'failed', at: 100 });
    h = linkHealthOn(h, { type: 'restarted', at: 100 });
    expect(nextIceRestartAt(h, true)).toBe(2100);
    h = linkHealthOn(h, { type: 'restarted', at: 2100 });
    expect(nextIceRestartAt(h, true)).toBe(6100);
    h = linkHealthOn(h, { type: 'pc', state: 'connected', at: 7000 });
    expect(h.restarts).toBe(0);
    expect(nextIceRestartAt(h, true)).toBeNull();
  });

  it('retries a restart stuck in connecting', () => {
    let h = linkHealthOn(connected(0), { type: 'pc', state: 'failed', at: 100 });
    h = linkHealthOn(h, { type: 'restarted', at: 100 });
    h = linkHealthOn(h, { type: 'pc', state: 'connecting', at: 200 });
    expect(nextIceRestartAt(h, true)).toBe(100 + 2000 + DISCONNECT_GRACE_MS);
  });

  it('waits for the signalling socket before restarting', () => {
    const f = linkHealthOn(connected(0), { type: 'pc', state: 'failed', at: 100 });
    expect(nextIceRestartAt(f, false)).toBeNull();
    expect(nextIceRestartAt(f, true)).toBe(100);
  });

  it('labels the tile', () => {
    expect(tileStatus(initialLinkHealth(0), false)).toBe('connecting');
    expect(tileStatus(connected(0), false)).toBe('live');
    expect(tileStatus(linkHealthOn(connected(0), { type: 'pc', state: 'disconnected', at: 1 }), false)).toBe('reconnecting');
    expect(tileStatus(initialLinkHealth(0), true)).toBe('reconnecting');
    expect(tileStatus(connected(0), true)).toBe('live');
  });
});

describe('adopting a returning peer', () => {
  it('keeps the link only for the same person from the same page load', () => {
    const cur = { user_id: 'u1', instance: 'abc123' };
    expect(shouldAdoptPeer(cur, { user_id: 'u1', instance: 'abc123' })).toBe(true);
    expect(shouldAdoptPeer(cur, { user_id: 'u1', instance: 'zzz999' })).toBe(false);
    expect(shouldAdoptPeer(cur, { user_id: 'u2', instance: 'abc123' })).toBe(false);
    expect(shouldAdoptPeer(cur, { user_id: 'u1' })).toBe(false);
    expect(shouldAdoptPeer({ user_id: 'u1' }, { user_id: 'u1', instance: undefined })).toBe(false);
    expect(shouldAdoptPeer(null, { user_id: 'u1', instance: 'abc123' })).toBe(false);
  });

  it('never adopts a link that failed, closed or never got going — those are renegotiated', () => {
    const cur = { user_id: 'u1', instance: 'abc123' };
    const back = { user_id: 'u1', instance: 'abc123' };
    expect(shouldAdoptPeer(cur, back, 'connected')).toBe(true);
    expect(shouldAdoptPeer(cur, back, 'disconnected')).toBe(true);
    expect(shouldAdoptPeer(cur, back, 'connecting')).toBe(true);
    expect(shouldAdoptPeer(cur, back, 'failed')).toBe(false);
    expect(shouldAdoptPeer(cur, back, 'closed')).toBe(false);
    expect(shouldAdoptPeer(cur, back, 'new')).toBe(false);
    expect(linkWorthKeeping('failed')).toBe(false);
  });

  it('a signal from a new link of theirs makes mine start over; leftovers of a replaced link are ignored', () => {
    expect(linkSignalAction(null, [], undefined)).toBe('apply'); // an older app without link ids
    expect(linkSignalAction(null, [], 'L1')).toBe('apply'); // first contact binds
    expect(linkSignalAction('L1', [], 'L1')).toBe('apply');
    expect(linkSignalAction('L1', [], 'L2')).toBe('replace');
    expect(linkSignalAction('L2', ['L1'], 'L1')).toBe('ignore');
    expect(linkSignalAction('L2', ['L1'], undefined)).toBe('apply');
  });

  it('accepts only short alphanumeric instance ids', () => {
    expect(sanitizeInstance('abc123')).toBe('abc123');
    expect(sanitizeInstance('a b')).toBeUndefined();
    expect(sanitizeInstance('x'.repeat(40))).toBeUndefined();
    expect(sanitizeInstance(5)).toBeUndefined();
  });
});

describe('video encodings', () => {
  it('camera keeps frame rate and scales down under congestion with hysteresis', () => {
    expect(videoEncodingFor('camera', null)).toMatchObject({ scaleResolutionDownBy: 1, degradationPreference: 'maintain-framerate' });
    expect(videoEncodingFor('camera', 2_000_000).scaleResolutionDownBy).toBe(1);
    expect(videoEncodingFor('camera', 300_000).scaleResolutionDownBy).toBe(2);
    expect(videoEncodingFor('camera', 100_000).scaleResolutionDownBy).toBe(4);
    // Coming back needs 1.5× the threshold.
    expect(videoEncodingFor('camera', CAMERA_HALF_BELOW_BPS + 10_000, 2).scaleResolutionDownBy).toBe(2);
    expect(videoEncodingFor('camera', CAMERA_HALF_BELOW_BPS * 1.6, 2).scaleResolutionDownBy).toBe(1);
    expect(videoEncodingFor('camera', null, 2).scaleResolutionDownBy).toBe(2);
  });

  it('screen keeps resolution', () => {
    expect(videoEncodingFor('screen', 100_000)).toEqual({ maxBitrate: 1_500_000, maxFramerate: 15, scaleResolutionDownBy: 1, degradationPreference: 'maintain-resolution' });
  });
});

describe('diagnostics + compose preview', () => {
  it('sanitises diag events', () => {
    expect(sanitizeDiagEvents([{ t: 5, kind: 'pc', detail: 'a\nb' }, { t: 0, kind: 'pc' }, { t: 3, kind: 'nope' }, 'x'])).toEqual([{ t: 5, kind: 'pc', detail: 'a b' }]);
    expect(sanitizeDiagEvents('x')).toEqual([]);
  });

  it('keeps the newest events in time order', () => {
    const e = (t: number): CallDiagEntry => ({ t, kind: 'pc', detail: '', user_id: 'u', name: 'n' });
    const log = appendDiag([e(3), e(1)], [e(2)]);
    expect(log.map((x) => x.t)).toEqual([1, 2, 3]);
    const big = appendDiag([], Array.from({ length: MAX_DIAG_EVENTS + 5 }, (_, i) => e(i)));
    expect(big).toHaveLength(MAX_DIAG_EVENTS);
    expect(big[0].t).toBe(5);
  });

  it('keeps a composition to one short line', () => {
    expect(sanitizeCompose('ni hao')).toBe('ni hao');
    expect(sanitizeCompose('你\nh')).toBe('你 h');
    expect(sanitizeCompose('  ')).toBeNull();
    expect(sanitizeCompose(null)).toBeNull();
    expect(Array.from(sanitizeCompose('好'.repeat(50))!)).toHaveLength(40);
  });
});
