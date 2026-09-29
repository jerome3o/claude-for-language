/**
 * Segmentation masks → outlines, for picture hunts.
 *
 * Gemini's segmentation returns, per object, a PNG probability map (0..255)
 * the size of the object's box. Storing and drawing 25 PNGs per picture on two
 * platforms is heavy, so the worker turns each mask into ONE polygon (the
 * outline of its largest blob) in normalised image coordinates — an SVG
 * <polygon> on the web, a Path on the Lab's Canvas. Any failure (unsupported
 * PNG, empty mask) returns null and the object falls back to its box.
 *
 * Pure apart from DecompressionStream (Workers and Node 18+ both have it).
 */
import type { HuntBox } from '@shared/picture-hunt';

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, row-major. */
  data: Uint8Array;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode an 8-bit, non-interlaced PNG to one channel (gray, or the first
 * channel of RGB / RGBA, or the palette entry's red). Throws on anything else.
 */
export async function decodePngGray(png: Uint8Array): Promise<GrayImage> {
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = png[offset + 16];
      colorType = png[offset + 17];
      interlace = png[offset + 20];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height) throw new Error('PNG has no header');
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${bitDepth}, interlace ${interlace})`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error('palette PNG without PLTE');

  const total = idat.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let pos = 0;
  for (const c of idat) {
    joined.set(c, pos);
    pos += c.length;
  }
  const raw = await inflate(joined);
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('PNG data is short');

  const out = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const v = cur[x * channels];
      out[y * width + x] = colorType === 3 ? palette![v * 3] : v;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

/** Nearest-neighbour shrink so the long side is at most `max` (tracing cost). */
export function shrinkGray(img: GrayImage, max: number): GrayImage {
  const scale = Math.max(img.width, img.height) / max;
  if (scale <= 1) return img;
  const width = Math.max(1, Math.round(img.width / scale));
  const height = Math.max(1, Math.round(img.height / scale));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / width));
      data[y * width + x] = img.data[sy * img.width + sx];
    }
  }
  return { width, height, data };
}

/** Pixels of the largest 8-connected blob at or above the threshold (as a 0/1 grid), or null. */
export function largestBlob(img: GrayImage, threshold = 127): { grid: Uint8Array; start: number; size: number } | null {
  const { width, height, data } = img;
  const label = new Int32Array(width * height);
  let best = { id: 0, size: 0, start: -1 };
  let next = 1;
  const stack: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] < threshold || label[i]) continue;
    const id = next++;
    let size = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % width;
      const py = (p - px) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!label[q] && data[q] >= threshold) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
    if (size > best.size) best = { id, size, start: i };
  }
  if (!best.size) return null;
  const grid = new Uint8Array(width * height);
  for (let i = 0; i < label.length; i++) if (label[i] === best.id) grid[i] = 1;
  return { grid, start: best.start, size: best.size };
}

// Clockwise around a pixel (y grows downward), starting west.
const DIRS: Array<[number, number]> = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

/** Moore-neighbour boundary trace of a blob, as pixel coordinates in order. */
export function traceBoundary(grid: Uint8Array, width: number, height: number, start: number): Array<[number, number]> {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && grid[y * width + x] === 1;
  const sx = start % width;
  const sy = (start - sx) / width;
  const contour: Array<[number, number]> = [[sx, sy]];
  let px = sx;
  let py = sy;
  // The start is the first blob pixel in raster order, so its west is outside.
  let bx = sx - 1;
  let by = sy;
  const limit = 4 * width * height + 8;
  for (let step = 0; step < limit; step++) {
    let k = DIRS.findIndex(([dx, dy]) => px + dx === bx && py + dy === by);
    if (k < 0) k = 0;
    let moved = false;
    let prevX = bx;
    let prevY = by;
    for (let i = 1; i <= 8; i++) {
      const [dx, dy] = DIRS[(k + i) % 8];
      const cx = px + dx;
      const cy = py + dy;
      if (inside(cx, cy)) {
        bx = prevX;
        by = prevY;
        px = cx;
        py = cy;
        moved = true;
        break;
      }
      prevX = cx;
      prevY = cy;
    }
    if (!moved) break; // a single pixel
    if (px === sx && py === sy) break;
    contour.push([px, py]);
  }
  return contour;
}

function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Douglas–Peucker on an open polyline. */
export function simplify(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  let maxD = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** A closed contour simplified: split at the point farthest from the start so both halves keep their shape. */
export function simplifyClosed(points: Array<[number, number]>, epsilon: number, maxPoints = 64): Array<[number, number]> {
  if (points.length <= 3) return points.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  let eps = epsilon;
  let result: Array<[number, number]> = points;
  for (let round = 0; round < 8; round++) {
    const a = simplify(points.slice(0, far + 1), eps);
    const b = simplify([...points.slice(far), points[0]], eps);
    result = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (result.length <= maxPoints) break;
    eps *= 1.6;
  }
  return result;
}

/**
 * The outline of a mask as a polygon in normalised image coordinates.
 * `box` is where the mask sits in the image (the mask is scaled to fill it).
 * null when the mask is empty, too small to matter, or the outline degenerates.
 */
export function maskToPolygon(mask: GrayImage, box: HuntBox, opts: { threshold?: number; maxSide?: number } = {}): Array<[number, number]> | null {
  const small = shrinkGray(mask, opts.maxSide ?? 96);
  const blob = largestBlob(small, opts.threshold ?? 127);
  if (!blob || blob.size < 4) return null;
  const contour = traceBoundary(blob.grid, small.width, small.height, blob.start);
  if (contour.length < 3) return null;
  const eps = Math.max(0.75, Math.max(small.width, small.height) * 0.012);
  const simplified = simplifyClosed(contour, eps);
  if (simplified.length < 3) return null;
  const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
  return simplified.map(([x, y]) => [
    round(box.x + ((x + 0.5) / small.width) * box.w),
    round(box.y + ((y + 0.5) / small.height) * box.h),
  ]);
}

/** Decode a "data:image/png;base64,…" (or bare base64) mask and outline it; null on any failure. */
export async function polygonFromMaskData(maskData: string, box: HuntBox): Promise<Array<[number, number]> | null> {
  try {
    const base64 = maskData.includes(',') ? maskData.slice(maskData.indexOf(',') + 1) : maskData;
    const bytes = Uint8Array.from(atob(base64.trim()), (c) => c.charCodeAt(0));
    return maskToPolygon(await decodePngGray(bytes), box);
  } catch (err) {
    console.warn('[picture-hunt] mask not usable:', err instanceof Error ? err.message : err);
    return null;
  }
}
