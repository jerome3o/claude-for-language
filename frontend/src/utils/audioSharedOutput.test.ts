import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AudioPlayer } from './audioPlayback';
import type { AudioClipRecord } from './audioDiagnostics';

/**
 * Card clips play through one shared AudioContext so the device's audio output
 * is opened once per session rather than re-acquired around every clip. The
 * element remains the fallback, and must take over rather than leaving the user
 * in silence.
 */

interface FakeNode {
  buffer: unknown;
  onended: (() => void) | null;
  connected: boolean;
  started: boolean;
  stopped: boolean;
  connect: () => void;
  disconnect: () => void;
  start: () => void;
  stop: () => void;
}

let nodes: FakeNode[] = [];
let contexts: number;
let decodeShouldFail: boolean;
let elements: number;

function makeNode(): FakeNode {
  const node: FakeNode = {
    buffer: null,
    onended: null,
    connected: false,
    started: false,
    stopped: false,
    connect: () => { node.connected = true; },
    disconnect: () => { node.connected = false; },
    start: () => { node.started = true; },
    stop: () => { node.stopped = true; },
  };
  nodes.push(node);
  return node;
}

function stubAudioContext() {
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    destination = {};
    constructor() { contexts++; }
    resume() { return Promise.resolve(); }
    decodeAudioData() {
      return decodeShouldFail
        ? Promise.reject(new Error('undecodable'))
        : Promise.resolve({ duration: 1.5 });
    }
    createBufferSource() { return makeNode(); }
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

// The shared context is a module-level singleton — correct for the app, but it
// would carry between tests, so each test gets a fresh module registry.
let playback: typeof import('./audioPlayback');
let diagnostics: typeof import('./audioDiagnostics');

const players: AudioPlayer[] = [];
function newPlayer(): AudioPlayer {
  const player = playback.createAudioPlayer();
  players.push(player);
  return player;
}

const isAudioPlaying = () => playback.isAudioPlaying();
const getAudioRecords = (): AudioClipRecord[] => diagnostics.getAudioRecords();

const blob = () => new Blob(['audio'], { type: 'audio/mpeg' });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  nodes = [];
  contexts = 0;
  elements = 0;
  decodeShouldFail = false;
  stubAudioElement();
  vi.resetModules();
  playback = await import('./audioPlayback');
  diagnostics = await import('./audioDiagnostics');
});

afterEach(() => {
  players.splice(0).forEach(player => player.dispose());
  vi.unstubAllGlobals();
});

describe('shared audio output', () => {
  it('plays a cached clip through the context, not an element', async () => {
    stubAudioContext();
    const player = newPlayer();
    player.play(blob(), { label: 'note' });
    await settle();

    expect(nodes).toHaveLength(1);
    expect(nodes[0].started).toBe(true);
    expect(nodes[0].connected).toBe(true);
    expect(elements).toBe(0);
  });

  it('opens the output once across many clips', async () => {
    stubAudioContext();
    const player = newPlayer();
    for (let i = 0; i < 5; i++) {
      player.play(blob());
      await settle();
    }
    expect(contexts).toBe(1);
    expect(nodes).toHaveLength(5);
  });

  it('records the clip as played by the shared output', async () => {
    stubAudioContext();
    const player = newPlayer();
    player.play(blob(), { label: 'note' });
    await settle();
    nodes[0].onended?.();

    const [record] = getAudioRecords();
    expect(record.engine).toBe('webaudio');
    expect(record.label).toBe('note');
    expect(record.duration_s).toBe(1.5);
    expect(record.ended).toBe(true);
    expect(record.start_ms).not.toBeNull();
  });

  it('reports ending, and goes idle for background work', async () => {
    stubAudioContext();
    const player = newPlayer();
    const onEnded = vi.fn();
    player.play(blob(), { onEnded });
    await settle();
    expect(isAudioPlaying()).toBe(true);

    nodes[0].onended?.();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(isAudioPlaying()).toBe(false);
  });

  it('stops the scheduled buffer on stop()', async () => {
    stubAudioContext();
    const player = newPlayer();
    player.play(blob());
    await settle();

    player.stop();
    expect(nodes[0].stopped).toBe(true);
    expect(nodes[0].connected).toBe(false);
    expect(isAudioPlaying()).toBe(false);
  });

  it('ignores a buffer that finishes after being superseded', async () => {
    stubAudioContext();
    const player = newPlayer();
    const first = vi.fn();
    player.play(blob(), { onEnded: first });
    await settle();
    const stale = nodes[0];

    player.play(blob());
    await settle();
    stale.onended?.();
    expect(first).not.toHaveBeenCalled();
  });

  it('falls back to an element when Web Audio is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const player = newPlayer();
    player.play(blob());
    await settle();

    expect(nodes).toHaveLength(0);
    expect(elements).toBe(1);
  });

  it('falls back to an element when the clip will not decode', async () => {
    stubAudioContext();
    decodeShouldFail = true;
    const player = newPlayer();
    player.play(blob());
    await settle();

    expect(nodes).toHaveLength(0);
    expect(elements).toBe(1);
  });

  it('streams a URL through the element rather than the context', async () => {
    stubAudioContext();
    const player = newPlayer();
    player.play('https://example.test/clip.mp3');
    await settle();

    expect(nodes).toHaveLength(0);
    expect(elements).toBe(1);
  });
});
