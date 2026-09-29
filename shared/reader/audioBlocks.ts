/**
 * Reader narration split into phrase-sized blocks at the pauses.
 *
 * The page clip is decoded on the device (WebAudio on the web, MediaCodec in the
 * Lab app), reduced to an RMS envelope of 10 ms frames ({@link rmsEnvelope}),
 * and {@link segmentAudioBlocks} finds the silent stretches:
 *
 * 1. An ADAPTIVE threshold from the clip itself: the noise floor (10th
 *    percentile frame) plus 10% of the way up to the speech level (90th
 *    percentile), kept between −45 dB and −15 dB below the speech level. TTS
 *    "silence" is not digital zero (MP3 noise sits around −50…−65 dB) and the
 *    level varies per voice, so a fixed threshold would not do.
 * 2. Quiet runs, bridging blips of ≤ 2 loud frames (a click inside a pause).
 * 3. A pause = an INTERIOR quiet run of ≥ 350 ms (leading / trailing silence
 *    never splits). Measured on real reader / sentence clips: the pauses at
 *    commas and full stops are 0.6–1.6 s, the gaps between words 100–300 ms.
 * 4. The block boundary sits just before the next phrase starts (150 ms of
 *    lead-in, never earlier than the middle of the pause), so replaying a
 *    block starts on a breath, not mid-syllable.
 * 5. Blocks shorter than 0.8 s merge into their shorter neighbour; blocks
 *    longer than 7 s are split at their longest ≥ 150 ms dip (sentence-ish cap).
 *
 * Everything is integer milliseconds and plain arithmetic (no logs / pows), so
 * the Kotlin port (android-lab core `AudioBlocks.kt`) is parity-tested against
 * this file exactly. No silence found / undecodable → one block (the whole clip),
 * which behaves exactly like the old single-anchor scrubber.
 */

export interface AudioBlock {
  /** Inclusive start, ms from the start of the clip. */
  startMs: number;
  /** Exclusive end, ms (the next block's start, or the clip duration). */
  endMs: number;
}

export interface AudioBlockOptions {
  /** Envelope frame length (ms). */
  frameMs: number;
  /** A quiet run at least this long is a pause between blocks. */
  minSilenceMs: number;
  /** Loud frames inside a quiet run that are still counted as quiet. */
  bridgeFrames: number;
  /** Blocks shorter than this merge into a neighbour. */
  minBlockMs: number;
  /** Blocks longer than this are split at their longest shorter dip. */
  maxBlockMs: number;
  /** The shortest dip a too-long block may be split at. */
  splitSilenceMs: number;
  /** Lead-in kept before the next phrase's onset. */
  leadMs: number;
  /** Where between the noise floor and the speech level the threshold sits (0..1). */
  thresholdMix: number;
}

export const DEFAULT_AUDIO_BLOCK_OPTIONS: AudioBlockOptions = {
  frameMs: 10,
  minSilenceMs: 350,
  bridgeFrames: 2,
  minBlockMs: 800,
  maxBlockMs: 7000,
  splitSilenceMs: 150,
  leadMs: 150,
  thresholdMix: 0.1,
};

/** Bump when the segmentation changes, so cached boundaries are recomputed. */
export const AUDIO_BLOCKS_VERSION = 1;

/** −15 dB and −45 dB as amplitude ratios (10^(−15/20), 10^(−45/20)). */
const MAX_BELOW_SPEECH = 0.1778279410038923;
const MIN_BELOW_SPEECH = 0.005623413251903491;

/**
 * RMS of each `frameMs` frame of mono PCM (−1..1). The last frame may be
 * partial. Sums in double precision in sample order (the Kotlin port does the same).
 */
export function rmsEnvelope(samples: ArrayLike<number>, sampleRate: number, frameMs = DEFAULT_AUDIO_BLOCK_OPTIONS.frameMs): number[] {
  const out: number[] = [];
  if (!(sampleRate > 0) || samples.length === 0) return out;
  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sum += v * v;
    }
    out.push(Math.sqrt(sum / (end - start)));
  }
  return out;
}

/** Clip length in whole ms from a sample count. */
export function clipDurationMs(sampleCount: number, sampleRate: number): number {
  if (!(sampleRate > 0)) return 0;
  return Math.round((sampleCount * 1000) / sampleRate);
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))];
}

/** The adaptive quiet threshold for an envelope (0 when the clip is silent). */
export function silenceThreshold(envelope: number[], options: Partial<AudioBlockOptions> = {}): number {
  const o = { ...DEFAULT_AUDIO_BLOCK_OPTIONS, ...options };
  if (envelope.length === 0) return 0;
  const sorted = [...envelope].sort((a, b) => a - b);
  const floor = quantile(sorted, 0.1);
  const speech = quantile(sorted, 0.9);
  if (!(speech > 0)) return 0;
  let thr = floor + o.thresholdMix * (speech - floor);
  thr = Math.min(thr, speech * MAX_BELOW_SPEECH);
  thr = Math.max(thr, speech * MIN_BELOW_SPEECH);
  return thr;
}

/** A quiet run as frame indices [start, end). */
export interface QuietRun {
  start: number;
  end: number;
}

