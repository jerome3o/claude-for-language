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
 *
 * Faces together (round 3, like Preply): when content — the board, the drawing,
 * a shared screen — is on the stage and neither camera is, BOTH cameras float
 * as ONE compact box, the other person first, then me (`pip: 'pair'`, the
 * default). The box snaps to a corner (`pairCorner`, top-left by default),
 * resizes (`pairScale`), and a tap on it goes to Speaker (`pairTap`). The
 * layout menu's "Cameras: together / separate" is the only thing that changes
 * `pip`, so a stored 'separate' is always the user's own choice and wins; a
 * layout stored before round 3 has no `pip` and reads as 'pair'.
 */

/**
 * `material` (round 4): a lesson material being presented — like a shared screen, while one is open.
 * `activity`: an in-call activity being played (shared/call-activities) — transient the same way.
 */
export type TileId = 'remote' | 'self' | 'screen' | 'material' | 'activity' | 'text' | 'draw' | 'chat';
export const ALL_TILES: TileId[] = ['remote', 'screen', 'material', 'activity', 'text', 'draw', 'chat', 'self'];
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type LayoutMode = 'focus' | 'split' | 'grid';
export type PresetId = 'speaker' | 'board' | 'screen' | 'side' | 'grid';
/** How the two cameras float over content: one box with both faces, or two separate tiles. */
export type PipMode = 'pair' | 'separate';

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
  /** Over content the two cameras float together (one box, both faces) or separately. Changed only by the user. */
  pip: PipMode;
  /** The faces box's corner. */
  pairCorner: Corner;
  /** The faces box's size as a share of the default (0.6 – 2). */
  pairScale: number;
}

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
export const MIN_SELF_SCALE = 0.6;
export const MAX_SELF_SCALE = 2;
export const MIN_PAIR_SCALE = 0.6;
export const MAX_PAIR_SCALE = 2;

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
  pip: 'pair',
  pairCorner: 'tl',
  pairScale: 1,
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
  /** A lesson material is being presented (absent = no). */
  material?: boolean;
  /** An in-call activity is running (absent = no). */
  activity?: boolean;
}

export function isAvailable(t: TileId, a: TileAvailability): boolean {
  return t === 'screen' ? a.screen : t === 'material' ? a.material === true : t === 'activity' ? a.activity === true : true;
}

/** Tiles that show only while they exist and are always "open" then: a shared screen, a presented material, an activity. */
const isTransient = (t: TileId) => t === 'screen' || t === 'material' || t === 'activity';

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
  | { type: 'close'; tile: TileId }
  /** The layout menu's "Cameras: together / separate". */
  | { type: 'pip'; pip: PipMode }
  | { type: 'pairCorner'; corner: Corner }
  | { type: 'pairScale'; scale: number }
  /** A tap (not a drag) on the faces box: the other person on the stage. */
  | { type: 'pairTap' }
  /** The other person starts sharing: their screen on the stage; the cameras float as the user chose (`pip`). */
  | { type: 'shareStarted' }
  /** A lesson material is now presented (by either person): it goes on the stage, the cameras float. */
  | { type: 'materialStarted' }
  /** An in-call activity started (by either person): it goes on the stage, the cameras float. */
  | { type: 'activityStarted' }
  /** A tile dragged (or moved from its menu) onto a drop zone of the stage (`layoutForDrop`). */
  | { type: 'drop'; tile: TileId; zone: DropZone }
  /**
   * The tutor showed this tile to the student ("Show for student", shared/calls/follow.ts): it goes
   * on the stage with the cameras floating — unless it is already there (a split keeps its partner).
   */
  | { type: 'shown'; tile: TileId };

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
    case 'pip':
      return { ...l, pip: action.pip === 'separate' ? 'separate' : 'pair' };
    case 'pairCorner':
      return { ...l, pairCorner: action.corner };
    case 'pairScale':
      return { ...l, pairScale: clamp(action.scale, MIN_PAIR_SCALE, MAX_PAIR_SCALE) };
    case 'pairTap':
      return layoutReducer(l, { type: 'preset', preset: 'speaker' });
    case 'shareStarted':
      return layoutReducer(l, { type: 'preset', preset: 'screen' });
    case 'drop':
      return layoutForDrop(l, action.tile, action.zone);
    case 'materialStarted':
      return { ...l, mode: 'focus', main: 'material', remoteFloat: true };
    case 'activityStarted':
      return { ...l, mode: 'focus', main: 'activity', remoteFloat: true };
    case 'shown': {
      const open = withOpen(l, action.tile);
      const onStage = l.mode === 'focus' ? l.main === action.tile : l.mode === 'split' ? l.main === action.tile || l.second === action.tile : false;
      if (onStage) return { ...l, open };
      return { ...l, mode: 'focus', main: action.tile, remoteFloat: true, open };
    }
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
  /** Both cameras together in one floating box (in this corner), or null. */
  pair: Corner | null;
  mode: LayoutMode;
}

