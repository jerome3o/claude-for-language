import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  trackClip,
  getAudioRecords,
  clearAudioRecords,
  setDiagnosticsContext,
  summarize,
  isChoppy,
  isTruncated,
  isLowBitrate,
  bitrateKbps,
  AudioClipRecord,
} from './audioDiagnostics';

/**
 * The measurement that matters: media time advancing more slowly than the wall
 * clock. These tests drive a fake element and fake timers so a stutter can be
 * produced deliberately.
 */

interface FakeAudio {
  currentTime: number;
  duration: number;
  paused: boolean;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  emit: (type: string) => void;
}

function fakeAudio(): FakeAudio {
  const listeners = new Map<string, Set<() => void>>();
  return {
    currentTime: 0,
    duration: 3,
    paused: false,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type) {
      listeners.get(type)?.forEach((fn) => fn());
    },
  };
}

const asElement = (el: FakeAudio) => el as unknown as HTMLAudioElement;
const blob = (bytes = 40_000) =>
  new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });

/** Advance both fake time and media time by the same amount (smooth playback). */
function playSmoothly(el: FakeAudio, ms: number) {
  const steps = ms / 250;
  for (let i = 0; i < steps; i++) {
    el.currentTime += 0.25;
    vi.advanceTimersByTime(250);
  }
}

