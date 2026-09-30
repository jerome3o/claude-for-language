/**
 * The call's layout, as tiles — pure rules both apps follow (the Lab app's
 * CallLayout.kt is parity-tested against these).
 *
 * Tiles: the other person's camera (`remote`), my camera (`self`), a shared
 * screen (`screen` — theirs or mine), the text board (`text`), the drawing
 * board (`draw`) and the chat (`chat`). A layout is one of:
 * - `focus`  — one tile on the main stage, the rest in a filmstrip / side rail;
 * - `split`  — two tiles side by side (or stacked) with a draggable divider;
 * - `grid`   — every open tile at once.
 * The other person's camera is never hidden: when it isn't on the stage it
 * floats over it (or sits in the rail when floating is off). My own camera
 * floats in a corner (snapped; resizable) unless it is on the stage.
 *
 * Phones (narrow: < 640 px wide) use `focus` only: the focused tile fills the
 * screen, a swipe moves to the next one (`swipeFocus`), and the cameras float.
 */

export type TileId = 'remote' | 'self' | 'screen' | 'text' | 'draw' | 'chat';
export const ALL_TILES: TileId[] = ['remote', 'screen', 'text', 'draw', 'chat', 'self'];
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type LayoutMode = 'focus' | 'split' | 'grid';
export type PresetId = 'speaker' | 'board' | 'screen' | 'side' | 'grid';

export interface CallLayout {
  mode: LayoutMode;
  /** The focused tile (focus) / the first tile (split). */
  main: TileId;
  /** The second tile of a split. */
  second: TileId;
  /** The first tile's share of a split, 0.2 – 0.8. */
  ratio: number;
  /** Split direction on wide screens: side by side or stacked. */
  dir: 'row' | 'column';
  /** My floating camera. */
  selfCorner: Corner;
  /** Floating camera size as a share of the default (0.6 – 2). */
  selfScale: number;
  /** The other person's camera floats over the stage when it isn't on it (else it goes in the rail). */
  remoteFloat: boolean;
  remoteCorner: Corner;
  /** Which tiles are open (boards / chat can be closed; cameras and a screen are open while they exist). */
  open: TileId[];
}

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
export const MIN_SELF_SCALE = 0.6;
export const MAX_SELF_SCALE = 2;

export const DEFAULT_LAYOUT: CallLayout = {
  mode: 'focus',
  main: 'remote',
  second: 'text',
  ratio: 0.62,
  dir: 'row',
  selfCorner: 'br',
  selfScale: 1,
  remoteFloat: true,
  remoteCorner: 'tr',
  open: ['remote', 'self'],
};

export interface PresetInfo {
  id: PresetId;
  label: string;
  /** Keyboard shortcut on desktop (with no modifier, outside text fields). */
  key: string;
}

export const PRESETS: PresetInfo[] = [
  { id: 'speaker', label: 'Speaker', key: '1' },
  { id: 'board', label: 'Board + camera', key: '2' },
  { id: 'screen', label: 'Screen + camera', key: '3' },
  { id: 'side', label: 'Side by side', key: '4' },
  { id: 'grid', label: 'Grid', key: '5' },
];

/** What exists right now (a screen tile only while someone shares). */
export interface TileAvailability {
  screen: boolean;
}

