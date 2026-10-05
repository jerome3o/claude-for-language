/**
 * Pronunciation takes → a body Azure's short-audio REST API accepts.
 *
 * Azure takes only `audio/wav; codecs=audio/pcm; samplerate=16000` (16-bit mono) or
 * `audio/ogg; codecs=opus`. Our takes are:
 *   - WebM / Opus — the web app's MediaRecorder and the Lab app's MediaRecorder (API 29+):
 *     REMUXED into Ogg / Opus (the Opus packets are copied as they are, nothing is decoded);
 *   - WAV — the Lab app's live take (16 kHz mono PCM, sent as is) or any other PCM WAV
 *     (down-mixed and linearly resampled to 16 kHz mono);
 *   - anything else (an old Android's M4A, Safari's MP4) → unsupported, the check skips scoring.
 * Pure (bytes in, bytes out) so it is unit-tested with real files.
 */

export type AzureAudio = { body: Uint8Array; contentType: string; durationMs: number };
export type ConvertResult = AzureAudio | { unsupported: string };

export const AZURE_WAV = 'audio/wav; codecs=audio/pcm; samplerate=16000';
export const AZURE_OGG = 'audio/ogg; codecs=opus';

export function sniffAudio(bytes: Uint8Array): 'webm' | 'wav' | 'ogg' | 'mp4' | 'unknown' {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE') return 'wav';
  if (head.startsWith('OggS')) return 'ogg';
  if (head.slice(4, 8) === 'ftyp') return 'mp4';
  return 'unknown';
}

export function toAzureAudio(bytes: Uint8Array): ConvertResult {
  const kind = sniffAudio(bytes);
  try {
    if (kind === 'webm') return webmOpusToOgg(bytes);
    if (kind === 'wav') return wavTo16kMono(bytes);
    if (kind === 'ogg') return { body: bytes, contentType: AZURE_OGG, durationMs: oggDurationMs(bytes) };
    return { unsupported: kind === 'mp4' ? 'mp4/aac audio' : 'unknown audio format' };
  } catch (err) {
    return { unsupported: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------- WAV ----------------

export function wavTo16kMono(bytes: Uint8Array): ConvertResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: { offset: number; length: number } | null = null;
  while (pos + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 4));
    let size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 'data') {
      // A take written while recording may carry size 0 / 0xFFFFFFFF until finished: use the rest.
      if (size === 0 || body + size > bytes.length) size = bytes.length - body;
      data = { offset: body, length: size };
      break;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) return { unsupported: 'wav without fmt / data' };
  if (fmt.format !== 1 || fmt.bits !== 16) return { unsupported: `wav format ${fmt.format} / ${fmt.bits}-bit` };
  const frames = Math.floor(data.length / (2 * fmt.channels));
  if (fmt.channels === 1 && fmt.rate === 16000) {
    const pcm = bytes.subarray(data.offset, data.offset + frames * 2);
    return { body: concat([wavHeader(16000, pcm.length), pcm]), contentType: AZURE_WAV, durationMs: Math.round((frames / 16000) * 1000) };
  }
  // Down-mix, then linear resample to 16 kHz.
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) sum += view.getInt16(data.offset + (f * fmt.channels + c) * 2, true);
    mono[f] = sum / fmt.channels;
  }
  const outFrames = Math.floor((frames * 16000) / fmt.rate);
  const out = new Uint8Array(outFrames * 2);
  const ov = new DataView(out.buffer);
  const step = fmt.rate / 16000;
  for (let i = 0; i < outFrames; i++) {
    const x = i * step;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, frames - 1);
    const v = mono[i0] + (mono[i1] - mono[i0]) * (x - i0);
    ov.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(v))), true);
  }
  return { body: concat([wavHeader(16000, out.length), out]), contentType: AZURE_WAV, durationMs: Math.round((outFrames / 16000) * 1000) };
}

function wavHeader(rate: number, dataBytes: number): Uint8Array {
  const b = new Uint8Array(44);
  const v = new DataView(b.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, dataBytes, true);
  return b;
}

// ---------------- WebM (Matroska) → Ogg ----------------

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  Channels: 0x9f,
  TrackNumber: 0xd7,
};
const MASTERS = new Set([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.BlockGroup, ID.Audio]);