/** Advance wall-clock time while media time stands still (a stall). */
function stall(el: FakeAudio, ms: number) {
  void el;
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAudioRecords();
  setDiagnosticsContext({
    playersLive: () => 1,
    prefetchStatus: () => 'idle',
    offlineMode: () => false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('trackClip', () => {
  it('records a clean clip with no stutter', () => {
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    el.emit('playing');
    playSmoothly(el, 2000);
    tracker.finish({ ended: true });

    const [record] = getAudioRecords();
    expect(record.label).toBe('note');
    expect(record.source).toBe('blob');
    expect(record.bytes).toBe(40_000);
    expect(record.stutter_ms).toBe(0);
    expect(record.stalls).toBe(0);
    expect(record.ended).toBe(true);
    expect(isChoppy(record)).toBe(false);
  });

  it('measures wall-clock time lost when media time stops advancing', () => {
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    el.emit('playing');
    playSmoothly(el, 500);
    stall(el, 1000); // one second of silence mid-clip
    playSmoothly(el, 500);
    tracker.finish({ ended: true });

    const [record] = getAudioRecords();
    // Roughly the stalled second, less per-sample tolerance.
    expect(record.stutter_ms).toBeGreaterThan(500);
    expect(record.worst_gap_ms).toBeGreaterThan(100);
    expect(isChoppy(record)).toBe(true);
  });

  it('does not blame startup latency on playback', () => {
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    // Two seconds of buffering before any audio comes out.
    stall(el, 2000);
    el.emit('playing');
    playSmoothly(el, 1000);
    tracker.finish({ ended: true });

    const [record] = getAudioRecords();
    expect(record.stutter_ms).toBe(0);
  });

  it('counts waiting and stalled events', () => {
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    el.emit('playing');
    playSmoothly(el, 250);
    el.emit('waiting');
    el.emit('stalled');
    tracker.finish({ ended: true });

    expect(getAudioRecords()[0].stalls).toBe(2);
  });

  it('captures a network source without its query string', () => {
    const el = fakeAudio();
    const tracker = trackClip(
      asElement(el),
      'https://api.test/api/audio/generated/abc.mp3?v=123',
      'note'
    );
    tracker.finish();

    const [record] = getAudioRecords();
    expect(record.source).toBe('url');
    expect(record.url).toBe('https://api.test/api/audio/generated/abc.mp3');
    expect(record.bytes).toBeNull();
  });

  it('records the surrounding context', () => {
    setDiagnosticsContext({
      playersLive: () => 7,
      prefetchStatus: () => 'running',
      offlineMode: () => true,
    });
    const el = fakeAudio();
    trackClip(asElement(el), blob(), 'note').finish();

    const [record] = getAudioRecords();
    expect(record.players_live).toBe(7);
    expect(record.prefetch).toBe('running');
    expect(record.offline_mode).toBe(true);
  });

  it('stops sampling once finished, and ignores a second finish', () => {
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    el.emit('playing');
    playSmoothly(el, 250);
    tracker.finish({ ended: true });

    stall(el, 5000); // timer must be gone — no further accumulation
    tracker.finish({ ended: true });

    const records = getAudioRecords();
    expect(records).toHaveLength(1);
    expect(records[0].stutter_ms).toBe(0);
  });

  it('records a decode/network failure', () => {
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    tracker.finish({ error: 'MEDIA_ERR_DECODE' });

    expect(getAudioRecords()[0].error).toBe('MEDIA_ERR_DECODE');
  });
});

describe('isTruncated', () => {
  const base: AudioClipRecord = {
    seq: 1,
    at: '2026-08-17T00:00:00.000Z',
    label: 'note',
    source: 'blob',
    engine: 'element',
    bytes: 1,
    mime: 'audio/mpeg',
    url: null,
    start_ms: 100,
    duration_s: 3,
    kbps: 128,
    played_s: 3,
    ended: true,
    error: null,
    stalls: 0,
    stutter_ms: 0,
    worst_gap_ms: 0,
    worst_timer_late_ms: 0,
    samples: 10,
    players_live: 1,
    prefetch: 'idle',
    online: true,
    offline_mode: false,
  };

  it('is false when playback reached the end', () => {
    expect(isTruncated(base)).toBe(false);
  });

  it('is true when playback ended well short of the duration', () => {
    expect(isTruncated({ ...base, played_s: 1.2 })).toBe(true);
  });

  it('ignores clips that were superseded rather than ended', () => {
    expect(isTruncated({ ...base, played_s: 1.2, ended: false })).toBe(false);
  });

  it('ignores clips with an unknown duration', () => {
    expect(isTruncated({ ...base, duration_s: null })).toBe(false);
  });
});

describe('summarize', () => {
  it('correlates choppiness with prefetching and with streaming', () => {
    const el = fakeAudio();

    // Clean, from cache, nothing else running.
    const clean = trackClip(asElement(el), blob(), 'note');
    el.emit('playing');
    playSmoothly(el, 500);
    clean.finish({ ended: true });

    // Choppy, streamed, while prefetch was running.
    setDiagnosticsContext({ prefetchStatus: () => 'running' });
    const el2 = fakeAudio();
    const choppy = trackClip(asElement(el2), 'https://api.test/a.mp3', 'note');
    el2.emit('playing');
    playSmoothly(el2, 250);
    stall(el2, 800);
    choppy.finish({ ended: true });

    const summary = summarize(getAudioRecords());
    expect(summary.clips).toBe(2);
    expect(summary.choppy_clips).toBe(1);
    expect(summary.from_cache).toBe(1);
    expect(summary.from_network).toBe(1);
    expect(summary.choppy_while_prefetching).toBe(1);
    expect(summary.choppy_from_network).toBe(1);
  });

  it('handles an empty set', () => {
    const summary = summarize([]);
    expect(summary.clips).toBe(0);
    expect(summary.median_start_ms).toBeNull();
    expect(summary.worst_gap_ms).toBe(0);
  });
});

describe('main-thread blocking', () => {
  // Fake timers keep the clock perfectly in step with the scheduler, so a late
  // tick cannot be simulated — this one blocks the thread for real.
  it('records timer lateness when the main thread is blocked', async () => {
    vi.useRealTimers();
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    el.emit('playing');

    el.currentTime = 0.25;
    await new Promise(resolve => setTimeout(resolve, 300)); // one clean tick

    const until = Date.now() + 500;
    while (Date.now() < until) {
      // Busy-wait: the sampler cannot run while this holds the thread.
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    tracker.finish({ ended: true });

    expect(getAudioRecords()[0].worst_timer_late_ms).toBeGreaterThan(100);
  });

  it('reports no lateness when ticks are punctual', () => {
    const el = fakeAudio();
    const tracker = trackClip(asElement(el), blob(), 'note');
    el.emit('playing');
    playSmoothly(el, 1000);
    tracker.finish({ ended: true });

    expect(getAudioRecords()[0].worst_timer_late_ms).toBe(0);
  });
});

describe('bitrate', () => {
  it('derives kbps from size and duration', () => {
    // The clip from the device report: 11520 bytes over 1.44 s → 64 kbps
    expect(bitrateKbps(11520, 1.44)).toBe(64);
    // A MiniMax clip: ~128 kbps plus a little ID3 overhead
    expect(bitrateKbps(23674, 1.32)).toBe(143);
    expect(bitrateKbps(null, 1)).toBeNull();
    expect(bitrateKbps(1000, 0)).toBeNull();
  });

  it('flags the Google fallback encode', () => {
    const el = fakeAudio();
    el.duration = 1.44;
    const tracker = trackClip(asElement(el), blob(11520), 'note');
    el.emit('playing');
    playSmoothly(el, 250);
    tracker.finish({ ended: true });

    const [record] = getAudioRecords();
    expect(record.kbps).toBe(64);
    expect(isLowBitrate(record)).toBe(true);
    expect(summarize([record]).low_bitrate_clips).toBe(1);
  });
});
