/** Test helper: build small PNGs (gray or RGBA) with node:zlib. */
import { deflateSync } from 'node:zlib';

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A PNG where pixel(x, y) = fn(x, y) (0..255), colour type 0 or 6, with the given filter on every row. */
export function makePng(width: number, height: number, fn: (x: number, y: number) => number, opts: { rgba?: boolean; filter?: number } = {}): Uint8Array {
  const channels = opts.rgba ? 4 : 1;
  const filter = opts.filter ?? 0;
  const raw = new Uint8Array(height * (width * channels + 1));
  const stride = width * channels;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      const v = fn(x, y) & 0xff;
      for (let c = 0; c < channels; c++) line[x * channels + c] = c === 3 ? 255 : v;
    }
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const enc = filter === 1 ? line[i] - a : filter === 2 ? line[i] - b : filter === 3 ? line[i] - ((a + b) >> 1) : line[i];
      raw[y * (stride + 1) + 1 + i] = enc & 0xff;
    }
    prev = line;
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = opts.rgba ? 6 : 0;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}