export const NARROW_WIDTH = 640;

/** The tile a missing one falls back to (a screen share that ended → the camera). */
function present(t: TileId, a: TileAvailability): TileId {
  return isAvailable(t, a) ? t : 'remote';
}

/**
 * Phones keep one tile on the stage — except a shared screen with a board
 * (round 4: read the slide and write about it at once), which may split:
 * stacked in portrait, side by side in landscape (`splitDirFor`).
 */
export function narrowSplitAllowed(l: Pick<CallLayout, 'mode' | 'main' | 'second'>): boolean {
  if (l.mode !== 'split') return false;
  const pair = [l.main, l.second];
  return (pair.includes('screen') || pair.includes('material')) && (pair.includes('text') || pair.includes('draw'));
}

/** The direction a split is drawn in: the user's on wide screens; on a phone by its orientation. */
export function splitDirFor(l: Pick<CallLayout, 'dir'>, box: { w: number; h: number }): 'row' | 'column' {
  if (box.w >= NARROW_WIDTH) return l.dir;
  return box.w > box.h ? 'row' : 'column';
}

export function arrangeTiles(l: CallLayout, a: TileAvailability, width: number): Arrangement {
  const narrow = width < NARROW_WIDTH;
  const openTiles = ALL_TILES.filter((t) => isAvailable(t, a) && (l.open.includes(t) || t === 'remote' || t === 'self' || isTransient(t)));
  const content = l.main === 'screen' || l.second === 'screen' ? a.screen : a.material === true;
  let mode: LayoutMode = narrow ? (narrowSplitAllowed(l) && content ? 'split' : 'focus') : l.mode;
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
  // Content on the stage and neither camera: both faces together in one box (the other person first).
  if (l.pip === 'pair' && mode !== 'grid' && !stage.includes('remote') && !stage.includes('self') && (l.remoteFloat || narrow)) {
    const rail = narrow ? [] : openTiles.filter((t) => !stage.includes(t) && t !== 'remote' && t !== 'self');
    return { stage, rail, floating, pair: l.pairCorner, mode };
  }
  // The other person's camera: never hidden.
  if (!stage.includes('remote') && (l.remoteFloat || narrow)) floating.push({ tile: 'remote', corner: l.remoteCorner === l.selfCorner ? otherCorner(l.selfCorner) : l.remoteCorner });
  // My camera floats unless it's on the stage (in a grid it's a tile).
  if (!stage.includes('self')) floating.push({ tile: 'self', corner: l.selfCorner });
  const floated = new Set(floating.map((f) => f.tile));
  const rail = narrow ? [] : openTiles.filter((t) => !stage.includes(t) && !floated.has(t));
  return { stage, rail, floating, pair: null, mode };
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
  return ALL_TILES.filter((t) => t !== 'self' && isAvailable(t, a) && (t === 'remote' || isTransient(t) || l.open.includes(t)));
}

/** Phones: swipe left (+1) / right (-1) from the focused tile. */
export function swipeFocus(l: CallLayout, a: TileAvailability, delta: 1 | -1): CallLayout {
  const order = swipeOrder(l, a);
  const cur = order.indexOf(present(l.main, a));
  const next = order[Math.min(order.length - 1, Math.max(0, (cur < 0 ? 0 : cur) + delta))];
  return next ? { ...l, mode: 'focus', main: next } : l;
}

/** Keyboard shortcut → action (desktop; null = not ours). */
/** The board is on the stage (focus / split, not a grid). */
export function boardOnStage(l: CallLayout): boolean {
  return l.mode !== 'grid' && (l.main === 'text' || l.main === 'draw' || (l.mode === 'split' && (l.second === 'text' || l.second === 'draw')));
}

/**
 * The 📝 button: back to the camera when the board is up; otherwise the board —
 * focused with the faces over it (phones, a split, cameras together), or the
 * "Board + camera" split when the user keeps the cameras separate on a wide screen.
 */
