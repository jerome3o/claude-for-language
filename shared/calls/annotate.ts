/**
 * Drawing on a shared screen. Either person circles something on the shared
 * screen — the viewer on their video of it, the sharer on their own large view
 * of it; the strokes travel through the call room (never stored) and show on
 * both sides in the drawer's colour (the sharer's pen defaults to blue, the
 * viewer's to red), and for the sharer also in an always-on-top mini window on
 * Chrome desktop (a browser can't draw on the real screen). Strokes fade a few
 * seconds after they're finished, or stay while "Keep drawings" is on (one
 * setting for both people, `annot_mode`).
 *
 * Text (round 4): either person can also place TEXT boxes on the shared
 * picture (`AnnotText`: anchored at its top-left, sized as a fraction of the
 * picture's shorter side, in the writer's colour), type in them with any IME,
 * move and delete them. "Keep" is now ON by default (a room that never set it
 * keeps), so nothing fades unexpectedly; fading stays an option. While kept,
 * the room remembers the strokes and texts so a reconnect shows them again
 * (`welcome.annots`).
 *
 * Points are 0..1 of the shared picture (not of any element), so they land on
 * the same spot whatever size either window is. Strokes fade a few seconds
 * after they're finished. The Lab app's CallAnnotate.kt is a port,
 * parity-tested.
 */

import { containRect, type VideoSize } from './videoFit';

export type AnnotPoint = [number, number];

export interface AnnotStroke {
  id: string;
  color: string;
  /** Line width as a fraction of the picture's shorter side. */
  width: number;
  points: AnnotPoint[];
  /** The pen was lifted: the stroke starts fading. */
  done: boolean;
}

/** A stroke as shown, with who drew it and when it was finished (local clock). */
export interface ShownStroke extends AnnotStroke {
  from: string;
  doneAt: number | null;
}

export interface AnnotPing {
  id: string;
  from: string;
  x: number;
  y: number;
  at: number;
}

export const ANNOT_COLORS = ['#f43f5e', '#facc15', '#22c55e', '#38bdf8'] as const;
export const MAX_ANNOT_POINTS = 600;
/** A finished stroke stays this long, then fades out over ANNOT_FADE_MS. */
export const ANNOT_HOLD_MS = 3_000;
export const ANNOT_FADE_MS = 1_200;
/** A ping (a tap) pulses for this long. */
export const PING_MS = 1_600;
/** Default pen: 0.6 % of the picture's shorter side (≈ 6 px on a 1080p screen). */
export const ANNOT_WIDTH = 0.006;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Where a pointer is on the shared picture shown with `object-fit: contain`
 * in a box: [x, y] in 0..1, or null outside the picture (in the letterbox).
 * `px`, `py` are relative to the box's top-left.
 */
export function normalizePoint(px: number, py: number, box: VideoSize, video: VideoSize | null): AnnotPoint | null {
  const r = containRect(video, box);
  if (r.width <= 0 || r.height <= 0) return null;
  const x = (px - r.x) / r.width;
  const y = (py - r.y) / r.height;
  if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return null;
  return [round4(clamp01(x)), round4(clamp01(y))];
}

/** A normalised point back to box coordinates (for drawing). */
export function denormalizePoint(p: AnnotPoint, box: VideoSize, video: VideoSize | null): [number, number] {
  const r = containRect(video, box);
  return [r.x + p[0] * r.width, r.y + p[1] * r.height];
}

/** The pen colour each person starts with, so two people drawing at once are told apart. */
export const SHARER_ANNOT_COLOR = '#38bdf8';
export const VIEWER_ANNOT_COLOR = '#f43f5e';

export function defaultAnnotColor(iAmSharing: boolean): string {
  return iAmSharing ? SHARER_ANNOT_COLOR : VIEWER_ANNOT_COLOR;
}

/**
 * A stroke's opacity: 1 while drawing and for ANNOT_HOLD_MS after, then fading
 * to 0 — or always 1 while drawings are kept (`persist`).
 */
export function strokeAlpha(doneAt: number | null, now: number, persist = false): number {
  if (doneAt === null || persist) return 1;
  const t = now - doneAt - ANNOT_HOLD_MS;
  if (t <= 0) return 1;
  return Math.max(0, 1 - t / ANNOT_FADE_MS);
}

/** A ping's progress 0..1 (null once over). */
export function pingProgress(at: number, now: number): number | null {
  const t = (now - at) / PING_MS;
  return t < 0 ? 0 : t >= 1 ? null : t;
}

/** Drop what has faded away. */
export function pruneAnnotations<T extends { doneAt: number | null }>(strokes: Record<string, T>, now: number, persist = false): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, s] of Object.entries(strokes)) if (strokeAlpha(s.doneAt, now, persist) > 0) out[k] = s;
  return out;
}

