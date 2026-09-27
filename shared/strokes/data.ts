import type { CharStrokeData, Point } from './types';
import { pathLength, toPoints } from './geometry';

/**
 * Where a character's data is served: `/strokes/<codepoint in hex>.json`
 * (copied from hanzi-writer-data at build time by the frontend's
 * strokeDataPlugin — hex names keep URLs ASCII).
 */
export function strokeDataFile(char: string): string {
  const cp = char.codePointAt(0);
  if (cp === undefined) throw new Error('empty character');
  return `${cp.toString(16)}.json`;
}

/** Validate untrusted JSON as stroke data; null when it isn't (e.g. an SPA fallback page). */
export function parseCharStrokeData(json: unknown): CharStrokeData | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const { strokes, medians } = o;
  if (!Array.isArray(strokes) || !Array.isArray(medians)) return null;
  if (strokes.length === 0 || strokes.length !== medians.length) return null;
  if (!strokes.every((s) => typeof s === 'string')) return null;
  const okMedian = (m: unknown) =>
    Array.isArray(m) &&
    m.length >= 1 &&
    m.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number');
  if (!medians.every(okMedian)) return null;
  const radStrokes = Array.isArray(o.radStrokes) ? (o.radStrokes as unknown[]).filter((n): n is number => typeof n === 'number') : undefined;
  return {
    strokes: strokes as string[],
    medians: medians as [number, number][][],
    ...(radStrokes ? { radStrokes } : {}),
  };
}

/** SVG path along a stroke's median (for the brush that reveals a stroke inside its outline). */
export function medianPath(median: [number, number][]): string {
  if (median.length === 0) return '';
  const pts = median.length === 1 ? [median[0], median[0]] : median;
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

/**
 * The brush path used to "paint" a stroke inside its outline: the median with
 * its start pulled back by `extend` units, so the round cap of a zero-length
 * dash sits outside the outline before the animation starts.
 */
export function brushPath(median: [number, number][], extend = 90): { d: string; length: number } {
  if (median.length === 0) return { d: '', length: 0 };
  const pts = median.length === 1 ? [median[0], median[0]] : median;
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[1];
  const m = Math.hypot(x1 - x0, y1 - y0);
  const start: [number, number] = m === 0 ? [x0, y0] : [x0 - ((x1 - x0) / m) * extend, y0 - ((y1 - y0) / m) * extend];
  const full = [start, ...pts];
  return { d: medianPath(full), length: medianLength(full) };
}

export function medianLength(median: [number, number][]): number {
  return pathLength(toPoints(median));
}

/** Start point and unit direction of a stroke (for the "start here →" hint). */
export function strokeStart(median: [number, number][]): { start: Point; dir: Point } {
  const pts = toPoints(median);
  const start = pts[0];
  // look a little way along the stroke for a stable direction
  const target = pts.find((p) => Math.hypot(p.x - start.x, p.y - start.y) > 60) ?? pts[pts.length - 1];
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const m = Math.hypot(dx, dy) || 1;
  return { start, dir: { x: dx / m, y: dy / m } };
}
