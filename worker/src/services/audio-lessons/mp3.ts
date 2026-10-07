/**
 * MP3 assembly for audio lessons (docs/AUDIO_LESSONS.md "Rendering"), pure and
 * Worker-safe: no decoder, no ffmpeg — MP3 frames are independent enough to be
 * concatenated as long as every frame shares ONE sample rate, MPEG version and
 * channel mode. The lesson format is MPEG-2 Layer III, 24 kHz, mono
 * (`LESSON_MP3`), which every provider can give us: Azure's
 * `audio-24khz-96kbitrate-mono-mp3`, Google's `sampleRateHertz: 24000`,
 * MiniMax's `sample_rate: 24000`.
 *
 * - `parseMp3Frames` walks a clip: skips ID3v2 / ID3v1, drops a Xing / Info /
 *   VBRI tag frame (a tag in the middle of a file would make a player think the
 *   lesson is as long as that one clip), checks every frame's format.
 * - `silenceFrames(ms)` makes digital silence: 8 kbps frames whose side info is
 *   all zero (no Huffman data → every sample 0). 24 ms each at 24 kHz.
 * - `assembleMp3` joins clips and silences and puts ONE Xing header frame in
 *   front (frame count, byte count, 100-entry seek TOC), so the duration is exact
 *   and seeking works in Chrome, Android MediaPlayer and ExoPlayer even though
 *   the frames' bitrates differ (8 kbps silence, 48–128 kbps speech).
 *
 * The first audio frame of every clip has main_data_begin = 0 (an encoder starts
 * with an empty bit reservoir), and silence frames use none, so no frame ever
 * borrows bits from a frame that isn't its real predecessor.
 */

export interface Mp3Format {
  /** 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5 (the header's version bits). */
  version: number;
  sampleRate: number;
  /** 3 = mono. */
  channelMode: number;
}

/** The one format every lesson file is made of. */
export const LESSON_MP3: Mp3Format = { version: 2, sampleRate: 24000, channelMode: 3 };

/** Samples per Layer III frame: 1152 for MPEG-1, 576 for MPEG-2 / 2.5. */
export function samplesPerFrame(version: number): number {
  return version === 3 ? 1152 : 576;
}

/** Duration of one frame in ms (24 for the lesson format). */
export function frameMs(fmt: Mp3Format = LESSON_MP3): number {
  return (samplesPerFrame(fmt.version) * 1000) / fmt.sampleRate;
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

export interface Mp3FrameHeader extends Mp3Format {
  bitrateKbps: number;
  padding: number;
  /** Bytes incl. the 4-byte header. */
  size: number;
  hasCrc: boolean;
}

/** Decode a Layer III frame header at `o`, or null when it isn't one. */
export function readFrameHeader(b: Uint8Array, o: number): Mp3FrameHeader | null {
  if (o + 4 > b.length) return null;
  if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[o + 1] >> 3) & 0x03;
  const layer = (b[o + 1] >> 1) & 0x03;
  if (version === 1 || layer !== 1) return null; // reserved version / not Layer III
  const hasCrc = (b[o + 1] & 0x01) === 0;
  const bitrateIndex = (b[o + 2] >> 4) & 0x0f;
  const sampleIndex = (b[o + 2] >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const padding = (b[o + 2] >> 1) & 0x01;
  const channelMode = (b[o + 3] >> 6) & 0x03;
  const sampleRate = SAMPLE_RATES[version][sampleIndex];
  const bitrateKbps = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex];
  const coeff = version === 3 ? 144 : 72;
  const size = Math.floor((coeff * bitrateKbps * 1000) / sampleRate) + padding;
  return { version, sampleRate, channelMode, bitrateKbps, padding, size, hasCrc };
}

/** Where the side info ends (= where a Xing / Info tag starts) in a frame. */
function sideInfoEnd(h: Mp3FrameHeader): number {
  const mono = h.channelMode === 3;
  const side = h.version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  return 4 + (h.hasCrc ? 2 : 0) + side;
}

