/**
 * The overlay window's page: draws the call's annotations over the shared
 * display with the web app's own drawing code (frontend/src/services/calls/
 * annotations.ts — same strokes, halos, texts, pings, keep / fade), and in
 * draw mode lets the tutor draw (pen), tap ("look here" ping) and type (text)
 * on her real screen. What she does goes back to the call page as overlay
 * events (shared/desktop/bridge.ts) and from there through the call room.
 */

import { ANNOT_COLORS, ANNOT_TEXT_SIZE, ANNOT_WIDTH, SHARER_ANNOT_COLOR, simplifyPoints, type AnnotPoint, type AnnotStroke, type AnnotText } from '@shared/calls';
import { overlayCanvasRect, overlayToShared, sanitizeSnapshot, type OverlayEvent, type Rect } from '@shared/desktop/bridge';
import { AnnotationStore, drawAnnotations, fitCanvas } from '../../../frontend/src/services/calls/annotations';
import type { OverlayInit } from '../ipc';

interface OverlayHost {
  onInit(l: (v: unknown) => void): void;
  onSnapshot(l: (v: unknown) => void): void;
  onDrawMode(l: (v: unknown) => void): void;
  emit(event: OverlayEvent): void;
  interactive(on: boolean): void;
}

const host = (window as unknown as { overlayHost: OverlayHost }).overlayHost;
const canvas = document.getElementById('ink') as HTMLCanvasElement;
const toolbar = document.getElementById('toolbar') as HTMLElement;
const editorEl = document.getElementById('editor') as HTMLTextAreaElement;

const store = new AnnotationStore();
/** My own strokes until the page's snapshot carries them (no flicker while the round trip happens). */
const local = new Map<string, AnnotStroke>();

let display: Rect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
let win: Rect = { ...display };
let drawMode = false;
let tool: 'pen' | 'text' = 'pen';
let color = SHARER_ANNOT_COLOR;
let colorChosen = false;

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------------ drawing

function placeCanvas() {
  const r = overlayCanvasRect(display, win);
  Object.assign(canvas.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
}

let raf = 0;
function frame() {
  raf = 0;
  const box = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  // The canvas IS the shared picture (the whole display), so "contain" is the identity.
  if (ctx) drawAnnotations(ctx, box, box, store);
  if (store.active() || drawing) raf = requestAnimationFrame(frame);
  else store.prune();
}
function kick() {
  if (!raf) raf = requestAnimationFrame(frame);
}

function mergeLocal(now = Date.now()) {
  for (const [id, s] of local) {
    const key = `me:${id}`;
    if (s.done && store.strokes.has(key)) {
      local.delete(id);
      continue;
    }
    store.strokes.set(key, { ...s, from: 'me', doneAt: s.done ? (store.strokes.get(key)?.doneAt ?? now) : null });
  }
}

host.onInit((v) => {
  const init = v as OverlayInit;
  if (!init?.display || !init?.window) return;
  display = init.display;
  win = init.window;
  document.body.dataset.platform = init.platform;
  placeCanvas();
  kick();
});

host.onSnapshot((v) => {
  const snap = sanitizeSnapshot(v);
  if (!snap) return;
  store.strokes.clear();
  for (const s of snap.strokes) store.strokes.set(`${s.from}:${s.id}`, s);
  store.texts.clear();
  for (const t of snap.texts) store.texts.set(t.id, t);
  store.pings = snap.pings;
  store.persist = snap.persist;
  store.editing = editor?.id ?? null;
  if (!colorChosen) {
    color = snap.color;
    renderToolbar();
  }
  mergeLocal();
  kick();
});

host.onDrawMode((v) => {
  drawMode = v === true;
  document.body.classList.toggle('drawing', drawMode);
  if (!drawMode) finishEditor(true);
  renderToolbar();
});

// ------------------------------------------------------------------ toolbar

function button(label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function renderToolbar() {
  toolbar.replaceChildren();
  if (!drawMode) {
    toolbar.append(button('🖍️ Draw on screen', 'Draw and type on your screen — your student sees it on your shared screen', () => host.emit({ kind: 'draw_mode', on: true }), 'primary'));
    return;
  }
  toolbar.append(
    button('✏️', 'Pen (a quick tap points “look here”)', () => setTool('pen'), tool === 'pen' ? 'active' : ''),
    button('T', 'Text', () => setTool('text'), `text ${tool === 'text' ? 'active' : ''}`),
  );
  const swatches = document.createElement('span');
  swatches.className = 'swatches';
  for (const c of ANNOT_COLORS) {
    const s = button('', 'Colour', () => {
      color = c;
      colorChosen = true;
      renderToolbar();
    }, `swatch${c === color ? ' active' : ''}`);
    s.style.background = c;
    swatches.append(s);
  }
  toolbar.append(
    swatches,
    button('🗑', 'Clear all drawings (for both of you)', () => host.emit({ kind: 'clear' })),
    button('✋ Done', 'Stop drawing — clicks go to your apps again (Esc)', () => host.emit({ kind: 'draw_mode', on: false }), 'primary'),
  );
}

function setTool(t: 'pen' | 'text') {
  finishEditor(true);
  tool = t;
  document.body.classList.toggle('text-tool', t === 'text');
  renderToolbar();
}

// Click-through mode: the window only receives (forwarded) mouse moves; over the toolbar it takes clicks.
let overToolbar = false;
document.addEventListener('mousemove', (e) => {
  const over = toolbar.contains(document.elementFromPoint(e.clientX, e.clientY));
  if (over !== overToolbar) {
    overToolbar = over;
    host.interactive(over);
  }
});
document.addEventListener('mouseleave', () => {
  if (overToolbar) {
    overToolbar = false;
    host.interactive(false);
  }
});

// ------------------------------------------------------------------ pen + ping

let drawing: { id: string; points: AnnotPoint[]; start: number; lastSent: number; moved: number } | null = null;

function strokeOf(d: NonNullable<typeof drawing>, done: boolean): AnnotStroke {
  return { id: d.id, color, width: ANNOT_WIDTH, points: simplifyPoints(d.points), done };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!drawMode || e.button !== 0) return;
  const p = overlayToShared(e.clientX, e.clientY, display, win);
  if (!p) return;
  if (tool === 'text') {
    openEditor(p);
    e.preventDefault();
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  drawing = { id: newId('o'), points: [p], start: Date.now(), lastSent: 0, moved: 0 };
});

canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = overlayToShared(e.clientX, e.clientY, display, win);
  if (!p) return;
  const last = drawing.points[drawing.points.length - 1];
  drawing.moved += Math.hypot(p[0] - last[0], p[1] - last[1]);
  drawing.points.push(p);
  const s = strokeOf(drawing, false);
  local.set(s.id, s);
  mergeLocal();
  const now = Date.now();
  if (drawing.moved > 0.004 && now - drawing.lastSent > 40) {
    drawing.lastSent = now;
    host.emit({ kind: 'stroke', stroke: s });
  }
  kick();
});

