import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAudioPlayer, isAudioPlaying, whenAudioIdle, AudioPlayer } from './audioPlayback';

/**
 * The point of these tests is resource hygiene: one element, and every object
 * URL revoked. A leak here is invisible in the browser but degrades WebView
 * playback into crunching and drop-outs over a long study session.
 */

interface FakeAudio {
  src: string;
  onplay: (() => void) | null;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  paused: boolean;
  loads: number;
  // The diagnostics layer samples currentTime and subscribes to media events.
  currentTime: number;
  duration: number;
  error: { code: number } | null;
  listeners: Map<string, Set<() => void>>;
  play: () => Promise<void>;
  pause: () => void;
  removeAttribute: (name: string) => void;
  load: () => void;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

let created: FakeAudio[] = [];
let objectUrls: string[] = [];
let revoked: string[] = [];
let nextUrl = 0;

function makeFakeAudio(): FakeAudio {
  const el: FakeAudio = {
    src: '',
    onplay: null,
    onended: null,
    onerror: null,
    paused: true,
    loads: 0,
    currentTime: 0,
    duration: 1,
    error: null,
    listeners: new Map(),
    play: () => {
      el.paused = false;
      el.onplay?.();
      return Promise.resolve();
    },
    pause: () => {
      el.paused = true;
    },
    removeAttribute: () => {
      el.src = '';
    },
    load: () => {
      el.loads++;
    },
    addEventListener: (type, fn) => {
      if (!el.listeners.has(type)) el.listeners.set(type, new Set());
      el.listeners.get(type)!.add(fn);
    },
    removeEventListener: (type, fn) => {
      el.listeners.get(type)?.delete(fn);
    },
  };
  created.push(el);
  return el;
}

beforeEach(() => {
  created = [];
  objectUrls = [];
  revoked = [];
  nextUrl = 0;
  vi.stubGlobal('Audio', function Audio(this: unknown) {
    return makeFakeAudio();
  });
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const url = `blob:fake/${nextUrl++}`;
      objectUrls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
});

const blob = () => new Blob(['audio'], { type: 'audio/mpeg' });

// Playback activity is tracked module-wide, so every player a test creates has
// to be released or it leaks into the next one.
const players: AudioPlayer[] = [];
function newPlayer(): AudioPlayer {
  const player = createAudioPlayer();
  players.push(player);
  return player;
}

afterEach(() => {
  players.splice(0).forEach(player => player.dispose());
});

describe('createAudioPlayer', () => {
  it('reuses a single element across many clips', () => {
    const player = newPlayer();
    for (let i = 0; i < 50; i++) {
      player.play(blob());
    }
    expect(created).toHaveLength(1);
  });

  it('revokes the previous object URL before playing the next clip', () => {
    const player = newPlayer();
    player.play(blob());
    player.play(blob());
    player.play(blob());

    // Every URL but the one currently playing has been revoked.
    expect(objectUrls).toHaveLength(3);
    expect(revoked).toEqual(objectUrls.slice(0, 2));

    player.stop();
    expect(revoked).toEqual(objectUrls);
  });

  it('releases the media resource on stop, not just pause', () => {
    const player = newPlayer();
    player.play(blob());
    player.stop();

    const el = created[0];
    expect(el.paused).toBe(true);
    expect(el.src).toBe('');
    expect(el.loads).toBeGreaterThan(0);
  });

  it('does not create object URLs for plain URL sources', () => {
    const player = newPlayer();
    player.play('https://example.test/clip.mp3');
    expect(objectUrls).toHaveLength(0);
    expect(created[0].src).toBe('https://example.test/clip.mp3');
  });

  it('only fires handlers for the current clip', () => {
    const player = newPlayer();
    const first = { onEnded: vi.fn() };
    const second = { onEnded: vi.fn() };

    player.play(blob(), first);
    const el = created[0];
    const staleEnded = el.onended;

    player.play(blob(), second);
    // A late event from the superseded clip must be ignored.
    staleEnded?.();
    expect(first.onEnded).not.toHaveBeenCalled();

    el.onended?.();
    expect(second.onEnded).toHaveBeenCalledTimes(1);
  });

  it('claim() supersedes in-flight async work', () => {
    const player = newPlayer();
    const stale = player.claim();
    const fresh = player.claim();

    expect(player.isCurrent(stale)).toBe(false);
    expect(player.isCurrent(fresh)).toBe(true);
  });

  it('claim() stops whatever is currently playing', () => {
    const player = newPlayer();
    player.play(blob());
    player.claim();

    expect(created[0].paused).toBe(true);
    expect(revoked).toEqual(objectUrls);
  });

  it('dispose() releases the element and its URL', () => {
    const player = newPlayer();
    player.play(blob());
    player.dispose();

    expect(revoked).toEqual(objectUrls);
    expect(created[0].paused).toBe(true);

    // A player used again after dispose builds a fresh element rather than
    // resurrecting the released one.
    player.play(blob());
    expect(created).toHaveLength(2);
  });

  it('reports a rejected play() as an error', async () => {
    const player = newPlayer();
    const onError = vi.fn();
    vi.stubGlobal('Audio', function Audio() {
      const el = makeFakeAudio();
      el.play = () => Promise.reject(new Error('NotAllowedError'));
      return el;
    });

    player.play(blob(), { onError });
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalled();
  });
});

describe('playback activity gate', () => {
  it('is idle before anything plays', async () => {
    expect(isAudioPlaying()).toBe(false);
    await expect(whenAudioIdle()).resolves.toBeUndefined();
  });

  it('reports playing while a clip is in flight', () => {
    const player = newPlayer();
    player.play(blob());
    expect(isAudioPlaying()).toBe(true);

    player.stop();
    expect(isAudioPlaying()).toBe(false);
  });

  it('holds background work until the clip ends', async () => {
    const player = newPlayer();
    player.play(blob());

    let released = false;
    const waiting = whenAudioIdle().then(() => { released = true; });

    await Promise.resolve();
    expect(released).toBe(false);

    created[0].onended?.();
    await waiting;
    expect(released).toBe(true);
  });

  it('releases waiters when playback errors rather than ends', async () => {
    const player = newPlayer();
    player.play(blob());
    const waiting = whenAudioIdle();

    created[0].onerror?.();
    await expect(waiting).resolves.toBeUndefined();
    expect(isAudioPlaying()).toBe(false);
  });

  it('does not double-count a player that replaces its own clip', () => {
    const player = newPlayer();
    player.play(blob());
    player.play(blob());
    player.play(blob());
    expect(isAudioPlaying()).toBe(true);

    // One stop is enough — the player only ever holds one active clip.
    player.stop();
    expect(isAudioPlaying()).toBe(false);
  });

  it('counts players independently', () => {
    const a = newPlayer();
    const b = newPlayer();
    a.play(blob());
    b.play(blob());

    a.stop();
    expect(isAudioPlaying()).toBe(true);
    b.dispose();
    expect(isAudioPlaying()).toBe(false);
  });

  it('gives up waiting rather than stalling caching forever', async () => {
    vi.useFakeTimers();
    try {
      const player = newPlayer();
      player.play(blob()); // never ends

      let released = false;
      const waiting = whenAudioIdle(1000).then(() => { released = true; });

      await vi.advanceTimersByTimeAsync(1001);
      await waiting;
      expect(released).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
