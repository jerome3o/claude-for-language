/**
 * Reader narration phrase blocks (shared/reader/audioBlocks.ts) and the scrubber's restart
 * point state machine (shared/reader/blockPlayback.ts). Writes reader-blocks.json; core
 * ReaderBlocksParityTest asserts AudioBlocks.kt / BlockPlayback.kt match exactly:
 * - rmsEnvelope over seeded float32 PCM;
 * - silenceThreshold / segmentAudioBlocks over synthetic speech-and-pause envelopes and the
 *   real TTS clip envelopes in shared/reader/__fixtures__;
 * - blockPlayback over random event sequences on random block layouts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  rmsEnvelope,
  clipDurationMs,
  silenceThreshold,
  segmentAudioBlocks,
  type AudioBlock,
} from '../../../shared/reader/audioBlocks';
import {
  blockPlayback,
  activeBlockIndex,
  INITIAL_BLOCK_PLAY_STATE,
  type BlockPlayEvent,
  type BlockPlayState,
} from '../../../shared/reader/blockPlayback';
import clipsFixture from '../../../shared/reader/__fixtures__/tts-envelopes.json';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: reader-blocks <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(23);
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ---- rmsEnvelope over float32 PCM ----
const pcm = [] as unknown[];
for (let c = 0; c < 12; c++) {
  const sampleRate = [8000, 16000, 22050, 24000, 32000, 44100, 48000][int(0, 6)];
  const count = int(0, 4000);
  const samples = Array.from({ length: count }, () => Math.fround((r() * 2 - 1) * (r() < 0.3 ? 0.002 : 0.6)));
  const frameMs = [10, 10, 20][int(0, 2)];
  pcm.push({ sampleRate, frameMs, samples, envelope: rmsEnvelope(samples, sampleRate, frameMs), durationMs: clipDurationMs(count, sampleRate) });
}

// ---- segmentation over envelopes ----
function synthetic(): { envelope: number[]; durationMs: number } {
  const speech = 0.02 + r() * 0.3;
  const noise = r() < 0.15 ? 0 : 0.00005 + r() * 0.004;
  const env: number[] = [];
  const parts = int(1, 9);
  if (r() < 0.7) for (let i = 0, n = int(0, 40); i < n; i++) env.push(noise * r());
  for (let p = 0; p < parts; p++) {
    for (let i = 0, n = int(20, 700); i < n; i++) env.push(r() < 0.04 ? noise * r() : speech * (0.2 + 0.8 * r()));
    if (p < parts - 1) {
      const pause = int(3, 120);
      for (let i = 0; i < pause; i++) env.push(r() < 0.03 ? speech * r() : noise * r());
    }
  }
  if (r() < 0.7) for (let i = 0, n = int(0, 40); i < n; i++) env.push(noise * r());
  // Durations: usually 10 ms a frame, sometimes a little off (a decoder's partial last frame)
  const durationMs = env.length * 10 + (r() < 0.3 ? int(-9, 9) : 0);
  return { envelope: env, durationMs };
}
const segments = [] as unknown[];
const segCase = (envelope: number[], durationMs: number, name?: string) =>
  segments.push({ name, envelope, durationMs, threshold: silenceThreshold(envelope), blocks: segmentAudioBlocks(envelope, durationMs) });
for (const c of clipsFixture.clips) segCase(c.rms, clipDurationMs(c.sampleCount, c.sampleRate), c.text);
segCase([], 3000);
segCase([], 0);
segCase(Array(200).fill(0), 2000);
segCase([0.1, 0.1, 0.1], 30);
for (let i = 0; i < 160; i++) {
  const { envelope, durationMs } = synthetic();
  segCase(envelope, durationMs);
}

// ---- the restart-point state machine ----
function randomBlocks(): AudioBlock[] {
  const n = int(1, 6);
  const out: AudioBlock[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const len = int(300, 4000);
    out.push({ startMs: at, endMs: at + len });
    at += len;
  }
  return out;
}
const machines = [] as unknown[];
for (let m = 0; m < 150; m++) {
  const blocks = randomBlocks();
  const end = blocks[blocks.length - 1].endMs;
  let state: BlockPlayState = INITIAL_BLOCK_PLAY_STATE;
  let pos = 0;
  const steps = [] as unknown[];
  for (let e = 0; e < 40; e++) {
    const k = r();
    let event: BlockPlayEvent;
    if (state.playing) {
      if (k < 0.45) { pos = Math.min(end, pos + int(20, 1500)); event = { type: 'tick', posMs: pos }; }
      else if (k < 0.62) { pos = Math.min(end, pos + int(0, 1200)); event = { type: 'pause', posMs: pos }; }
      else if (k < 0.68) event = { type: 'ended' };
      else if (k < 0.78) event = { type: 'place', ms: r() * end };
      else if (k < 0.86) event = { type: 'jump', index: int(-1, blocks.length) };
      else event = { type: 'step', dir: r() < 0.5 ? -1 : 1, posMs: pos };
    } else {
      if (k < 0.45) event = { type: 'play' };
      else if (k < 0.65) event = { type: 'place', ms: r() * end };
      else if (k < 0.8) event = { type: 'jump', index: int(-1, blocks.length) };
      else if (k < 0.95) event = { type: 'step', dir: r() < 0.5 ? -1 : 1, posMs: pos };
      else event = { type: 'tick', posMs: pos };
    }
    const result = blockPlayback(state, event, blocks);
    state = result.state;
    if (event.type === 'play' || result.seekToMs !== null) pos = result.seekToMs ?? pos;
    steps.push({ event, state, seekToMs: result.seekToMs, active: activeBlockIndex(state, blocks, pos), pos });
  }
  machines.push({ blocks, steps });
}

writeFileSync(join(OUT, 'reader-blocks.json'), JSON.stringify({ pcm, segments, machines }));
