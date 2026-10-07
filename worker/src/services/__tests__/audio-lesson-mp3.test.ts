import { describe, expect, it } from 'vitest';
import {
  assembleMp3,
  checkClipFormat,
  emptyFrame,
  frameMs,
  framesForMs,
  LESSON_MP3,
  parseMp3Frames,
  readFrameHeader,
  silenceFrames,
} from '../audio-lessons/mp3';

/** A clip as a provider sends it: ID3 tag, a Xing tag frame, then `n` audio frames of `kbps`. */
function clip(n: number, kbps = 48, opts: { id3?: boolean; xing?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (opts.id3) parts.push(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]));
  if (opts.xing) {
    const x = emptyFrame(64);
    x.set([0x58, 0x69, 0x6e, 0x67], 13);
    parts.push(x);
  }
  for (let i = 0; i < n; i++) {
    const f = emptyFrame(kbps);
    f[20] = i & 0xff; // "audio" so frames are distinguishable
    parts.push(f);
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('frames', () => {
  it('the lesson frame: MPEG-2 Layer III, 24 kHz, mono, 24 ms', () => {
    const h = readFrameHeader(emptyFrame(8), 0)!;
    expect(h).toMatchObject({ version: 2, sampleRate: 24000, channelMode: 3, bitrateKbps: 8, size: 24 });
    expect(frameMs()).toBe(24);
    expect(readFrameHeader(emptyFrame(96), 0)!.size).toBe(288);
  });

  it('parses a clip: drops the ID3 tag and the Xing frame, keeps every audio frame whole', () => {
    const p = parseMp3Frames(clip(10, 48, { id3: true, xing: true }));
    expect(p.frames.length).toBe(10);
    expect(p.frames.every((f) => f.length === 144 && f[0] === 0xff)).toBe(true);
    expect(p.frames.map((f) => f[20])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(checkClipFormat(p)).toBeNull();
    expect(p.junk).toBe(0);
  });

  it('skips junk between frames', () => {
    const a = clip(3);
    const withJunk = new Uint8Array(a.length + 5);
    withJunk.set(a.subarray(0, 288), 0);
    withJunk.set([1, 2, 3, 4, 5], 288);
    withJunk.set(a.subarray(288), 293);
    const p = parseMp3Frames(withJunk);
    expect(p.frames.length).toBe(3);
    expect(p.junk).toBe(5);
  });

  it('refuses a clip in another format (MiniMax at 32 kHz, stereo)', () => {
    const mpeg1 = emptyFrame(128, { version: 3, sampleRate: 32000, channelMode: 3 });
    expect(checkClipFormat(parseMp3Frames(mpeg1))).toMatch(/32000 Hz/);
    const stereo = emptyFrame(48, { ...LESSON_MP3, channelMode: 0 });
    expect(checkClipFormat(parseMp3Frames(stereo))).toMatch(/stereo/);
    expect(checkClipFormat(parseMp3Frames(new Uint8Array(100)))).toMatch(/no MP3/);
  });
});

describe('silence', () => {
  it('rounds to whole 24 ms frames', () => {
    expect(framesForMs(1500)).toBe(63);
    expect(silenceFrames(1500).length).toBe(63);
    expect(silenceFrames(0)).toEqual([]);
    expect(silenceFrames(1000)[0].length).toBe(24);
  });
});

describe('assembleMp3', () => {
  const a = parseMp3Frames(clip(50, 48)).frames;
  const b = parseMp3Frames(clip(20, 96)).frames;
  const out = assembleMp3([
    { kind: 'silence', ms: 480 },
    { kind: 'frames', frames: a },
    { kind: 'silence', ms: 1500 },
    { kind: 'frames', frames: b },
  ]);

  it('counts frames, duration and where each part starts', () => {
    expect(out.frameCount).toBe(20 + 50 + 63 + 20);
    expect(out.durationMs).toBe(out.frameCount * 24);
    expect(out.partStartMs).toEqual([0, 480, 480 + 1200, 480 + 1200 + 1512]);
  });

  it('frame boundaries are intact: re-parsing gives the same frames in order', () => {
    const p = parseMp3Frames(out.bytes);
    expect(p.frames.length).toBe(out.frameCount);
    expect(p.junk).toBe(0);
    expect(p.mismatched).toBe(0);
    expect(p.frames[20]).toEqual(a[0]);
    expect(p.frames[20 + 50 + 63 + 19]).toEqual(b[19]);
    expect(p.frames.slice(70, 133).every((f) => f.length === 24)).toBe(true);
  });

  it('starts with ONE Xing header: frame count, byte count and a monotonic seek TOC', () => {
    const head = out.bytes.subarray(0, 192);
    expect(readFrameHeader(head, 0)!.size).toBe(192);
    expect(String.fromCharCode(...head.subarray(13, 17))).toBe('Xing');
    const u32 = (o: number) => ((head[o] << 24) | (head[o + 1] << 16) | (head[o + 2] << 8) | head[o + 3]) >>> 0;
    expect(u32(17)).toBe(7);
    expect(u32(21)).toBe(out.frameCount + 1);
    expect(u32(25)).toBe(out.bytes.length);
    const toc = [...head.subarray(29, 129)];
    expect(toc[0]).toBeGreaterThan(0); // the first audio frame comes after the header
    for (let i = 1; i < 100; i++) expect(toc[i]).toBeGreaterThanOrEqual(toc[i - 1]);
  });
});