export function isAvailable(t: TileId, a: TileAvailability): boolean {
  return t === 'screen' ? a.screen : true;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function withOpen(l: CallLayout, ...tiles: TileId[]): TileId[] {
  const set = new Set(l.open);
  tiles.forEach((t) => set.add(t));
  return ALL_TILES.filter((t) => set.has(t));
}

export type LayoutAction =
  | { type: 'focus'; tile: TileId }
  | { type: 'preset'; preset: PresetId }
  | { type: 'split'; a: TileId; b: TileId }
  /** Put `to` where `from` is (Board ⇄ Draw in the same place). */
  | { type: 'swap'; from: TileId; to: TileId }
  | { type: 'ratio'; ratio: number }
  | { type: 'dir'; dir: 'row' | 'column' }
  | { type: 'selfCorner'; corner: Corner }
  | { type: 'selfScale'; scale: number }
  | { type: 'remoteCorner'; corner: Corner }
  | { type: 'remoteFloat'; on: boolean }
  | { type: 'open'; tile: TileId }
  | { type: 'close'; tile: TileId };

export function layoutReducer(l: CallLayout, action: LayoutAction): CallLayout {
  switch (action.type) {
    case 'focus':
      // Focusing a tile that is already the only one on the stage returns to the camera.
      if (l.mode === 'focus' && l.main === action.tile && action.tile !== 'remote') return { ...l, main: 'remote' };
      return { ...l, mode: 'focus', main: action.tile, open: withOpen(l, action.tile) };
    case 'split':
      if (action.a === action.b) return layoutReducer(l, { type: 'focus', tile: action.a });
      return { ...l, mode: 'split', main: action.a, second: action.b, open: withOpen(l, action.a, action.b) };
    case 'preset':
      switch (action.preset) {
        case 'speaker':
          return { ...l, mode: 'focus', main: 'remote', remoteFloat: true };
        case 'board':
          return { ...l, mode: 'split', main: 'text', second: 'remote', ratio: 0.65, dir: 'row', open: withOpen(l, 'text') };
        case 'screen':
          return { ...l, mode: 'focus', main: 'screen', remoteFloat: true };
        case 'side':
          return { ...l, mode: 'split', main: 'remote', second: 'self', ratio: 0.5, dir: 'row' };
        case 'grid':
          return { ...l, mode: 'grid' };
      }
      return l;
    case 'swap': {
      const open = withOpen(l, action.to);
      if (l.mode === 'split') {
        if (l.main === action.from) return { ...l, main: action.to, second: l.second === action.to ? action.from : l.second, open };
        if (l.second === action.from) return { ...l, second: action.to, main: l.main === action.to ? action.from : l.main, open };
      }
      if (l.mode === 'focus' && l.main === action.from) return { ...l, main: action.to, open };
      return { ...l, open };
    }
    case 'ratio':
      return { ...l, ratio: clamp(action.ratio, MIN_RATIO, MAX_RATIO) };
    case 'dir':
      return { ...l, dir: action.dir };
    case 'selfCorner':
      return { ...l, selfCorner: action.corner };
    case 'selfScale':
      return { ...l, selfScale: clamp(action.scale, MIN_SELF_SCALE, MAX_SELF_SCALE) };
    case 'remoteCorner':
      return { ...l, remoteCorner: action.corner };
    case 'remoteFloat':
      return { ...l, remoteFloat: action.on };
    case 'open':
      return { ...l, open: withOpen(l, action.tile) };
    case 'close': {
      if (action.tile === 'remote' || action.tile === 'self') return l; // cameras can't be closed
      const open = l.open.filter((t) => t !== action.tile);
      let next: CallLayout = { ...l, open };
      if (l.mode === 'focus' && l.main === action.tile) next = { ...next, main: 'remote' };
      if (l.mode === 'split' && (l.main === action.tile || l.second === action.tile)) {
        const other = l.main === action.tile ? l.second : l.main;
        next = { ...next, mode: 'focus', main: other };
      }
      return next;
    }
  }
}

/** Where every tile goes, for this layout, what exists, and the screen width. */
export interface Arrangement {
  /** Tiles on the main stage, in order (1 = focus, 2 = split, n = grid). */
  stage: TileId[];
  /** Tiles in the filmstrip / side rail (tap to focus). */
  rail: TileId[];
  /** Floating tiles (cameras), with their corner. */
  floating: { tile: TileId; corner: Corner }[];
  mode: LayoutMode;
}

export const NARROW_WIDTH = 640;

/** The tile a missing one falls back to (a screen share that ended → the camera). */
function present(t: TileId, a: TileAvailability): TileId {
  return isAvailable(t, a) ? t : 'remote';
}

export function arrangeTiles(l: CallLayout, a: TileAvailability, width: number): Arrangement {
  const narrow = width < NARROW_WIDTH;
  const openTiles = ALL_TILES.filter((t) => isAvailable(t, a) && (l.open.includes(t) || t === 'remote' || t === 'self' || t === 'screen'));
  let mode: LayoutMode = narrow ? 'focus' : l.mode;
  let stage: TileId[];
  if (mode === 'grid') {
    stage = openTiles;
  } else if (mode === 'split') {
    const first = present(l.main, a);
    const second = present(l.second, a);
    if (first === second) {
      mode = 'focus';
      stage = [first];
    } else stage = [first, second];
  } else {
    stage = [present(l.main, a)];
  }
  const floating: { tile: TileId; corner: Corner }[] = [];
  // The other person's camera: never hidden.
  if (!stage.includes('remote') && (l.remoteFloat || narrow)) floating.push({ tile: 'remote', corner: l.remoteCorner === l.selfCorner ? otherCorner(l.selfCorner) : l.remoteCorner });
  // My camera floats unless it's on the stage (in a grid it's a tile).
  if (!stage.includes('self')) floating.push({ tile: 'self', corner: l.selfCorner });
  const floated = new Set(floating.map((f) => f.tile));
  const rail = narrow ? [] : openTiles.filter((t) => !stage.includes(t) && !floated.has(t));
  return { stage, rail, floating, mode };
}

/** The nearest free corner for a second floating camera. */
export function otherCorner(c: Corner): Corner {
  return c === 'br' ? 'tr' : c === 'tr' ? 'br' : c === 'bl' ? 'tl' : 'bl';
}

/** Snap a dropped floating tile (its centre, as fractions of the stage) to the nearest corner. */
export function snapCorner(cx: number, cy: number): Corner {
  const top = cy < 0.5;
  const left = cx < 0.5;
  return top ? (left ? 'tl' : 'tr') : left ? 'bl' : 'br';
}

/** Phones: the order a swipe walks through (only what is open and exists). */
export function swipeOrder(l: CallLayout, a: TileAvailability): TileId[] {
  return ALL_TILES.filter((t) => t !== 'self' && isAvailable(t, a) && (t === 'remote' || t === 'screen' || l.open.includes(t)));
}

/** Phones: swipe left (+1) / right (-1) from the focused tile. */
export function swipeFocus(l: CallLayout, a: TileAvailability, delta: 1 | -1): CallLayout {
  const order = swipeOrder(l, a);
  const cur = order.indexOf(present(l.main, a));
  const next = order[Math.min(order.length - 1, Math.max(0, (cur < 0 ? 0 : cur) + delta))];
  return next ? { ...l, mode: 'focus', main: next } : l;
}

/** Keyboard shortcut → action (desktop; null = not ours). */
export function layoutShortcut(key: string): LayoutAction | null {
  const preset = PRESETS.find((p) => p.key === key);
  if (preset) return { type: 'preset', preset: preset.id };
  switch (key.toLowerCase()) {
    case 'b':
      return { type: 'focus', tile: 'text' };
    case 'd':
      return { type: 'focus', tile: 'draw' };
    case 'c':
      return { type: 'focus', tile: 'chat' };
    case 'v':
      return { type: 'focus', tile: 'remote' };
    case 's':
      return { type: 'focus', tile: 'screen' };
    default:
      return null;
  }
}

/** Stored layouts are validated; anything odd falls back to the default. */
export function sanitizeLayout(raw: unknown): CallLayout {
  if (!raw || typeof raw !== 'object') return DEFAULT_LAYOUT;
  const r = raw as Record<string, unknown>;
  const tile = (v: unknown, d: TileId): TileId => (ALL_TILES.includes(v as TileId) ? (v as TileId) : d);
  const corner = (v: unknown, d: Corner): Corner => (['tl', 'tr', 'bl', 'br'].includes(v as string) ? (v as Corner) : d);
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  const open = Array.isArray(r.open) ? ALL_TILES.filter((t) => (r.open as unknown[]).includes(t)) : DEFAULT_LAYOUT.open;
  return {
    mode: ['focus', 'split', 'grid'].includes(r.mode as string) ? (r.mode as LayoutMode) : DEFAULT_LAYOUT.mode,
    main: tile(r.main, DEFAULT_LAYOUT.main),
    second: tile(r.second, DEFAULT_LAYOUT.second),
    ratio: num(r.ratio, DEFAULT_LAYOUT.ratio, MIN_RATIO, MAX_RATIO),
    dir: r.dir === 'column' ? 'column' : 'row',
    selfCorner: corner(r.selfCorner, DEFAULT_LAYOUT.selfCorner),
    selfScale: num(r.selfScale, 1, MIN_SELF_SCALE, MAX_SELF_SCALE),
    remoteFloat: typeof r.remoteFloat === 'boolean' ? r.remoteFloat : true,
    remoteCorner: corner(r.remoteCorner, DEFAULT_LAYOUT.remoteCorner),
    open: Array.from(new Set<TileId>(['remote', 'self', ...open])).filter((t) => ALL_TILES.includes(t)),
  };
}

// ------------------------------------------------------------------ rectangles

export interface TileBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TileRole = 'stage' | 'rail' | 'floating' | 'hidden';

export interface TileRect extends TileBox {
  role: TileRole;
  /** Stacking: stage 1, rail 1, floating 3 (self above remote: 4). */
  z: number;
}

export interface LayoutRects {
  tiles: Record<TileId, TileRect>;
  /** The split's draggable divider (null unless split). */
  divider: (TileBox & { dir: 'row' | 'column' }) | null;
  /** The stage area (the box minus the rail). */
  stage: TileBox;
}

export const TILE_GAP = 8;
export const DIVIDER = 12;
const FLOAT_MARGIN = 12;

/** A floating camera's size: ~⅓ of the stage's shorter side (phones ~28 %), shaped like the video, × scale. */
export function floatingSize(stage: TileBox, aspect: number, scale: number, narrow: boolean): { w: number; h: number } {
  const short = Math.min(stage.w, stage.h);
  const base = Math.min(narrow ? 150 : 260, Math.max(88, short * (narrow ? 0.3 : 0.26))) * scale;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 4 / 3;
  // `base` is the longer side.
  const w = a >= 1 ? base : base * a;
  const h = a >= 1 ? base / a : base;
  const maxW = stage.w * 0.5;
  const maxH = stage.h * 0.5;
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

function cornerRect(stage: TileBox, corner: Corner, w: number, h: number): TileBox {
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  return {
    x: Math.round(left ? stage.x + FLOAT_MARGIN : stage.x + stage.w - w - FLOAT_MARGIN),
    y: Math.round(top ? stage.y + FLOAT_MARGIN : stage.y + stage.h - h - FLOAT_MARGIN),
    w,
    h,
  };
}

/** Grid columns for n tiles in a w × h area (tiles as close to 16:9 as possible). */
export function gridColumns(n: number, w: number, h: number): number {
  let best = 1;
  let bestScore = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tw = (w - TILE_GAP * (cols - 1)) / cols;
    const th = (h - TILE_GAP * (rows - 1)) / rows;
    const fit = Math.min(tw, (th * 16) / 9); // the width a 16:9 picture gets
    if (fit > bestScore + 0.5) {
      best = cols;
      bestScore = fit;
    }
  }
  return best;
}

/**
 * Where every tile is drawn in a box of `box` (the call's stage, controls
 * excluded), for an arrangement. `aspects` are the cameras' shapes (w / h).
 */
export function layoutRects(
  l: CallLayout,
  arr: Arrangement,
  box: { w: number; h: number },
  aspects: Partial<Record<TileId, number>> = {},
): LayoutRects {
  const narrow = box.w < NARROW_WIDTH;
  const hidden: TileRect = { x: 0, y: 0, w: 0, h: 0, role: 'hidden', z: 0 };
  const tiles = Object.fromEntries(ALL_TILES.map((t) => [t, { ...hidden }])) as Record<TileId, TileRect>;
  // The rail: a column on the right (wide) or a strip along the bottom (medium widths).
  let stage: TileBox = { x: 0, y: 0, w: box.w, h: box.h };
  if (arr.rail.length > 0) {
    if (box.w >= 1024) {
      const rw = Math.round(Math.min(240, Math.max(160, box.w * 0.16)));
      const th = Math.round((rw * 9) / 16);
      stage = { x: 0, y: 0, w: box.w - rw - TILE_GAP, h: box.h };
      arr.rail.forEach((t, i) => {
        tiles[t] = { x: box.w - rw, y: i * (th + TILE_GAP), w: rw, h: th, role: 'rail', z: 1 };
      });
    } else {
      const rh = Math.round(Math.min(120, Math.max(72, box.h * 0.16)));
      const tw = Math.round((rh * 16) / 9);
      stage = { x: 0, y: 0, w: box.w, h: box.h - rh - TILE_GAP };
      arr.rail.forEach((t, i) => {
        tiles[t] = { x: i * (tw + TILE_GAP), y: box.h - rh, w: tw, h: rh, role: 'rail', z: 1 };
      });
    }
  }
  let divider: LayoutRects['divider'] = null;
  if (arr.mode === 'split' && arr.stage.length === 2) {
    const [a, b] = arr.stage;
    if (l.dir === 'row') {
      const aw = Math.round((stage.w - DIVIDER) * l.ratio);
      tiles[a] = { x: stage.x, y: stage.y, w: aw, h: stage.h, role: 'stage', z: 1 };
      tiles[b] = { x: stage.x + aw + DIVIDER, y: stage.y, w: stage.w - aw - DIVIDER, h: stage.h, role: 'stage', z: 1 };
      divider = { x: stage.x + aw, y: stage.y, w: DIVIDER, h: stage.h, dir: 'row' };
    } else {
      const ah = Math.round((stage.h - DIVIDER) * l.ratio);
      tiles[a] = { x: stage.x, y: stage.y, w: stage.w, h: ah, role: 'stage', z: 1 };
      tiles[b] = { x: stage.x, y: stage.y + ah + DIVIDER, w: stage.w, h: stage.h - ah - DIVIDER, role: 'stage', z: 1 };
      divider = { x: stage.x, y: stage.y + ah, w: stage.w, h: DIVIDER, dir: 'column' };
    }
  } else if (arr.mode === 'grid') {
    const n = arr.stage.length;
    const cols = gridColumns(n, stage.w, stage.h);
    const rows = Math.ceil(n / cols);
    const tw = (stage.w - TILE_GAP * (cols - 1)) / cols;
    const th = (stage.h - TILE_GAP * (rows - 1)) / rows;
    arr.stage.forEach((t, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      tiles[t] = { x: Math.round(stage.x + c * (tw + TILE_GAP)), y: Math.round(stage.y + r * (th + TILE_GAP)), w: Math.round(tw), h: Math.round(th), role: 'stage', z: 1 };
    });
  } else if (arr.stage[0]) {
    tiles[arr.stage[0]] = { ...stage, role: 'stage', z: 1 };
  }
  for (const f of arr.floating) {
    const scale = f.tile === 'self' ? l.selfScale : narrow ? 0.9 : 1;
    const { w, h } = floatingSize(stage, aspects[f.tile] ?? 4 / 3, scale, narrow);
    tiles[f.tile] = { ...cornerRect(stage, f.corner, w, h), role: 'floating', z: f.tile === 'self' ? 4 : 3 };
  }
  return { tiles, divider, stage };
}
