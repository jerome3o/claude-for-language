/**
 * Video calls round 2 (PR B): the call's tile layout (shared/calls/layout.ts).
 * Writes calls-layout.json; checked by core/…/calls/CallsLayoutParityTest.kt.
 *
 * Random action sequences from DEFAULT_LAYOUT (plus phone swipes), and after every step the layout,
 * the arrangement for a sweep of widths × screen / no screen, and the rectangles for a sweep of
 * boxes × camera shapes. Plus direct vectors for the helpers and sanitizeLayout.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_TILES,
  DEFAULT_LAYOUT,
  PRESETS,
  arrangeTiles,
  floatingSize,
  gridColumns,
  layoutReducer,
  layoutRects,
  layoutShortcut,
  otherCorner,
  sanitizeLayout,
  snapCorner,
  swipeFocus,
  swipeOrder,
  type CallLayout,
  type Corner,
  type LayoutAction,
  type TileId,
} from '../../../shared/calls/layout';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261001);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const corners: Corner[] = ['tl', 'tr', 'bl', 'br'];
const presets = PRESETS.map((p) => p.id);

type Step = LayoutAction | { type: 'swipe'; delta: 1 | -1; screen: boolean };

function randomAction(): Step {
  const t = pick(['focus', 'focus', 'preset', 'preset', 'split', 'swap', 'ratio', 'dir', 'selfCorner', 'selfScale', 'remoteCorner', 'remoteFloat', 'open', 'close', 'close', 'swipe'] as const);
  switch (t) {
    case 'focus':
      return { type: 'focus', tile: pick(ALL_TILES) };
    case 'preset':
      return { type: 'preset', preset: pick(presets) };
    case 'split':
      return { type: 'split', a: pick(ALL_TILES), b: pick(ALL_TILES) };
    case 'swap':
      return r() < 0.7 ? { type: 'swap', from: pick(['text', 'draw'] as TileId[]), to: pick(['text', 'draw'] as TileId[]) } : { type: 'swap', from: pick(ALL_TILES), to: pick(ALL_TILES) };
    case 'ratio':
      return { type: 'ratio', ratio: r() * 1.3 - 0.15 };
    case 'dir':
      return { type: 'dir', dir: r() < 0.5 ? 'row' : 'column' };
    case 'selfCorner':
      return { type: 'selfCorner', corner: pick(corners) };
    case 'selfScale':
      return { type: 'selfScale', scale: r() * 2.8 };
    case 'remoteCorner':
      return { type: 'remoteCorner', corner: pick(corners) };
    case 'remoteFloat':
      return { type: 'remoteFloat', on: r() < 0.5 };
    case 'open':
      return { type: 'open', tile: pick(ALL_TILES) };
    case 'close':
      return { type: 'close', tile: pick(ALL_TILES) };
    case 'swipe':
      return { type: 'swipe', delta: r() < 0.5 ? 1 : -1, screen: r() < 0.5 };
  }
}

const widths = [320, 412, 639, 640, 700, 840, 1023, 1024, 1440];
const boxes = [
  { w: 412, h: 800 },
  { w: 412, h: 915 },
  { w: 700, h: 900 },
  { w: 840, h: 880 },
  { w: 1024, h: 700 },
  { w: 1440, h: 800 },
];
const aspectSets: Partial<Record<TileId, number>>[] = [{}, { remote: 16 / 9, self: 3 / 4 }, { remote: 9 / 16, self: 4 / 3 }, { remote: 1, self: 0 }];

function snapshot(l: CallLayout) {
  const arrangements = [false, true].flatMap((screen) => widths.map((width) => ({ screen, width, arr: arrangeTiles(l, { screen }, width) })));
  const rects = [false, true].flatMap((screen) =>
    boxes.flatMap((box) =>
      aspectSets.map((aspects, ai) => ({ screen, w: box.w, h: box.h, aspects: ai, rects: layoutRects(l, arrangeTiles(l, { screen }, box.w), box, aspects) })),
    ),
  );
  return { layout: l, swipe_order: [false, true].map((screen) => swipeOrder(l, { screen })), arrangements, rects };
}

const sequences = [];
// The presets from the default first (the screenshots' layouts), then random walks.
for (const p of presets) {
  const l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: p });
  sequences.push({ steps: [{ action: { type: 'preset', preset: p }, ...snapshot(l) }] });
}
for (let s = 0; s < 36; s++) {
  let l = DEFAULT_LAYOUT;
  const steps = [];
  const n = 3 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = randomAction();
    l = a.type === 'swipe' ? swipeFocus(l, { screen: a.screen }, a.delta) : layoutReducer(l, a);
    steps.push({ action: a, ...snapshot(l) });
  }
  sequences.push({ steps });
}

// Helpers.
const floating = [];
for (let i = 0; i < 200; i++) {
  const stage = { x: Math.floor(r() * 40), y: Math.floor(r() * 40), w: Math.floor(200 + r() * 1400), h: Math.floor(200 + r() * 900) };
  const aspect = pick([16 / 9, 4 / 3, 1, 3 / 4, 9 / 16, 0, -1, NaN, r() * 3]);
  const scale = pick([0.6, 1, 1.5, 2, r() * 2]);
  const narrow = r() < 0.5;
  floating.push({ stage, aspect: Number.isNaN(aspect) ? 'NaN' : aspect, scale, narrow, size: floatingSize(stage, aspect, scale, narrow) });
}
const grid = [];
for (let n = 1; n <= 6; n++) for (const [w, h] of [[1440, 800], [400, 800], [700, 900], [1024, 700], [300, 300], [1600, 400]]) grid.push({ n, w, h, cols: gridColumns(n, w, h) });
const snaps = [];
for (let i = 0; i < 60; i++) {
  const cx = r() * 1.4 - 0.2;
  const cy = r() * 1.4 - 0.2;
  snaps.push({ cx, cy, corner: snapCorner(cx, cy) });
}
snaps.push({ cx: 0.5, cy: 0.5, corner: snapCorner(0.5, 0.5) });
const others = corners.map((c) => ({ corner: c, other: otherCorner(c) }));
const shortcuts = ['1', '2', '3', '4', '5', '6', 'b', 'B', 'd', 'D', 'c', 'v', 'V', 's', 'S', 'x', 'Enter', ' '].map((key) => ({ key, action: layoutShortcut(key) }));

const rawLayouts: unknown[] = [
  null,
  5,
  'focus',
  [],
  {},
  { mode: 'split', main: 'text', second: 'bogus', ratio: 3, selfCorner: 'zz', open: ['chat', 'nope'] },
  { mode: 'grid', main: 'screen', second: 'draw', ratio: 0.1, dir: 'column', selfCorner: 'tl', selfScale: 5, remoteFloat: false, remoteCorner: 'bl', open: ['self', 'draw', 'text', 'screen'] },
  { mode: 'focus', main: 'chat', ratio: '0.5', selfScale: null, remoteFloat: 'false', open: 'text', dir: 'row' },
  { mode: 'weird', main: 7, second: true, ratio: 0.55, selfScale: 0.1, remoteFloat: true, remoteCorner: 'br', open: [1, 'chat', 'chat', 'remote'] },
  JSON.parse(JSON.stringify(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' }))),
];
const sanitized = rawLayouts.map((raw) => ({ raw, layout: sanitizeLayout(raw) }));

writeFileSync(
  join(OUT, 'calls-layout.json'),
  JSON.stringify({ default: DEFAULT_LAYOUT, presets: PRESETS, all_tiles: ALL_TILES, sequences, floating, grid, snaps, others, shortcuts, sanitized }),
);