export function boardButton(l: CallLayout, narrow: boolean): LayoutAction {
  if (boardOnStage(l)) return { type: 'focus', tile: 'remote' };
  if (l.mode === 'split' || narrow || l.pip === 'pair') return { type: 'focus', tile: 'text' };
  return { type: 'preset', preset: 'board' };
}

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
    case 'm':
      return { type: 'focus', tile: 'material' };
    case 'a':
      return { type: 'focus', tile: 'activity' };
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
    // Before round 3 there was no choice: a missing / odd value = together.
    pip: r.pip === 'separate' ? 'separate' : 'pair',
    pairCorner: corner(r.pairCorner, DEFAULT_LAYOUT.pairCorner),
    pairScale: num(r.pairScale, 1, MIN_PAIR_SCALE, MAX_PAIR_SCALE),
  };
}

// ------------------------------------------------------------------ rectangles

export interface TileBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TileRole = 'stage' | 'rail' | 'floating' | 'pair' | 'hidden';

export interface TileRect extends TileBox {
  role: TileRole;
  /** Stacking: stage 1, rail 1, floating 3 (self above remote: 4), a face in the pair 3. */
  z: number;
}

export interface LayoutRects {
  tiles: Record<TileId, TileRect>;
  /** The split's draggable divider (null unless split). */
  divider: (TileBox & { dir: 'row' | 'column' }) | null;
  /** The stage area (the box minus the rail). */
  stage: TileBox;
  /** The faces box (both cameras inside it), or null. */
  pair: (TileBox & { corner: Corner }) | null;
  /**
   * Room the text board leaves at its top so the faces box in a top corner over
   * it never hides its first lines (round 4: it covered the start of the text
   * in the default layout). Pixels from the tile's top edge, 0 = none.
   */
  textInsetTop: number;
}

export const TILE_GAP = 8;
export const DIVIDER = 12;
const FLOAT_MARGIN = 12;
/** Inside the faces box: padding around the faces and the gap between them. */
export const PAIR_PAD = 4;
export const PAIR_GAP = 4;
/**
 * The controls along the top of a content tile — the Board / Draw tabs (48), on
 * the drawing also its tool row (+56), on a shared screen the "✏️ Draw on it"
 * row (56): in a top corner the faces box sits below them, never over them.
 */
export const TILE_HEADER: Partial<Record<TileId, number>> = { text: 48, draw: 104, screen: 56, material: 56, activity: 48 };

/** A face's shape in the pair: the camera's, kept between portrait 3:4 and 16:9. */
function faceAspect(a: number | undefined): number {
  return clamp(a !== undefined && a > 0 && Number.isFinite(a) ? a : 4 / 3, 3 / 4, 16 / 9);
}

/**
 * The faces box: one height for both faces (~15 % of the stage's shorter side,
 * phones ~16 % and smaller), each face as wide as its camera, × scale; kept
 * within 60 % of the stage's width (phones 70 %) and 40 % of its height.
 */
export function pairSize(
  stage: TileBox,
  aspects: Partial<Record<TileId, number>>,
  scale: number,
  narrow: boolean,
): { w: number; h: number; faceH: number; remoteW: number; selfW: number } {
  const short = Math.min(stage.w, stage.h);
  const ar = faceAspect(aspects.remote);
  const as = faceAspect(aspects.self);
  const base = clamp(short * (narrow ? 0.16 : 0.15), narrow ? 56 : 72, narrow ? 96 : 140) * scale;
  const maxW = stage.w * (narrow ? 0.7 : 0.6) - 2 * PAIR_PAD - PAIR_GAP;
  const maxH = stage.h * 0.4 - 2 * PAIR_PAD;
  const k = Math.max(0, Math.min(1, maxW / (base * (ar + as)), maxH / base));
  const faceH = Math.round(base * k);
  const remoteW = Math.round(faceH * ar);
  const selfW = Math.round(faceH * as);
  return { w: remoteW + selfW + PAIR_GAP + 2 * PAIR_PAD, h: faceH + 2 * PAIR_PAD, faceH, remoteW, selfW };
}

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
    if (splitDirFor(l, box) === 'row') {
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
  let pair: LayoutRects['pair'] = null;
  if (arr.pair) {
    const s = pairSize(stage, aspects, l.pairScale, narrow);
    const at = cornerRect(stage, arr.pair, s.w, s.h);
    const top = arr.pair === 'tl' || arr.pair === 'tr';
    if (top) {
      // Below the Board / Draw tabs of the board tile under this corner.
      const px = at.x + s.w / 2;
      const py = at.y;
      const under = arr.stage.find((t) => {
        const r = tiles[t];
        return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
      });
      if (under) at.y += TILE_HEADER[under] ?? 0;
    }
    pair = { ...at, corner: arr.pair };
    tiles.remote = { x: at.x + PAIR_PAD, y: at.y + PAIR_PAD, w: s.remoteW, h: s.faceH, role: 'pair', z: 3 };
    tiles.self = { x: at.x + PAIR_PAD + s.remoteW + PAIR_GAP, y: at.y + PAIR_PAD, w: s.selfW, h: s.faceH, role: 'pair', z: 3 };
  }
  let textInsetTop = 0;
  const text = tiles.text;
  if (pair && (pair.corner === 'tl' || pair.corner === 'tr') && text.role === 'stage') {
    const overlapsX = pair.x < text.x + text.w && pair.x + pair.w > text.x;
    const overlapsY = pair.y < text.y + text.h && pair.y + pair.h > text.y;
    // Below the box, minus the tabs the board draws itself.
    if (overlapsX && overlapsY) textInsetTop = Math.max(0, Math.round(pair.y + pair.h + 4 - text.y - (TILE_HEADER.text ?? 0)));
  }
  return { tiles, divider, stage, pair, textInsetTop };
}