function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } {
  const first = bytes[pos];
  if (first === undefined || first === 0) throw new Error('bad EBML vint');
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (pos + length > bytes.length) throw new Error('truncated EBML');
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/**
 * Walk the file flat: master elements are entered (not skipped), so unknown-size
 * Segments / Clusters (MediaRecorder writes those) need no special case.
 */
export function webmOpusToOgg(bytes: Uint8Array): ConvertResult {
  let pos = 0;
  let codec = '';
  let opusHead: Uint8Array | null = null;
  let channels = 1;
  let audioTrack: number | null = null;
  let currentTrack: { number: number | null; codec: string } | null = null;
  const packets: Uint8Array[] = [];
  while (pos < bytes.length) {
    let id: ReturnType<typeof readVint>;
    let size: ReturnType<typeof readVint>;
    try {
      id = readVint(bytes, pos, true);
      size = readVint(bytes, pos + id.length, false);
    } catch {
      break; // a take cut off mid-element: keep what we have
    }
    const body = pos + id.length + size.length;
    if (MASTERS.has(id.value)) {
      if (id.value === ID.TrackEntry) currentTrack = { number: null, codec: '' };
      pos = body;
      continue;
    }
    if (size.unknown) break;
    const end = Math.min(body + size.value, bytes.length);
    const payload = bytes.subarray(body, end);
    switch (id.value) {
      case ID.TrackNumber:
        if (currentTrack) currentTrack.number = uint(payload);
        if (currentTrack?.codec === 'A_OPUS') audioTrack = currentTrack.number;
        break;
      case ID.CodecID:
        if (currentTrack) currentTrack.codec = ascii(payload);
        if (ascii(payload) === 'A_OPUS') {
          codec = 'A_OPUS';
          if (currentTrack?.number != null) audioTrack = currentTrack.number;
        }
        break;
      case ID.CodecPrivate:
        if (currentTrack?.codec === 'A_OPUS' || ascii(payload.subarray(0, 8)) === 'OpusHead') opusHead = payload.slice();
        break;
      case ID.Channels:
        channels = uint(payload) || 1;
        break;
      case ID.SimpleBlock:
      case ID.Block: {
        const track = readVint(payload, 0, false);
        const flags = payload[track.length + 2];
        const lacing = (flags >> 1) & 0x03;
        if (audioTrack != null && track.value !== audioTrack) break;
        if (lacing !== 0) throw new Error('laced webm blocks');
        packets.push(payload.subarray(track.length + 3));
        break;
      }
    }
    pos = end;
  }
  if (codec !== 'A_OPUS') return { unsupported: 'webm without opus audio' };
  if (!packets.length) return { unsupported: 'webm with no audio' };
  const head = opusHead && ascii(opusHead.subarray(0, 8)) === 'OpusHead' ? opusHead : buildOpusHead(channels);
  return oggFromOpus(head, packets);
}

function uint(b: Uint8Array): number {
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return v;
}
function ascii(b: Uint8Array): string {
  return String.fromCharCode(...b).replace(/\0+$/, '');
}

function buildOpusHead(channels: number): Uint8Array {
  const b = new Uint8Array(19);
  const v = new DataView(b.buffer);
  for (let i = 0; i < 8; i++) b[i] = 'OpusHead'.charCodeAt(i);
  b[8] = 1;
  b[9] = channels;
  v.setUint16(10, 312, true); // pre-skip
  v.setUint32(12, 48000, true);
  return b;
}

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  if (!packet.length) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frameUs: number;
  if (config < 12) frameUs = [10000, 20000, 40000, 60000][config % 4];
  else if (config < 16) frameUs = [10000, 20000][config % 2];
  else frameUs = [2500, 5000, 10000, 20000][config % 4];
  const c = toc & 0x03;
  const frames = c === 0 ? 1 : c === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return (frames * frameUs * 48) / 1000;
}

function oggFromOpus(opusHead: Uint8Array, packets: Uint8Array[]): AzureAudio {
  const serial = 0x0c1e0c1e;
  const preSkip = opusHead.length >= 12 ? opusHead[10] | (opusHead[11] << 8) : 312;
  const pages: Uint8Array[] = [];
  let seq = 0;
  pages.push(oggPage([opusHead], 0, serial, seq++, 0x02));
  const vendor = 'chinese-learning';
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const tv = new DataView(tags.buffer);
  for (let i = 0; i < 8; i++) tags[i] = 'OpusTags'.charCodeAt(i);
  tv.setUint32(8, vendor.length, true);
  for (let i = 0; i < vendor.length; i++) tags[12 + i] = vendor.charCodeAt(i);
  tv.setUint32(12 + vendor.length, 0, true);
  pages.push(oggPage([tags], 0, serial, seq++, 0));
  let granule = 0;
  // ~50 packets (≈1 s) per page keeps the page overhead tiny and every segment table < 255.
  for (let i = 0; i < packets.length; i += 50) {
    const group = packets.slice(i, i + 50);
    for (const p of group) granule += opusPacketSamples(p);
    const last = i + 50 >= packets.length;
    pages.push(oggPage(group, granule, serial, seq++, last ? 0x04 : 0));
  }
  return { body: concat(pages), contentType: AZURE_OGG, durationMs: Math.max(0, Math.round(((granule - preSkip) / 48000) * 1000)) };
}

function oggPage(packets: Uint8Array[], granule: number, serial: number, seq: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new Error('ogg page too large');
  const bodyLen = packets.reduce((s, p) => s + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLen);
  const v = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  page[4] = 0;
  page[5] = flags;
  v.setUint32(6, granule % 0x100000000, true);
  v.setUint32(10, Math.floor(granule / 0x100000000), true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  v.setUint32(22, 0, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, o);
    o += p.length;
  }
  v.setUint32(22, oggCrc(page), true);
  return page;
}

let CRC_TABLE: Uint32Array | null = null;
function oggCrc(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      CRC_TABLE[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** Duration of an Ogg / Opus file from its last page's granule position. */
export function oggDurationMs(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 27; i >= 0; i--) {
    if (bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53) {
      const g = v.getUint32(i + 6, true) + v.getUint32(i + 10, true) * 0x100000000;
      return Math.round(((g - 312) / 48000) * 1000);
    }
  }
  return 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
