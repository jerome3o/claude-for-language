import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AudioPlayer } from './audioPlayback';
import type { AudioClipRecord, NativeClipStats } from './audioDiagnostics';

/**
 * In the Android app, clips go to the native bridge (window.AndroidAudio) and
 * play outside the WebView. The bridge is a tiny synchronous interface that
 * reports back through window events; the player has to route those to the
 * right clip, ignore stale ones, and fall back to an element when the bridge
 * is missing or refuses.
 *
 * Two bridge generations are in the wild: v1 (app 1.51: play/stop only) and
 * v2 (clip cache by key, tuning, measurement). The page must work with both.
 */

interface BridgeCall {
  id: number;
  key?: string;
  source: string;
}

let calls: BridgeCall[] = [];
let stops: number[] = [];
let holds: boolean[] = [];
let prefs: Array<[string, boolean]> = [];
let cachedKeys = new Set<string>();
let accept = true;
let elements = 0;

/** The play/stop-only bridge of app 1.51. */
function stubLegacyBridge() {
  vi.stubGlobal('AndroidAudio', {
    play(id: number, source: string) {
      calls.push({ id, source });
      return accept;
    },
    stop(id: number) {
      stops.push(id);
    },
  });
  // The bridge lives on window; vitest's stubGlobal puts it on globalThis,
  // which happy-dom aliases to window.
}

function stubBridge() {
  vi.stubGlobal('AndroidAudio', {
    play(id: number, source: string) {
      calls.push({ id, source });
      return accept;
    },
    playClip(id: number, key: string, source: string) {
      calls.push({ id, key, source });
      if (!accept) return false;
      // An empty source asks for the cached copy; a missing one is refused.
      if (source === '') return cachedKeys.has(key);
      if (key) cachedKeys.add(key);
      return true;
    },
    hasClip(key: string) {
      return cachedKeys.has(key);
    },
    stop(id: number) {
      stops.push(id);
    },
    setCompression(on: boolean) {
      prefs.push(['compression', on]);
    },
    setKeepAwake(on: boolean) {
      prefs.push(['keepAwake', on]);
    },
    holdOutput(hold: boolean) {
      holds.push(hold);
    },
    describe() {
      return JSON.stringify({
        bridge: 2, compression: true, effect: 'on', keep_awake: true, output_held: holds.length > 0,
        holds: 0, route: 'speaker', volume: 9, volume_max: 15, cached_clips: cachedKeys.size, sdk: 34,
      });
    },
  });
}

