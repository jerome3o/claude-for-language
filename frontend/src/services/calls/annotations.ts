/**
 * Drawings on a shared screen, as this page holds them: a small mutable store
 * (not React state) so the always-on-top mini window can redraw from it at
 * full frame rate even while the call tab is in the background. The shape and
 * the rules (normalised points, fading, pings) are shared/calls/annotate.ts.
 */

import {
  ANNOT_WIDTH,
  containRect,
  denormalizePoint,
  pingProgress,
  strokeAlpha,
  DEFAULT_ANNOT_PERSIST,
  type AnnotPing,
  type AnnotStroke,
  type AnnotText,
  type KeptAnnotations,
  type ShownStroke,
  type ShownText,
  type VideoSize,
} from '@shared/calls';

/** Where a text box was drawn (canvas CSS px) — for picking it up, moving and deleting it. */
export type TextBoxes = Map<string, { x: number; y: number; w: number; h: number }>;

export class AnnotationStore {
  strokes = new Map<string, ShownStroke>();
  /** Text boxes on the shared screen, by id (anyone may move / edit / delete any of them). */
  texts = new Map<string, ShownText>();
  /** The text box I am typing in right now (not drawn: the editor shows it). */
  editing: string | null = null;
  pings: AnnotPing[] = [];
  /** When someone else last drew or pinged (for "… is drawing on your screen"). */
  lastRemoteAt = 0;
  lastRemoteName = '';
  /** Keep finished strokes and texts instead of fading them (shared by both people; on by default, round 4). */
  persist = DEFAULT_ANNOT_PERSIST;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  upsert(stroke: AnnotStroke, from: string, now = Date.now(), name?: string) {
    const prev = this.strokes.get(`${from}:${stroke.id}`);
    this.strokes.set(`${from}:${stroke.id}`, { ...stroke, from, doneAt: stroke.done ? (prev?.doneAt ?? now) : null });
    if (from !== 'me') {
      this.lastRemoteAt = now;
      if (name) this.lastRemoteName = name;
    }
    this.emit();
  }

  upsertText(text: AnnotText, from: string, now = Date.now(), name?: string) {
    const prev = this.texts.get(text.id);
    this.texts.set(text.id, { ...text, from, doneAt: text.done ? (prev?.doneAt ?? now) : null });
    if (from !== 'me') {
      this.lastRemoteAt = now;
      if (name) this.lastRemoteName = name;
    }
    this.emit();
  }

  deleteText(id: string) {
    if (this.texts.delete(id)) this.emit();
  }

  setEditing(id: string | null) {
    this.editing = id;
    this.emit();
  }

  /** What the room kept (a rejoin): drawn at once, as finished. */
  loadKept(k: KeptAnnotations | undefined, now = Date.now()) {
    if (!k) return;
    for (const s of k.strokes) this.strokes.set(`${s.from}:${s.stroke.id}`, { ...s.stroke, from: s.from, doneAt: now });
    for (const t of k.texts) this.texts.set(t.text.id, { ...t.text, from: t.from, doneAt: now });
    this.emit();
  }

  ping(from: string, x: number, y: number, now = Date.now(), name?: string) {
    this.pings = [...this.pings.filter((p) => pingProgress(p.at, now) !== null), { id: `${from}:${now}`, from, x, y, at: now }];
    if (from !== 'me') {
      this.lastRemoteAt = now;
      if (name) this.lastRemoteName = name;
    }
    this.emit();
  }

  /** Keep / fade. Switching back to fading starts every finished stroke's fade now. */
  setPersist(persist: boolean, now = Date.now()) {
    if (persist === this.persist) return;
    this.persist = persist;
    if (!persist) {
      for (const s of this.strokes.values()) if (s.doneAt !== null) s.doneAt = now;
      for (const t of this.texts.values()) if (t.doneAt !== null) t.doneAt = now;
    }
    this.emit();
  }

  clear() {
    this.strokes.clear();
    this.texts.clear();
    this.pings = [];
    this.emit();
  }

  /** Anything still visible at `now`? (Stops the redraw loop when not.) */
  active(now = Date.now()): boolean {
    // Kept strokes don't animate: they are redrawn on each change (subscribe), not every frame.
    if (!this.persist) {
      for (const s of this.strokes.values()) if (strokeAlpha(s.doneAt, now) > 0) return true;
      for (const t of this.texts.values()) if (strokeAlpha(t.doneAt, now) > 0) return true;
    }
    return this.pings.some((p) => pingProgress(p.at, now) !== null);
  }

  prune(now = Date.now()) {
    for (const [k, s] of this.strokes) if (strokeAlpha(s.doneAt, now, this.persist) <= 0) this.strokes.delete(k);
    for (const [k, t] of this.texts) if (strokeAlpha(t.doneAt, now, this.persist) <= 0 && this.editing !== k) this.texts.delete(k);
    this.pings = this.pings.filter((p) => pingProgress(p.at, now) !== null);
  }
}

/**
 * Draw every stroke and ping onto a canvas showing the shared picture with
 * `contain` in a `box` (CSS pixels; the context is already scaled for DPR).
 */
export function drawAnnotations(ctx: CanvasRenderingContext2D, box: VideoSize, video: VideoSize | null, store: AnnotationStore, now = Date.now(), boxesOut?: TextBoxes) {
  ctx.clearRect(0, 0, box.width, box.height);
  const scale = Math.min(box.width, box.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of store.strokes.values()) {
    const alpha = strokeAlpha(s.doneAt, now, store.persist);
    if (alpha <= 0 || s.points.length === 0) continue;
    const pts = s.points.map((p) => denormalizePoint(p, box, video));
    const w = Math.max(2.5, (s.width || ANNOT_WIDTH) * scale);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    };
    // A dark halo first, so a stroke reads on light and dark screens alike.
    ctx.globalAlpha = alpha * 0.45;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = w + 3;
    path();
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = w;
    path();
    ctx.stroke();
  }
  // Text boxes: sized by the shared picture's shorter side, so they look the same in any window.
  const pic = containRect(video, box);
  const picShort = Math.max(1, Math.min(pic.width, pic.height));
  boxesOut?.clear();
  for (const t of store.texts.values()) {
    if (t.id === store.editing) continue;
    const alpha = strokeAlpha(t.doneAt, now, store.persist);
    if (alpha <= 0 || !t.text) continue;
    const px = Math.max(11, t.size * picShort);
    const [x, y] = denormalizePoint([t.x, t.y], box, video);
    ctx.font = `600 ${px}px system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif`;
    ctx.textBaseline = 'top';
    const lines = t.text.split('\n');
    const lh = px * 1.25;
    let w = 0;
    for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(3, px / 6);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillStyle = t.color;
    lines.forEach((line, i) => {
      ctx.strokeText(line, x, y + i * lh);
      ctx.fillText(line, x, y + i * lh);
    });
    boxesOut?.set(t.id, { x: x - 4, y: y - 4, w: w + 8, h: lh * lines.length + 8 });
  }
  for (const p of store.pings) {
    const t = pingProgress(p.at, now);
    if (t === null) continue;
    const [x, y] = denormalizePoint([p.x, p.y], box, video);
    for (const k of [0, 0.35]) {
      const tt = t - k;
      if (tt < 0) continue;
      ctx.globalAlpha = Math.max(0, 1 - tt) * 0.9;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 10 + tt * 42, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Keep a canvas the size of its box at the device's pixel ratio; returns the CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement, win: Window = window): VideoSize {
  const rect = canvas.getBoundingClientRect();
  const dpr = win.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height };
}