/** Runs of frames below `threshold`, joined across ≤ `bridgeFrames` loud frames. */
export function quietRuns(envelope: number[], threshold: number, bridgeFrames: number): QuietRun[] {
  const raw: QuietRun[] = [];
  let i = 0;
  while (i < envelope.length) {
    if (envelope[i] < threshold) {
      const start = i;
      while (i < envelope.length && envelope[i] < threshold) i++;
      raw.push({ start, end: i });
    } else {
      i++;
    }
  }
  const merged: QuietRun[] = [];
  for (const run of raw) {
    const last = merged[merged.length - 1];
    if (last && run.start - last.end <= bridgeFrames) last.end = run.end;
    else merged.push({ start: run.start, end: run.end });
  }
  return merged;
}

function boundaryFor(run: QuietRun, o: AudioBlockOptions): number {
  const startMs = run.start * o.frameMs;
  const endMs = run.end * o.frameMs;
  return Math.max(Math.floor((startMs + endMs) / 2), endMs - o.leadMs);
}

function blocksFrom(boundaries: number[], durationMs: number): AudioBlock[] {
  const starts = [0, ...boundaries];
  return starts.map((s, i) => ({ startMs: s, endMs: i + 1 < starts.length ? starts[i + 1] : durationMs }));
}

/** Merge blocks shorter than `minBlockMs` into their shorter neighbour, shortest first. */
function mergeShort(blocks: AudioBlock[], minBlockMs: number): AudioBlock[] {
  const out = blocks.map((b) => ({ ...b }));
  while (out.length > 1) {
    let shortest = -1;
    for (let i = 0; i < out.length; i++) {
      const len = out[i].endMs - out[i].startMs;
      if (len < minBlockMs && (shortest < 0 || len < out[shortest].endMs - out[shortest].startMs)) shortest = i;
    }
    if (shortest < 0) break;
    let into: number;
    if (shortest === 0) into = 1;
    else if (shortest === out.length - 1) into = shortest - 1;
    else {
      const prev = out[shortest - 1].endMs - out[shortest - 1].startMs;
      const next = out[shortest + 1].endMs - out[shortest + 1].startMs;
      into = next < prev ? shortest + 1 : shortest - 1;
    }
    const a = Math.min(shortest, into);
    out.splice(a, 2, { startMs: out[a].startMs, endMs: out[a + 1].endMs });
  }
  return out;
}

/** Split a too-long block at its longest dip (≥ splitSilenceMs), recursively. */
function splitLong(block: AudioBlock, runs: QuietRun[], o: AudioBlockOptions, out: AudioBlock[]): void {
  if (block.endMs - block.startMs <= o.maxBlockMs) {
    out.push(block);
    return;
  }
  const mid = (block.startMs + block.endMs) / 2;
  let best: { b: number; len: number; dist: number } | null = null;
  for (const run of runs) {
    const len = (run.end - run.start) * o.frameMs;
    if (len < o.splitSilenceMs) continue;
    if (run.start * o.frameMs <= block.startMs || run.end * o.frameMs >= block.endMs) continue;
    const b = boundaryFor(run, o);
    if (b - block.startMs < o.minBlockMs || block.endMs - b < o.minBlockMs) continue;
    const dist = Math.abs(b - mid);
    if (!best || len > best.len || (len === best.len && dist < best.dist)) best = { b, len, dist };
  }
  if (!best) {
    out.push(block);
    return;
  }
  splitLong({ startMs: block.startMs, endMs: best.b }, runs, o, out);
  splitLong({ startMs: best.b, endMs: block.endMs }, runs, o, out);
}

/**
 * The clip's blocks from its RMS envelope. Always covers [0, durationMs]
 * contiguously; one block when no pause is found (or the clip is silent).
 */
export function segmentAudioBlocks(envelope: number[], durationMs: number, options: Partial<AudioBlockOptions> = {}): AudioBlock[] {
  const o = { ...DEFAULT_AUDIO_BLOCK_OPTIONS, ...options };
  const duration = Math.max(0, Math.round(durationMs));
  if (duration === 0) return [];
  const whole = [{ startMs: 0, endMs: duration }];
  if (envelope.length === 0) return whole;
  const thr = silenceThreshold(envelope, o);
  if (!(thr > 0)) return whole;

  const runs = quietRuns(envelope, thr, o.bridgeFrames);
  const n = envelope.length;
  const boundaries: number[] = [];
  for (const run of runs) {
    if (run.start === 0 || run.end >= n) continue; // leading / trailing silence
    if ((run.end - run.start) * o.frameMs < o.minSilenceMs) continue;
    const b = boundaryFor(run, o);
    if (b <= 0 || b >= duration) continue;
    if (boundaries.length > 0 && b <= boundaries[boundaries.length - 1]) continue;
    boundaries.push(b);
  }

  const merged = mergeShort(blocksFrom(boundaries, duration), o.minBlockMs);
  const interior = runs.filter((r) => r.start > 0 && r.end < n);
  const out: AudioBlock[] = [];
  for (const block of merged) splitLong(block, interior, o, out);
  return out;
}

/** The index of the block containing `ms` (clamped to the first / last block). */
export function blockIndexAt(blocks: AudioBlock[], ms: number): number {
  let idx = 0;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].startMs <= ms) idx = i;
    else break;
  }
  return idx;
}