function tagAt(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

export interface ParsedMp3 {
  /** Audio frames only (tags and tag frames removed), each a view into the input. */
  frames: Uint8Array[];
  format: Mp3Format | null;
  bytes: number;
  /** Frames whose format differs from the first audio frame's. */
  mismatched: number;
  /** Bytes skipped that were neither a tag nor a frame (junk between frames). */
  junk: number;
}

function id3v2Size(b: Uint8Array, o: number): number {
  if (o + 10 > b.length || b[o] !== 0x49 || b[o + 1] !== 0x44 || b[o + 2] !== 0x33) return 0;
  const size = ((b[o + 6] & 0x7f) << 21) | ((b[o + 7] & 0x7f) << 14) | ((b[o + 8] & 0x7f) << 7) | (b[o + 9] & 0x7f);
  const footer = (b[o + 5] & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

/** Split an MP3 clip into its audio frames. */
export function parseMp3Frames(b: Uint8Array): ParsedMp3 {
  let o = 0;
  // One or more ID3v2 tags in front.
  for (let tag = id3v2Size(b, o); tag > 0; tag = id3v2Size(b, o)) o += tag;
  let end = b.length;
  if (end >= 128 && b[end - 128] === 0x54 && b[end - 127] === 0x41 && b[end - 126] === 0x47) end -= 128; // ID3v1 "TAG"

  const frames: Uint8Array[] = [];
  let format: Mp3Format | null = null;
  let mismatched = 0;
  let junk = 0;
  let bytes = 0;
  let first = true;
  while (o < end) {
    const h = readFrameHeader(b, o);
    // A real frame is followed by another frame (or the end): guards against a false sync in junk.
    const next = h ? o + h.size : -1;
    // (Or, once the clip's format is known, a frame of that format: junk may follow a real frame.)
    const sameFormat = !!h && !!format && h.version === format.version && h.sampleRate === format.sampleRate;
    const plausible = h && h.size > 4 && next <= end && (next === end || next + 4 > end || readFrameHeader(b, next) !== null || sameFormat);
    if (!h || !plausible) {
      o += 1;
      junk += 1;
      continue;
    }
    const frame = b.subarray(o, next);
    o = next;
    if (first) {
      first = false;
      const t = sideInfoEnd(h);
      if (t + 4 <= frame.length) {
        const tag = tagAt(frame, t);
        if (tag === 'Xing' || tag === 'Info') continue;
      }
      if (36 + 4 <= frame.length && tagAt(frame, 36) === 'VBRI') continue;
    }
    if (!format) format = { version: h.version, sampleRate: h.sampleRate, channelMode: h.channelMode };
    else if (h.version !== format.version || h.sampleRate !== format.sampleRate || (h.channelMode === 3) !== (format.channelMode === 3)) mismatched += 1;
    frames.push(frame);
    bytes += frame.length;
  }
  return { frames, format, bytes, mismatched, junk };
}

/** Is a clip usable in a lesson file (every frame in `fmt`)? A reason when not. */
export function checkClipFormat(parsed: ParsedMp3, fmt: Mp3Format = LESSON_MP3): string | null {
  if (parsed.frames.length === 0 || !parsed.format) return 'no MP3 frames';
  const f = parsed.format;
  if (f.version !== fmt.version || f.sampleRate !== fmt.sampleRate) return `clip is ${f.sampleRate} Hz MPEG-${f.version === 3 ? 1 : f.version === 2 ? 2 : 2.5}, lessons need ${fmt.sampleRate} Hz`;
  if ((f.channelMode === 3) !== (fmt.channelMode === 3)) return 'clip is stereo, lessons need mono';
  if (parsed.mismatched > 0) return `${parsed.mismatched} frames in another format`;
  return null;
}

function bitrateIndexFor(kbps: number, fmt: Mp3Format): number {
  const table = fmt.version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3;
  const i = table.indexOf(kbps);
  if (i <= 0) throw new Error(`no ${kbps} kbps Layer III frame for this format`);
  return i;
}

function sampleIndexFor(fmt: Mp3Format): number {
  const i = SAMPLE_RATES[fmt.version]?.indexOf(fmt.sampleRate) ?? -1;
  if (i < 0) throw new Error(`unsupported sample rate ${fmt.sampleRate}`);
  return i;
}

/** An empty frame (header + zeros) of `kbps` in `fmt`: zero side info = silence. */
export function emptyFrame(kbps: number, fmt: Mp3Format = LESSON_MP3): Uint8Array {
  const coeff = fmt.version === 3 ? 144 : 72;
  const size = Math.floor((coeff * kbps * 1000) / fmt.sampleRate);
  const f = new Uint8Array(size);
  f[0] = 0xff;
  f[1] = 0xe0 | (fmt.version << 3) | (1 << 1) | 0x01; // Layer III, no CRC
  f[2] = (bitrateIndexFor(kbps, fmt) << 4) | (sampleIndexFor(fmt) << 2);
  f[3] = (fmt.channelMode & 0x03) << 6;
  return f;
}

/** Lowest bitrate of the format (8 kbps MPEG-2, 32 kbps MPEG-1). */
function silenceKbps(fmt: Mp3Format): number {
  return fmt.version === 3 ? 32 : 8;
}

/** Whole frames closest to `ms`. */
export function framesForMs(ms: number, fmt: Mp3Format = LESSON_MP3): number {
  return Math.max(0, Math.round(ms / frameMs(fmt)));
}

/** `ms` of silence as frames (all the same shared frame — never mutate them). */
export function silenceFrames(ms: number, fmt: Mp3Format = LESSON_MP3): Uint8Array[] {
  const n = framesForMs(ms, fmt);
  if (n === 0) return [];
  const frame = emptyFrame(silenceKbps(fmt), fmt);
  return new Array<Uint8Array>(n).fill(frame);
}

export type AssemblyPart = { kind: 'frames'; frames: Uint8Array[] } | { kind: 'silence'; ms: number };

export interface AssembledMp3 {
  bytes: Uint8Array;
  /** Audio frames (the Xing frame not counted). */
  frameCount: number;
  durationMs: number;
  /** Where each part starts, in ms (same order as the input). */
  partStartMs: number[];
}

/**
 * A Xing header frame for a file of `frameCount` audio frames / `audioBytes`
 * bytes whose frame byte offsets are `offsets` (relative to the first audio
 * frame). 64 kbps at 24 kHz = 192 bytes, room for the 120-byte tag.
 */
export function xingFrame(frameCount: number, audioBytes: number, offsets: number[], fmt: Mp3Format = LESSON_MP3): Uint8Array {
  const kbps = fmt.version === 3 ? 128 : 64;
  const f = emptyFrame(kbps, fmt);
  const total = f.length + audioBytes;
  let o = 4 + (fmt.version === 3 ? (fmt.channelMode === 3 ? 17 : 32) : fmt.channelMode === 3 ? 9 : 17);
  const put32 = (v: number) => {
    f[o++] = (v >>> 24) & 0xff;
    f[o++] = (v >>> 16) & 0xff;
    f[o++] = (v >>> 8) & 0xff;
    f[o++] = v & 0xff;
  };
  f.set([0x58, 0x69, 0x6e, 0x67], o); // "Xing"
  o += 4;
  put32(0x0007); // frames | bytes | TOC
  put32(frameCount + 1); // the Xing frame counts as a frame (as LAME writes it)
  put32(total);
  for (let i = 0; i < 100; i++) {
    let v = 0;
    if (frameCount > 0) {
      const frameIndex = Math.min(frameCount - 1, Math.floor((i / 100) * frameCount));
      const byteAt = f.length + offsets[frameIndex];
      v = Math.min(255, Math.floor((byteAt / total) * 256));
    }
    f[o++] = v;
  }
  return f;
}

/** Join clips and silences into one file with a Xing header in front. */
export function assembleMp3(parts: AssemblyPart[], fmt: Mp3Format = LESSON_MP3): AssembledMp3 {
  const all: Uint8Array[] = [];
  const partStartMs: number[] = [];
  const msPerFrame = frameMs(fmt);
  for (const part of parts) {
    partStartMs.push(all.length * msPerFrame);
    const frames = part.kind === 'frames' ? part.frames : silenceFrames(part.ms, fmt);
    for (const f of frames) all.push(f);
  }
  const offsets = new Array<number>(all.length);
  let audioBytes = 0;
  for (let i = 0; i < all.length; i++) {
    offsets[i] = audioBytes;
    audioBytes += all[i].length;
  }
  const head = xingFrame(all.length, audioBytes, offsets, fmt);
  const bytes = new Uint8Array(head.length + audioBytes);
  bytes.set(head, 0);
  let pos = head.length;
  for (const f of all) {
    bytes.set(f, pos);
    pos += f.length;
  }
  return { bytes, frameCount: all.length, durationMs: Math.round(all.length * msPerFrame), partStartMs };
}

/** Duration of a parsed clip in ms. */
export function clipMs(parsed: ParsedMp3): number {
  const fmt = parsed.format ?? LESSON_MP3;
  return parsed.frames.length * frameMs(fmt);
}
