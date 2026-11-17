import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMediaTrack, isAudioPlaying, livePlayerCount, type MediaTrack } from './audioPlayback';

/**
 * Media tracks (utils/audioPlayback.ts): the seekable, pausable clips — the reader's scrubber, chat voice /
 * listening bubbles, a voice take's preview, clips' voice + music. One element per track, every object URL
 * revoked, the pitch-kept speed, and playback activity counted only while sound plays (never for ambient music).
 */

interface FakeAudio {
  src: string;
  preload?: string;
  loop?: boolean;
  volume?: number;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch?: boolean;
  error: { code: number } | null;
  onplay: (() => void) | null;
  onpause: (() => void) | null;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  ontimeupdate: (() => void) | null;
  onloadedmetadata: (() => void) | null;
  play: () => Promise<void>;
  pause: () => void;
  removeAttribute: (name: string) => void;
  getAttribute: (name: string) => string | null;
  load: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
}

let created: FakeAudio[] = [];
let revoked: string[] = [];
let nextUrl = 0;
let refusePlay = false;

function makeFakeAudio(): FakeAudio {
  const el: FakeAudio = {
    src: '',
    paused: true,
    ended: false,
    currentTime: 0,
    duration: NaN,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    error: null,
    onplay: null,
    onpause: null,
    onended: null,
    onerror: null,
    ontimeupdate: null,
    onloadedmetadata: null,
    play: () => {
      if (refusePlay) return Promise.reject(new Error('NotAllowedError'));
      el.paused = false;
      el.ended = false;
      el.onplay?.();
      return Promise.resolve();
    },
    pause: () => {
      if (el.paused) return;
      el.paused = true;
      el.onpause?.();
    },
    removeAttribute: () => {
      el.src = '';
    },
    getAttribute: () => el.src || null,
    load: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  created.push(el);
  return el;
}

/** The clip plays to its end. */
function finish(el: FakeAudio) {
  el.paused = true;
  el.ended = true;
  el.onpause?.();
  el.onended?.();
}

const tracks: MediaTrack[] = [];
function newTrack(...args: Parameters<typeof createMediaTrack>): MediaTrack {
  const t = createMediaTrack(...args);
  tracks.push(t);
  return t;
}
const blob = () => new Blob(['audio'], { type: 'audio/mpeg' });

beforeEach(() => {
  created = [];
  revoked = [];
  nextUrl = 0;
  refusePlay = false;
  vi.stubGlobal('Audio', function Audio(this: unknown) {
    return makeFakeAudio();
  });
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:fake/${nextUrl++}`,
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
});

afterEach(() => {
  tracks.splice(0).forEach((t) => t.dispose());
  vi.unstubAllGlobals();
});

describe('createMediaTrack', () => {
  it('keeps one element and revokes every object URL it made', () => {
    const t = newTrack();
    t.load(blob());
    t.load(blob());
    t.load('https://example.test/a.mp3');
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(['blob:fake/0', 'blob:fake/1']);
    expect(t.sourceUrl()).toBe('https://example.test/a.mp3');
    t.dispose();
    expect(livePlayerCount()).toBe(0);
  });

  it('plays, pauses, seeks and reports where it is', async () => {
    const t = newTrack();
    const onTime = vi.fn();
    const onLoaded = vi.fn();
    t.load(blob(), { onTime, onLoaded });
    const el = created[0];
    el.duration = 4.2;
    el.onloadedmetadata?.();
    expect(onLoaded).toHaveBeenCalledWith(4200);
    t.seek(1500);
    expect(el.currentTime).toBe(1.5);
    expect(await t.play()).toBe(true);
    expect(t.isPaused()).toBe(false);
    expect(isAudioPlaying()).toBe(true);
    el.currentTime = 2;
    el.ontimeupdate?.();
    expect(onTime).toHaveBeenCalledWith(2000, 4200);
    expect(t.positionMs()).toBe(2000);
    expect(t.durationMs()).toBe(4200);
    t.pause();
    expect(isAudioPlaying()).toBe(false);
  });

  it('says false when there is nothing to play or the browser refuses', async () => {
    const t = newTrack();
    expect(await t.play()).toBe(false);
    t.load(blob());
    refusePlay = true;
    expect(await t.play()).toBe(false);
    expect(isAudioPlaying()).toBe(false);
  });

  it('keeps its speed (pitch kept), volume and loop across sources', () => {
    const t = newTrack({ loop: true, volume: 0.3 });
    t.setRate(0.75);
    t.load(blob());
    const el = created[0];
    expect(el.playbackRate).toBe(0.75);
    expect(el.preservesPitch).toBe(true);
    expect(el.loop).toBe(true);
    expect(el.volume).toBe(0.3);
    t.setVolume(2);
    expect(t.volume()).toBe(1);
  });

  it('files the end and stops counting as playing', async () => {
    const t = newTrack();
    const onEnded = vi.fn();
    t.load(blob(), { onEnded });
    await t.play();
    finish(created[0]);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(t.isEnded()).toBe(true);
    expect(isAudioPlaying()).toBe(false);
  });

  it('never counts ambient sound (the clips\' music) as playing', async () => {
    const t = newTrack({ ambient: true, loop: true });
    t.load('/audio/clip-music.mp3');
    await t.play();
    expect(isAudioPlaying()).toBe(false);
  });

  it('plays one track of a group at a time (chat voice messages)', async () => {
    const a = newTrack({ group: 'voice' });
    const b = newTrack({ group: 'voice' });
    const c = newTrack();
    a.load(blob());
    b.load(blob());
    c.load(blob());
    await a.play();
    await c.play();
    await b.play();
    expect(a.isPaused()).toBe(true);
    expect(b.isPaused()).toBe(false);
    expect(c.isPaused()).toBe(false);
  });

  it('unload frees the source; an error after it is not reported', async () => {
    const t = newTrack();
    const onError = vi.fn();
    t.load(blob(), { onError });
    await t.play();
    t.unload();
    created[0].onerror?.();
    expect(onError).not.toHaveBeenCalled();
    expect(t.hasSource()).toBe(false);
    expect(revoked).toEqual(['blob:fake/0']);
    expect(isAudioPlaying()).toBe(false);
  });
});
