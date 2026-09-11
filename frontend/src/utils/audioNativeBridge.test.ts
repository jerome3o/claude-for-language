import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AudioPlayer } from './audioPlayback';
import type { AudioClipRecord } from './audioDiagnostics';

/**
 * In the Android app, clips go to the native bridge (window.AndroidAudio) and
 * play outside the WebView. The bridge is a tiny synchronous interface that
 * reports back through window events; the player has to route those to the
 * right clip, ignore stale ones, and fall back to an element when the bridge
 * is missing or refuses.
 */

interface BridgeCall {
  id: number;
  source: string;
}

let calls: BridgeCall[] = [];
let stops: number[] = [];
let accept = true;
let elements = 0;

function stubBridge() {
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

function emit(id: number, event: 'play' | 'ended' | 'error') {
  window.dispatchEvent(new CustomEvent('android-audio', { detail: { id, event } }));
}

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
// The blob is turned into a data: URL asynchronously before the bridge is called.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  calls = [];
  stops = [];
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

describe('native audio bridge', () => {
  it('hands a cached clip to the bridge as a data URL, not to an element', async () => {
    stubBridge();
    const player = newPlayer();
    player.play(blob(), { label: 'note' });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe(`data:audio/mpeg;base64,${btoa('audio-bytes')}`);
    expect(elements).toBe(0);
  });

  it('passes a streamed URL straight through', () => {
    stubBridge();
    const player = newPlayer();
    player.play('https://x.test/api/audio/a.mp3');

    expect(calls).toEqual([{ id: 1, source: 'https://x.test/api/audio/a.mp3' }]);
  });

  it('drives the handlers from the bridge events and records the clip', async () => {
    stubBridge();
    const player = newPlayer();
    const onPlay = vi.fn();
    const onEnded = vi.fn();
    player.play(blob(), { label: 'note', onPlay, onEnded });
    await settle();
    expect(playback.isAudioPlaying()).toBe(true);

    emit(calls[0].id, 'play');
    expect(onPlay).toHaveBeenCalledTimes(1);
    emit(calls[0].id, 'ended');
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(playback.isAudioPlaying()).toBe(false);

    const [record] = getAudioRecords();
    expect(record.engine).toBe('native');
    expect(record.label).toBe('note');
    expect(record.ended).toBe(true);
    expect(record.start_ms).not.toBeNull();
  });

  it('reports a bridge error as a playback error', async () => {
    stubBridge();
    const player = newPlayer();
    const onError = vi.fn();
    player.play(blob(), { onError });
    await settle();

    emit(calls[0].id, 'error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(playback.isAudioPlaying()).toBe(false);
    expect(getAudioRecords()[0].error).toBe('native-error');
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

  it('ignores events for a clip that has been superseded', async () => {
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

  it('uses an element when there is no bridge (a real browser)', () => {
    const player = newPlayer();
    player.play(blob());

    expect(elements).toBe(1);
    expect(calls).toHaveLength(0);
  });
});