function endStroke() {
  const d = drawing;
  drawing = null;
  if (!d) return;
  if (d.moved < 0.004 && Date.now() - d.start < 400 && d.lastSent === 0) {
    local.delete(d.id);
    store.strokes.delete(`me:${d.id}`);
    const [x, y] = d.points[0];
    store.ping('me', x, y);
    host.emit({ kind: 'ping', x, y });
  } else {
    const s = strokeOf(d, true);
    local.set(s.id, s);
    mergeLocal();
    host.emit({ kind: 'stroke', stroke: s });
  }
  kick();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

// ------------------------------------------------------------------ text

let editor: { id: string; x: number; y: number; sent: boolean } | null = null;
let composing = false;
let liveTimer: ReturnType<typeof setTimeout> | null = null;

function textOf(done: boolean): AnnotText | null {
  if (!editor) return null;
  return { id: editor.id, color, x: editor.x, y: editor.y, text: editorEl.value, size: ANNOT_TEXT_SIZE, done };
}

function openEditor(p: AnnotPoint) {
  finishEditor(true);
  editor = { id: newId('ot'), x: p[0], y: p[1], sent: false };
  store.editing = editor.id;
  const r = overlayCanvasRect(display, win);
  const px = Math.max(11, ANNOT_TEXT_SIZE * Math.min(display.width, display.height));
  Object.assign(editorEl.style, {
    left: `${r.x + p[0] * r.width - 4}px`,
    top: `${r.y + p[1] * r.height - 4}px`,
    fontSize: `${px}px`,
    color,
  });
  editorEl.value = '';
  editorEl.hidden = false;
  setTimeout(() => editorEl.focus(), 0);
}

function sendLive() {
  liveTimer = null;
  const t = textOf(false);
  if (!t || composing || !t.text) return;
  editor!.sent = true;
  host.emit({ kind: 'text', text: t });
}

/** Enter / tapping away = done; Esc = cancel (an already-sent box is emptied). */
function finishEditor(keep: boolean) {
  if (!editor) return;
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = null;
  const t = textOf(true);
  if (t && keep && t.text.trim()) host.emit({ kind: 'text', text: t });
  else if (t && editor.sent) host.emit({ kind: 'text', text: { ...t, text: '' } });
  editor = null;
  store.editing = null;
  editorEl.hidden = true;
  editorEl.value = '';
  kick();
}

editorEl.addEventListener('compositionstart', () => (composing = true));
editorEl.addEventListener('compositionend', () => {
  composing = false;
  if (!liveTimer) liveTimer = setTimeout(sendLive, 150);
});
editorEl.addEventListener('input', () => {
  if (!composing && !liveTimer) liveTimer = setTimeout(sendLive, 150);
});
editorEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    finishEditor(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    finishEditor(false);
  }
});
editorEl.addEventListener('blur', () => finishEditor(true));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawMode && !editor) host.emit({ kind: 'draw_mode', on: false });
});

window.addEventListener('resize', () => {
  placeCanvas();
  kick();
});

placeCanvas();
renderToolbar();
kick();