function stubAudioElement() {
  vi.stubGlobal('Audio', function Audio() {
    elements++;
    return {
      src: '', onplay: null, onended: null, onerror: null,
      currentTime: 0, duration: 1, error: null, paused: true,
      play: () => Promise.resolve(),
      pause: () => {},
      removeAttribute: () => {},
      load: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}

function emit(id: number, event: 'play' | 'ended' | 'error' | 'superseded', stats?: NativeClipStats) {
  window.dispatchEvent(new CustomEvent('android-audio', { detail: { id, event, stats } }));
}

const sampleStats = (overrides: Partial<NativeClipStats> = {}): NativeClipStats => ({
  bridge: 2,
  cached: false,
  prepare_ms: 40,
  start_ms: 55,
  drift_ms: 12,
  worst_drift_ms: 30,
  samples: 12,
  not_playing: 0,
  buffering: 0,
  duration_ms: 1280,
  position_ms: 1270,
  route: 'speaker',
  volume: 9,
  volume_max: 15,
  effect: 'on',
  output_held: true,
  ...overrides,
});

let playback: typeof import('./audioPlayback');
let diagnostics: typeof import('./audioDiagnostics');

const players: AudioPlayer[] = [];
function newPlayer(): AudioPlayer {
  const player = playback.createAudioPlayer();
  players.push(player);
  return player;
}
const getAudioRecords = (): AudioClipRecord[] => diagnostics.getAudioRecords();

const blob = () => new Blob(['audio-bytes'], { type: 'audio/mpeg' });
const DATA_URL = `data:audio/mpeg;base64,${btoa('audio-bytes')}`;
// The blob is turned into a data: URL asynchronously before the bridge is called.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  calls = [];
  stops = [];
  holds = [];
  prefs = [];
  cachedKeys = new Set();
  accept = true;
  elements = 0;
  stubAudioElement();
  vi.resetModules();
  playback = await import('./audioPlayback');
  diagnostics = await import('./audioDiagnostics');
});

afterEach(() => {
  players.splice(0).forEach(player => player.dispose());
  vi.unstubAllGlobals();
});

describe('native audio bridge (v1, play/stop only)', () => {
  it('hands a cached clip to the bridge as a data URL, not to an element', async () => {
    stubLegacyBridge();
    const player = newPlayer();
    player.play(blob(), { label: 'note', cacheKey: 'generated/a.mp3' });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe(DATA_URL);
    expect(calls[0].key).toBeUndefined();
    expect(elements).toBe(0);
    expect(playback.nativeBridgeVersion()).toBe(1);
  });

  it('passes a streamed URL straight through', () => {
    stubLegacyBridge();
    const player = newPlayer();
    player.play('https://x.test/api/audio/a.mp3');

    expect(calls).toEqual([{ id: 1, source: 'https://x.test/api/audio/a.mp3' }]);
  });

  it('tolerates the missing tuning API', () => {
    stubLegacyBridge();
    expect(playback.describeNativeBridge()).toBeNull();
    expect(() => playback.setNativeCompression(true)).not.toThrow();
    const release = playback.holdNativeOutput();
    expect(playback.nativeOutputHoldCount()).toBe(1);
    release();
    expect(playback.nativeOutputHoldCount()).toBe(0);
  });
});

describe('native audio bridge (v2)', () => {
  it('sends the bytes under their key the first time, and plays by key after that', async () => {
    stubBridge();
    const player = newPlayer();
    player.play(blob(), { label: 'note', cacheKey: 'generated/a.mp3' });
    await settle();

    expect(calls).toEqual([{ id: 1, key: 'generated/a.mp3', source: DATA_URL }]);
    emit(1, 'ended', sampleStats());

    player.play(blob(), { label: 'note', cacheKey: 'generated/a.mp3' });
    await settle();
    // Second play: no base64 crossed the bridge.
    expect(calls[1]).toEqual({ id: 2, key: 'generated/a.mp3', source: '' });
    expect(elements).toBe(0);
    expect(playback.nativeBridgeVersion()).toBe(2);
  });

  it('sends the bytes when the app has lost the cached copy since the check', async () => {
    stubBridge();
    cachedKeys.add('generated/a.mp3');
    const bridge = window.AndroidAudio!;
    // hasClip says yes, but the file is gone by the time playClip runs.
    bridge.playClip = (id: number, key: string, source: string) => {
      calls.push({ id, key, source });
      return source !== '';
    };
    const player = newPlayer();
    const onError = vi.fn();
    player.play(blob(), { cacheKey: 'generated/a.mp3', onError });
    await settle();

    expect(calls.map(c => c.source)).toEqual(['', DATA_URL]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('plays a clip with no key without caching it', async () => {
    stubBridge();
    const player = newPlayer();
    player.play(blob(), { label: 'sentence-chunk' });
    await settle();

    expect(calls).toEqual([{ id: 1, key: '', source: DATA_URL }]);
    expect(cachedKeys.size).toBe(0);
  });

  it('drives the handlers from the bridge events and folds the stats into the record', async () => {
    stubBridge();
    const player = newPlayer();
    const onPlay = vi.fn();
    const onEnded = vi.fn();
    player.play(blob(), { label: 'note', cacheKey: 'generated/a.mp3', onPlay, onEnded });
    await settle();
    expect(playback.isAudioPlaying()).toBe(true);

    emit(calls[0].id, 'play');
    expect(onPlay).toHaveBeenCalledTimes(1);
    emit(calls[0].id, 'ended', sampleStats({ drift_ms: 310, worst_drift_ms: 320, not_playing: 1 }));
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(playback.isAudioPlaying()).toBe(false);

    const [record] = getAudioRecords();
    expect(record.engine).toBe('native');
    expect(record.label).toBe('note');
    expect(record.ended).toBe(true);
    expect(record.start_ms).not.toBeNull();
    expect(record.native?.route).toBe('speaker');
    // The media stack's numbers land in the same fields the element path
    // fills, so the summary flags this clip as choppy like any other.
    expect(record.stutter_ms).toBe(310);
    expect(record.worst_gap_ms).toBe(320);
    expect(record.stalls).toBe(1);
    expect(record.duration_s).toBe(1.28);
    expect(record.played_s).toBe(1.27);
    expect(record.kbps).toBe(Math.round((11 * 8) / 1.28 / 1000));
    expect(diagnostics.isChoppy(record)).toBe(true);

    const summary = diagnostics.summarize(getAudioRecords());
    expect(summary.via_native).toBe(1);
    expect(summary.choppy_clips).toBe(1);
    expect(summary.native_compressed).toBe(1);
    expect(summary.native_output_held).toBe(1);
    expect(summary.native_routes).toEqual({ speaker: 1 });
    expect(summary.choppy_on_cold_output).toBe(0);
  });

  it('counts a choppy clip on a cold output separately', async () => {
    stubBridge();
    const player = newPlayer();
    player.play(blob());
    await settle();
    emit(calls[0].id, 'ended', sampleStats({ drift_ms: 400, output_held: false, cached: true }));

    const summary = diagnostics.summarize(getAudioRecords());
    expect(summary.choppy_on_cold_output).toBe(1);
    expect(summary.native_cached).toBe(1);
  });

  it('reports a bridge error as a playback error', async () => {
    stubBridge();
    const player = newPlayer();
    const onError = vi.fn();
    player.play(blob(), { onError });
    await settle();

    emit(calls[0].id, 'error', sampleStats({ error: '1/-19' }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(playback.isAudioPlaying()).toBe(false);
    expect(getAudioRecords()[0].error).toBe('native-error');
    expect(getAudioRecords()[0].native?.error).toBe('1/-19');
  });

  it('stops the bridge clip on stop()', async () => {
    stubBridge();
    const player = newPlayer();
    player.play(blob());
    await settle();

    player.stop();
    expect(stops).toEqual([calls[0].id]);
    expect(playback.isAudioPlaying()).toBe(false);
  });

  it('ignores events for a clip that has been superseded within one player', async () => {
    stubBridge();
    const player = newPlayer();
    const first = vi.fn();
    const second = vi.fn();
    player.play(blob(), { onEnded: first });
    await settle();
    player.play(blob(), { onEnded: second });
    await settle();

    expect(calls).toHaveLength(2);
    emit(calls[0].id, 'ended');
    expect(first).not.toHaveBeenCalled();
    emit(calls[1].id, 'ended');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ends a player's clip when another player takes the output", async () => {
    // The app has ONE MediaPlayer. When the sentence list starts a row while
    // the card clip is playing, the bridge reports 'superseded' on the card's
    // id; the card player must go quiet (button off, audio-busy gate released)
    // rather than wait for an 'ended' that never comes.
    stubBridge();
    const card = newPlayer();
    const sentence = newPlayer();
    const cardEnded = vi.fn();
    card.play(blob(), { label: 'note', onEnded: cardEnded });
    sentence.play(blob(), { label: 'sentence-set' });
    await settle();

    expect(playback.isAudioPlaying()).toBe(true);
    emit(calls[0].id, 'superseded');
    expect(cardEnded).toHaveBeenCalledTimes(1);

    const [record] = getAudioRecords();
    expect(record.label).toBe('note');
    expect(record.ended).toBe(false);
    expect(record.error).toBeNull();

    // The sentence clip is still counted as active until it ends.
    expect(playback.isAudioPlaying()).toBe(true);
    emit(calls[1].id, 'ended', sampleStats());
    expect(playback.isAudioPlaying()).toBe(false);
  });

  it('gives each player its own ids so events route to the right one', async () => {
    stubBridge();
    const a = newPlayer();
    const b = newPlayer();
    const aEnded = vi.fn();
    const bEnded = vi.fn();
    a.play(blob(), { onEnded: aEnded });
    b.play(blob(), { onEnded: bEnded });
    await settle();

    expect(calls[0].id).not.toBe(calls[1].id);
    emit(calls[1].id, 'ended');
    expect(bEnded).toHaveBeenCalledTimes(1);
    expect(aEnded).not.toHaveBeenCalled();
  });

  it('falls back to the element when the bridge refuses the clip', async () => {
    stubBridge();
    accept = false;
    const player = newPlayer();
    const onError = vi.fn();
    player.play(blob(), { onError });
    await settle();

    // The bridge said no; the player reports it rather than pretending.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(getAudioRecords()[0].error).toBe('native-rejected');
  });

  it('forwards the tuning preferences and describes the bridge', () => {
    stubBridge();
    playback.setNativeCompression(false);
    playback.setNativeKeepAwake(true);
    expect(prefs).toEqual([['compression', false], ['keepAwake', true]]);
    expect(playback.describeNativeBridge()?.route).toBe('speaker');
  });

  it('holds the output once however many screens ask, and releases on the last', () => {
    stubBridge();
    const a = playback.holdNativeOutput();
    const b = playback.holdNativeOutput();
    expect(holds).toEqual([true]);
    a();
    a(); // double release is harmless
    expect(holds).toEqual([true]);
    b();
    expect(holds).toEqual([true, false]);
    expect(playback.nativeOutputHoldCount()).toBe(0);
  });
});

describe('without a bridge (a real browser)', () => {
  it('uses an element', () => {
    const player = newPlayer();
    player.play(blob());

    expect(elements).toBe(1);
    expect(calls).toHaveLength(0);
    expect(playback.nativeBridgeVersion()).toBe(0);
  });

  it('holding the output is a no-op', () => {
    const release = playback.holdNativeOutput();
    expect(() => release()).not.toThrow();
  });
});
