import type { Point } from './types';

/** Pure 2-D helpers for stroke matching. */

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const mag = (p: Point): number => Math.hypot(p.x, p.y);
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

export function stripDuplicates(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function toPoints(median: [number, number][]): Point[] {
  return median.map(([x, y]) => ({ x, y }));
}

/**
 * Redraw a polyline as `n` points equally spaced along its length (n >= 2).
 * A zero-length input comes back as n copies of its first point.
 */
export function resample(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  const total = pathLength(points);
  if (points.length === 1 || total === 0) return Array.from({ length: n }, () => ({ ...points[0] }));
  // cumulative distance at each input point
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  const out: Point[] = [{ ...points[0] }];
  let seg = 1;
  for (let k = 1; k < n - 1; k++) {
    const target = (total * k) / (n - 1);
    while (seg < points.length - 1 && cum[seg] < target) seg += 1;
    const a = points[seg - 1];
    const b = points[seg];
    const span = cum[seg] - cum[seg - 1];
    const t = span === 0 ? 0 : (target - cum[seg - 1]) / span;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

export function cosineSimilarity(a: Point, b: Point): number {
  const m = mag(a) * mag(b);
  return m === 0 ? 0 : (a.x * b.x + a.y * b.y) / m;
}

/** Mean over `points` of the distance to the nearest point of `target`. */
export function meanNearestDistance(points: Point[], target: Point[]): number {
  if (points.length === 0 || target.length === 0) return Infinity;
  let total = 0;
  for (const p of points) {
    let best = Infinity;
    for (const t of target) {
      const d = dist(p, t);
      if (d < best) best = d;
    }
    total += best;
  }
  return total / points.length;
}

/** Discrete Fréchet distance (Eiter & Mannila). */
export function frechet(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  let prev: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const cur: number[] = [];
    for (let j = 0; j < b.length; j++) {
      const d = dist(a[i], b[j]);
      if (i === 0 && j === 0) cur.push(d);
      else if (i === 0) cur.push(Math.max(cur[j - 1], d));
      else if (j === 0) cur.push(Math.max(prev[0], d));
      else cur.push(Math.max(Math.min(prev[j], prev[j - 1], cur[j - 1]), d));
    }
    prev = cur;
  }
  return prev[b.length - 1];
}

/**
 * Procrustes-style normalisation: resample, centre on the mean and scale so
 * the endpoints sit at unit RMS distance — compares SHAPE only, not position
 * or size.
 */
export function normalizeShape(points: Point[], n = 24): Point[] {
  const r = resample(points, n);
  const mx = r.reduce((s, p) => s + p.x, 0) / r.length;
  const my = r.reduce((s, p) => s + p.y, 0) / r.length;
  const c = r.map((p) => ({ x: p.x - mx, y: p.y - my }));
  const first = c[0];
  const last = c[c.length - 1];
  const scale = Math.sqrt((first.x ** 2 + first.y ** 2 + last.x ** 2 + last.y ** 2) / 2) || 1;
  return c.map((p) => ({ x: p.x / scale, y: p.y / scale }));
}

export function rotate(points: Point[], theta: number): Point[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return points.map((p) => ({ x: cos * p.x - sin * p.y, y: sin * p.x + cos * p.y }));
}

/** Smallest Fréchet distance between the normalised shapes over a few small rotations. */
export function shapeDistance(a: Point[], b: Point[]): number {
  const na = normalizeShape(a);
  const nb = normalizeShape(b);
  let best = Infinity;
  for (const theta of [Math.PI / 16, Math.PI / 32, 0, -Math.PI / 32, -Math.PI / 16]) {
    best = Math.min(best, frechet(na, rotate(nb, theta)));
  }
  return best;
}

/**
 * Average cosine similarity between the drawing's segments and the closest
 * direction in the median — > 0 means "broadly the same way round".
 */
export function directionSimilarity(points: Point[], median: Point[]): number {
  const drawn = resample(points, 16);
  const segs: Point[] = [];
  for (let i = 1; i < drawn.length; i++) segs.push(sub(drawn[i], drawn[i - 1]));
  const ref: Point[] = [];
  for (let i = 1; i < median.length; i++) ref.push(sub(median[i], median[i - 1]));
  if (segs.length === 0 || ref.length === 0) return 0;
  let total = 0;
  for (const s of segs) {
    let best = -1;
    for (const r of ref) best = Math.max(best, cosineSimilarity(s, r));
    total += best;
  }
  return total / segs.length;
}

/** Downsample + round a drawing for storage (≤ maxPoints points). */
export function compactStroke(points: Point[], maxPoints = 24): [number, number][] {
  const clean = stripDuplicates(points);
  const n = Math.max(2, Math.min(maxPoints, clean.length));
  return resample(clean, n).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]);
}
