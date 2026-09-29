import { describe, it, expect } from 'vitest';
import {
  rmsEnvelope,
  clipDurationMs,
  silenceThreshold,
  quietRuns,
  segmentAudioBlocks,
  blockIndexAt,
  type AudioBlock,
} from './audioBlocks';
import fixture from './__fixtures__/tts-envelopes.json';

/** A synthetic 10 ms envelope: [kind, ms] segments; speech wobbles, silence has MP3-like noise. */
function envelope(parts: Array<['speech' | 'pause', number]>, noise = 0.0008, speech = 0.1): number[] {
  const out: number[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const [kind, ms] of parts) {
    for (let i = 0; i < ms / 10; i++) {
      out.push(kind === 'speech' ? speech * (0.3 + 0.7 * Math.abs(Math.sin(out.length / 4))) : noise * (0.5 + rand()));
    }
  }
  return out;
}

const total = (parts: Array<[string, number]>) => parts.reduce((s, [, ms]) => s + ms, 0);

function contiguous(blocks: AudioBlock[], duration: number) {
  expect(blocks[0].startMs).toBe(0);
  expect(blocks[blocks.length - 1].endMs).toBe(duration);
  for (let i = 1; i < blocks.length; i++) expect(blocks[i].startMs).toBe(blocks[i - 1].endMs);
}

describe('rmsEnvelope', () => {
  it('computes the RMS of each 10 ms frame, the last one partial', () => {
    const samples = [...Array(10).fill(0.5), ...Array(10).fill(-0.25), 1, 1, 1];
    // 1 kHz → 10 samples a frame
    expect(rmsEnvelope(samples, 1000)).toEqual([0.5, 0.25, 1]);
  });
  it('is empty for no samples or a bad rate', () => {
    expect(rmsEnvelope([], 44100)).toEqual([]);
    expect(rmsEnvelope([0.1], 0)).toEqual([]);
  });
  it('rounds the duration to whole ms', () => {
    expect(clipDurationMs(347648, 44100)).toBe(7883);
    expect(clipDurationMs(10, 0)).toBe(0);
  });
});

describe('silenceThreshold / quietRuns', () => {
  it('sits between the noise floor and the speech level', () => {
    const env = envelope([['pause', 300], ['speech', 2000], ['pause', 600], ['speech', 2000], ['pause', 300]]);
    const thr = silenceThreshold(env);
    expect(thr).toBeGreaterThan(0.0015);
    expect(thr).toBeLessThan(0.02);
  });
  it('is 0 for digital silence', () => {
    expect(silenceThreshold(Array(100).fill(0))).toBe(0);
  });
  it('bridges one or two loud frames inside a pause', () => {
    const env = [1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1];
    expect(quietRuns(env, 0.5, 2)).toEqual([{ start: 2, end: 8 }, { start: 11, end: 12 }]);
    expect(quietRuns(env, 0.5, 0)).toEqual([{ start: 2, end: 5 }, { start: 6, end: 8 }, { start: 11, end: 12 }]);
  });
});

describe('segmentAudioBlocks', () => {
  it('splits at pauses of 350 ms or more, never at leading / trailing silence', () => {
    const parts: Array<['speech' | 'pause', number]> = [['pause', 250], ['speech', 1800], ['pause', 700], ['speech', 2200], ['pause', 500], ['speech', 1500], ['pause', 400]];
    const d = total(parts);
    const blocks = segmentAudioBlocks(envelope(parts), d);
    contiguous(blocks, d);
    // Boundaries 150 ms before the next phrase: 250+1800+700-150, then 2750+2200+500-150
    expect(blocks.map((b) => b.startMs)).toEqual([0, 2600, 5300]);
  });

  it('ignores the short gaps between words', () => {
    const parts: Array<['speech' | 'pause', number]> = [['speech', 900], ['pause', 200], ['speech', 800], ['pause', 300], ['speech', 1200]];
    expect(segmentAudioBlocks(envelope(parts), total(parts))).toHaveLength(1);
  });

  it('keeps the boundary no earlier than the middle of a short pause', () => {
    const parts: Array<['speech' | 'pause', number]> = [['speech', 1500], ['pause', 360], ['speech', 1500]];
    // Pause 1500..1860: the middle is 1680, onset − lead is 1710 → 1710
    expect(segmentAudioBlocks(envelope(parts), total(parts)).map((b) => b.startMs)).toEqual([0, 1710]);
  });

  it('merges blocks shorter than 0.8 s into the shorter neighbour', () => {
    const parts: Array<['speech' | 'pause', number]> = [['speech', 2000], ['pause', 400], ['speech', 300], ['pause', 400], ['speech', 3000]];
    const d = total(parts);
    const blocks = segmentAudioBlocks(envelope(parts), d);
    contiguous(blocks, d);
    expect(blocks).toHaveLength(2);
    // The 300 ms word (+ its pauses) joins the 2 s phrase before it, not the 3 s one after
    expect(blocks[0].endMs).toBe(2000 + 400 + 300 + 400 - 150);
  });

  it('splits a block longer than 7 s at its longest shorter dip', () => {
    const parts: Array<['speech' | 'pause', number]> = [['speech', 3000], ['pause', 200], ['speech', 2500], ['pause', 250], ['speech', 3000]];
    const d = total(parts);
    const blocks = segmentAudioBlocks(envelope(parts), d);
    contiguous(blocks, d);
    expect(blocks).toHaveLength(2);
    // The 250 ms dip (5700–5950) wins over the 200 ms one; its middle (5825) is later than onset − lead
    expect(blocks[1].startMs).toBe(5825);
  });

  it('falls back to one block: no pauses, silence, no envelope', () => {
    expect(segmentAudioBlocks(envelope([['speech', 4000]]), 4000)).toEqual([{ startMs: 0, endMs: 4000 }]);
    expect(segmentAudioBlocks(Array(300).fill(0), 3000)).toEqual([{ startMs: 0, endMs: 3000 }]);
    expect(segmentAudioBlocks([], 3000)).toEqual([{ startMs: 0, endMs: 3000 }]);
    expect(segmentAudioBlocks([], 0)).toEqual([]);
  });

  it('finds the phrases in real TTS clips', () => {
    const got = Object.fromEntries(
      fixture.clips.map((c) => [c.text, segmentAudioBlocks(c.rms, clipDurationMs(c.sampleCount, c.sampleRate)).map((b) => b.startMs)]),
    );
    // One short sentence, no pause: one block
    expect(got['咱们一边吃一边聊吧']).toEqual([0]);
    // 我喜欢 / 一边跑步 / 一边听音乐
    expect(got['我喜欢一边跑步，一边听音乐。']).toEqual([0, 3020, 5940]);
    // 我们 / 一边吃晚饭 / 一边练习说中文 — the 300 ms dip before 说中文 does not split
    expect(got['我们一边吃晚饭，一边练习说中文。']).toEqual([0, 1480, 3820]);
  });
});

describe('blockIndexAt', () => {
  const blocks = [{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2500 }, { startMs: 2500, endMs: 4000 }];
  it('finds the block containing a time, clamped', () => {
    expect(blockIndexAt(blocks, -5)).toBe(0);
    expect(blockIndexAt(blocks, 999)).toBe(0);
    expect(blockIndexAt(blocks, 1000)).toBe(1);
    expect(blockIndexAt(blocks, 9999)).toBe(2);
  });
});
