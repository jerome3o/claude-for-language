/**
 * Reader page narration → waveform peaks + phrase blocks, decoded on the device
 * and cached per clip in IndexedDB (`readerAudioBlocks`), so the scrubber draws
 * its blocks instantly and offline. The segmentation itself is the shared pure
 * `segmentAudioBlocks` (shared/reader/audioBlocks.ts; the Lab app runs the same
 * rules, parity-tested). An undecodable clip → one block, the old behaviour.
 */

import { db, type LocalReaderAudioBlocks } from '../db/database';
import {
  AUDIO_BLOCKS_VERSION,
  clipDurationMs,
  rmsEnvelope,
  segmentAudioBlocks,
  type AudioBlock,
} from '@shared/reader/audioBlocks';

export const WAVE_BUCKETS = 96;

export interface ClipAnalysis {
  durationMs: number;
  /** Per-bucket peak amplitudes (0..1) for drawing; null when the clip couldn't be decoded. */
  peaks: number[] | null;
  blocks: AudioBlock[];
}

/** Per-bucket peaks (0..1) of mono PCM. */
export function peaksOf(data: ArrayLike<number>, buckets = WAVE_BUCKETS): number[] {
  const bucketSize = Math.max(1, Math.floor(data.length / buckets));
  const peaks: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const start = b * bucketSize;
    const end = Math.min(data.length, start + bucketSize);
    // Every 4th value is plenty for a peak
    for (let i = start; i < end; i += 4) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  const max = Math.max(0.01, ...peaks);
  return peaks.map(p => p / max);
}

/** Decode a clip (WebAudio) into peaks + blocks; null when it can't be decoded. */
export async function decodeClip(blob: Blob): Promise<ClipAnalysis | null> {
  try {
    const bytes = await blob.arrayBuffer();
    const Offline = window.OfflineAudioContext
      ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    let decoded: AudioBuffer;
    if (Offline) {
      // No audio device needed; resamples to 44.1 kHz, which the 10 ms frames don't mind
      decoded = await new Offline(1, 1, 44100).decodeAudioData(bytes);
    } else {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      try {
        decoded = await ctx.decodeAudioData(bytes);
      } finally {
        void ctx.close().catch(() => {});
      }
    }
    const data = decoded.getChannelData(0);
    const durationMs = clipDurationMs(data.length, decoded.sampleRate);
    return {
      durationMs,
      peaks: peaksOf(data),
      blocks: segmentAudioBlocks(rmsEnvelope(data, decoded.sampleRate), durationMs),
    };
  } catch {
    return null;
  }
}

/**
 * Cache-first analysis of a page clip. `key` is the clip's TTS cache key
 * (`readerTtsKey`); a different blob size means the clip was regenerated.
 */
export async function analyzeReaderClip(key: string, blob: Blob): Promise<ClipAnalysis | null> {
  try {
    const cached = await db.readerAudioBlocks.get(key);
    if (cached && cached.size === blob.size && cached.version === AUDIO_BLOCKS_VERSION && cached.blocks.length > 0) {
      return { durationMs: cached.duration_ms, peaks: cached.peaks, blocks: cached.blocks };
    }
  } catch {
    // IndexedDB unavailable — decode without caching
  }
  const analysis = await decodeClip(blob);
  if (!analysis || analysis.blocks.length === 0) return null;
  const row: LocalReaderAudioBlocks = {
    key,
    size: blob.size,
    version: AUDIO_BLOCKS_VERSION,
    duration_ms: analysis.durationMs,
    peaks: analysis.peaks,
    blocks: analysis.blocks,
    analyzed_at: Date.now(),
  };
  await db.readerAudioBlocks.put(row).catch(() => {});
  return analysis;
}