/** Validate a stroke off the wire (the room relays only clean ones). */
export function sanitizeAnnotStroke(raw: unknown): AnnotStroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id || s.id.length > 64 || !isColor(s.color) || !Array.isArray(s.points)) return null;
  const width = Number(s.width);
  if (!Number.isFinite(width) || width <= 0 || width > 0.05) return null;
  const points: AnnotPoint[] = [];
  for (const p of s.points.slice(0, MAX_ANNOT_POINTS)) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([round4(clamp01(x)), round4(clamp01(y))]);
  }
  if (points.length === 0) return null;
  return { id: s.id, color: s.color, width, points, done: s.done === true };
}

export function sanitizePing(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number((raw as { x?: unknown }).x);
  const y = Number((raw as { y?: unknown }).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: round4(clamp01(x)), y: round4(clamp01(y)) };
}

/**
 * Thin a pointer path before sending: drop points closer than `minStep`
 * (in normalised units) to the previous kept one, always keeping the last.
 */
export function simplifyPoints(points: readonly AnnotPoint[], minStep = 0.002): AnnotPoint[] {
  const out: AnnotPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const last = out[out.length - 1];
    if (!last || i === points.length - 1 || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minStep) out.push(p);
  }
  return out.slice(0, MAX_ANNOT_POINTS);
}

// ------------------------------------------------------------------ text boxes (round 4)

export interface AnnotText {
  id: string;
  color: string;
  /** Top-left of the box, 0..1 of the shared picture. */
  x: number;
  y: number;
  text: string;
  /** Font size as a fraction of the picture's shorter side. */
  size: number;
  /** The writer has finished (Enter / tapped away): it starts fading unless kept. */
  done: boolean;
}

/** A text as shown, with who last wrote / moved it and when it was finished (local clock). */
export interface ShownText extends AnnotText {
  from: string;
  doneAt: number | null;
}

export const ANNOT_TEXT_SIZE = 0.032;
export const MAX_ANNOT_TEXT_CHARS = 200;
/** The room keeps at most this many strokes / texts while drawings are kept. */
export const MAX_KEPT_STROKES = 300;
export const MAX_KEPT_TEXTS = 100;
/** Keep drawings (and texts) until cleared: the default when the room never said otherwise. */
export const DEFAULT_ANNOT_PERSIST = true;

/** The room's stored setting → whether drawings are kept (undefined = never set = the default). */
export function annotPersistOf(stored: boolean | undefined | null): boolean {
  return typeof stored === 'boolean' ? stored : DEFAULT_ANNOT_PERSIST;
}

/** Validate a text box off the wire. Text is kept as typed (Chinese, emoji), one or more lines, ≤ 200 characters. */
export function sanitizeAnnotText(raw: unknown): AnnotText | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id || t.id.length > 64 || !isColor(t.color) || typeof t.text !== 'string') return null;
  const x = Number(t.x);
  const y = Number(t.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const size = Number(t.size);
  const text = Array.from(t.text.replace(/\r\n?/g, '\n')).slice(0, MAX_ANNOT_TEXT_CHARS).join('');
  return {
    id: t.id,
    color: t.color,
    x: round4(clamp01(x)),
    y: round4(clamp01(y)),
    text,
    size: Number.isFinite(size) && size >= 0.01 && size <= 0.12 ? round4(size) : ANNOT_TEXT_SIZE,
    done: t.done === true,
  };
}

/** A text's top-left after dragging it by (dx, dy) of the picture, kept on the picture. */
export function moveAnnotText(t: Pick<AnnotText, 'x' | 'y'>, dx: number, dy: number): { x: number; y: number } {
  return { x: round4(Math.min(0.98, clamp01(t.x + dx))), y: round4(Math.min(0.98, clamp01(t.y + dy))) };
}

/** A text's opacity (same rule as strokes): 1 while written and kept, fading after it's finished otherwise. */
export function textAlpha(doneAt: number | null, now: number, persist = false): number {
  return strokeAlpha(doneAt, now, persist);
}

/**
 * The strokes and texts a room keeps while drawings are kept (a reconnect gets
 * them in `welcome`): finished strokes only, newest last, bounded.
 */
export interface KeptAnnotations {
  strokes: { key: string; from: string; name: string; stroke: AnnotStroke }[];
  texts: { from: string; name: string; text: AnnotText }[];
}

export function emptyKept(): KeptAnnotations {
  return { strokes: [], texts: [] };
}

export function keepStroke(k: KeptAnnotations, from: string, name: string, stroke: AnnotStroke): KeptAnnotations {
  if (!stroke.done) return k;
  const key = `${from}:${stroke.id}`;
  const strokes = [...k.strokes.filter((s) => s.key !== key), { key, from, name, stroke }];
  return { ...k, strokes: strokes.slice(-MAX_KEPT_STROKES) };
}

export function keepText(k: KeptAnnotations, from: string, name: string, text: AnnotText): KeptAnnotations {
  const texts = [...k.texts.filter((t) => t.text.id !== text.id), { from, name, text }];
  return { ...k, texts: texts.slice(-MAX_KEPT_TEXTS) };
}

export function dropText(k: KeptAnnotations, id: string): KeptAnnotations {
  return { ...k, texts: k.texts.filter((t) => t.text.id !== id) };
}
