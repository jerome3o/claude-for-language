/**
 * The reader's playback speed (shared/reader/speed.ts) and the scrubber's restart-point state
 * machine run with the speed-scaled grace (blockGraceMsAt → shared/reader/blockPlayback.ts).
 * Writes reader-speed.json; core ReaderSpeedParityTest asserts ReaderSpeed.kt / BlockPlayback.kt
 * match exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  READER_SPEEDS,
  parseReaderSpeed,
  nextReaderSpeed,
  readerSpeedLabel,
  blockGraceMsAt,
} from '../../../shared/reader/speed';
import {
  blockPlayback,
  activeBlockIndex,
  INITIAL_BLOCK_PLAY_STATE,
  type BlockPlayEvent,
  type BlockPlayState,
} from '../../../shared/reader/blockPlayback';
import type { AudioBlock } from '../../../shared/reader/audioBlocks';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: reader-speed <out-dir>');
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
const r = rng(75);
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ---- stored values → speed, the chip's cycle, labels, the grace ----
const raws: Array<string | number | null> = [
  null, '', ' ', '1', '0.75', '0.5', ' 0.5 ', '0.50', '.5', '+0.75', '5e-1', '75e-2', '1.0', '1e0',
  '0.6', '2', '-0.5', 'fast', '0.5x', '0.5f', 'NaN', 'Infinity', '0.75.', '1/2',
  1, 0.75, 0.5, 0, 2, 0.25, -1, 0.7500000001,
];
const parse = raws.map(raw => ({ raw, speed: parseReaderSpeed(raw) }));
const speeds = [...READER_SPEEDS, 2, 0, 0.6].map(s => ({
  speed: s,
  next: nextReaderSpeed(s),
  label: readerSpeedLabel(s),
  grace: blockGraceMsAt(s),
}));

// ---- the state machine at each speed (only the grace differs) ----
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
for (let m = 0; m < 180; m++) {
  const speed = READER_SPEEDS[m % READER_SPEEDS.length];
  const grace = blockGraceMsAt(speed);
  const blocks = randomBlocks();
  const end = blocks[blocks.length - 1].endMs;
  let state: BlockPlayState = INITIAL_BLOCK_PLAY_STATE;
  let pos = 0;
  const steps = [] as unknown[];
  for (let e = 0; e < 40; e++) {
    const k = r();
    let event: BlockPlayEvent;
    if (state.playing) {
      // Ticks move playback on (crossing into later blocks)
      if (k < 0.45) { pos = Math.min(end, pos + int(20, 1500)); event = { type: 'tick', posMs: pos }; }
      // Pause hops around the grace (500 / 750 / 1000 ms of media), so both sides of it occur
      else if (k < 0.65) { pos = Math.min(end, pos + int(0, Math.round(grace * 1.5))); event = { type: 'pause', posMs: pos }; }
      else if (k < 0.7) event = { type: 'ended' };
      else if (k < 0.78) event = { type: 'place', ms: r() * end };
      else if (k < 0.85) event = { type: 'jump', index: int(-1, blocks.length) };
      else event = { type: 'step', dir: r() < 0.5 ? -1 : 1, posMs: Math.min(end, pos + int(0, 1100)) };
    } else {
      if (k < 0.5) event = { type: 'play' };
      else if (k < 0.65) event = { type: 'place', ms: r() * end };
      else if (k < 0.8) event = { type: 'jump', index: int(-1, blocks.length) };
      else event = { type: 'step', dir: r() < 0.5 ? -1 : 1, posMs: pos };
    }
    const result = blockPlayback(state, event, blocks, grace);
    state = result.state;
    if (event.type === 'play' || result.seekToMs !== null) pos = result.seekToMs ?? pos;
    steps.push({ event, state, seekToMs: result.seekToMs, active: activeBlockIndex(state, blocks, pos), pos });
  }
  machines.push({ speed, blocks, steps });
}

writeFileSync(join(OUT, 'reader-speed.json'), JSON.stringify({ parse, speeds, machines }));