// ------------------------------------------------------------------ drag and drop (round 4)

/**
 * Desktop: drag a tile (from the rail, or a tile's header) onto the stage. The
 * stage shows five drop zones — its left / right / top / bottom half and the
 * whole of it — and dropping arranges a split (or a focus) with that tile; the
 * faces float as usual. The keyboard / menu fallback dispatches the same
 * `drop` action.
 */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'full';
export const DROP_ZONES: DropZone[] = ['left', 'right', 'top', 'bottom', 'full'];
/** Within this share of the stage from an edge, a point is in that edge's half-zone; further in, `full`. */
export const DROP_EDGE = 0.3;

/** The zone under a point given as fractions (0–1) of the stage. */
export function dropZoneAt(fx: number, fy: number): DropZone {
  const x = clamp(fx, 0, 1);
  const y = clamp(fy, 0, 1);
  const edges: [DropZone, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  let best = edges[0];
  for (const e of edges) if (e[1] < best[1]) best = e;
  return best[1] < DROP_EDGE ? best[0] : 'full';
}

/** The area a zone highlights (where the tile will go), inside the stage. */
export function dropZoneBox(zone: DropZone, stage: TileBox): TileBox {
  const hw = Math.round(stage.w / 2);
  const hh = Math.round(stage.h / 2);
  switch (zone) {
    case 'left':
      return { x: stage.x, y: stage.y, w: hw, h: stage.h };
    case 'right':
      return { x: stage.x + stage.w - hw, y: stage.y, w: hw, h: stage.h };
    case 'top':
      return { x: stage.x, y: stage.y, w: stage.w, h: hh };
    case 'bottom':
      return { x: stage.x, y: stage.y + stage.h - hh, w: stage.w, h: hh };
    default:
      return { ...stage };
  }
}

/**
 * The layout after dropping `tile` on `zone`. `full` focuses it. A half puts
 * it on that side and keeps, beside it, the tile that was on the stage — in a
 * split, the pane on the OTHER side (so dropping on the left replaces the left
 * pane). A fresh split starts at half / half; one in the same direction keeps
 * its divider.
 */
export function layoutForDrop(l: CallLayout, tile: TileId, zone: DropZone): CallLayout {
  if (zone === 'full') return { ...layoutReducer(l, { type: 'focus', tile }), mode: 'focus', main: tile };
  const first = zone === 'left' || zone === 'top';
  const dir: 'row' | 'column' = zone === 'left' || zone === 'right' ? 'row' : 'column';
  let keep: TileId;
  if (l.mode === 'split') {
    keep = first ? l.second : l.main;
    if (keep === tile) keep = first ? l.main : l.second;
  } else keep = l.main;
  if (keep === tile) return { ...layoutReducer(l, { type: 'focus', tile }), mode: 'focus', main: tile };
  const ratio = l.mode === 'split' && l.dir === dir ? l.ratio : 0.5;
  const next = layoutReducer(l, { type: 'split', a: first ? tile : keep, b: first ? keep : tile });
  return { ...next, dir, ratio };
}

/** Keyboard / menu fallback: the zones offered for a tile ("Move to: left half …"), with their labels. */
export const DROP_ZONE_LABELS: Record<DropZone, string> = {
  left: 'Left half',
  right: 'Right half',
  top: 'Top half',
  bottom: 'Bottom half',
  full: 'Whole stage',
};
