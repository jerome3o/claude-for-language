import { describe, expect, it } from 'vitest';
import {
  arrangeTiles,
  DEFAULT_LAYOUT,
  layoutReducer,
  layoutShortcut,
  sanitizeLayout,
  snapCorner,
  swipeFocus,
  swipeOrder,
  type CallLayout,
  layoutRects,
  gridColumns,
  floatingSize,
  DIVIDER,
  TILE_GAP,
} from './layout';

const NO_SCREEN = { screen: false };
const SCREEN = { screen: true };
const WIDE = 1440;
const PHONE = 412;

describe('presets', () => {
  it('speaker: the other person on the stage, me floating', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'speaker' });
    expect(arrangeTiles(l, NO_SCREEN, WIDE)).toEqual({ stage: ['remote'], rail: [], floating: [{ tile: 'self', corner: 'br' }], mode: 'focus' });
  });

  it('board + camera: a split, and focusing the board never hides their camera', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' });
    const a = arrangeTiles(l, NO_SCREEN, WIDE);
    expect(a.stage).toEqual(['text', 'remote']);
    expect(a.mode).toBe('split');
    const focused = layoutReducer(l, { type: 'focus', tile: 'text' });
    const b = arrangeTiles(focused, NO_SCREEN, WIDE);
    expect(b.stage).toEqual(['text']);
    expect(b.floating.map((f) => f.tile)).toContain('remote');
  });

  it('screen + camera: the share on the stage, their camera floating; falls back when the share ends', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'screen' });
    expect(arrangeTiles(l, SCREEN, WIDE).stage).toEqual(['screen']);
    expect(arrangeTiles(l, SCREEN, WIDE).floating.map((f) => f.tile)).toEqual(['remote', 'self']);
    expect(arrangeTiles(l, NO_SCREEN, WIDE).stage).toEqual(['remote']);
  });

  it('side by side and grid', () => {
    expect(arrangeTiles(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'side' }), NO_SCREEN, WIDE).stage).toEqual(['remote', 'self']);
    const g = layoutReducer(layoutReducer(DEFAULT_LAYOUT, { type: 'open', tile: 'text' }), { type: 'preset', preset: 'grid' });
    const a = arrangeTiles(g, SCREEN, WIDE);
    expect(a.stage).toEqual(['remote', 'screen', 'text', 'self']);
    expect(a.floating).toEqual([]);
  });
});

describe('the reducer', () => {
  it('focus toggles back to the camera, opens closed tiles', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'chat' });
    expect(l.main).toBe('chat');
    expect(l.open).toContain('chat');
    expect(layoutReducer(l, { type: 'focus', tile: 'chat' }).main).toBe('remote');
  });

  it('swaps Board and Draw in place', () => {
    const split = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' });
    const s = layoutReducer(split, { type: 'swap', from: 'text', to: 'draw' });
    expect([s.mode, s.main, s.second]).toEqual(['split', 'draw', 'remote']);
    expect(s.open).toContain('draw');
    const f = layoutReducer(layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'draw' }), { type: 'swap', from: 'draw', to: 'text' });
    expect(f.main).toBe('text');
  });

  it('clamps the divider and the floating size', () => {
    expect(layoutReducer(DEFAULT_LAYOUT, { type: 'ratio', ratio: 0.95 }).ratio).toBe(0.8);
    expect(layoutReducer(DEFAULT_LAYOUT, { type: 'ratio', ratio: 0 }).ratio).toBe(0.2);
    expect(layoutReducer(DEFAULT_LAYOUT, { type: 'selfScale', scale: 9 }).selfScale).toBe(2);
  });

  it('closing a tile on the stage falls back, cameras cannot be closed', () => {
    const split = layoutReducer(DEFAULT_LAYOUT, { type: 'split', a: 'text', b: 'remote' });
    const closed = layoutReducer(split, { type: 'close', tile: 'text' });
    expect(closed.mode).toBe('focus');
    expect(closed.main).toBe('remote');
    expect(closed.open).not.toContain('text');
    expect(layoutReducer(DEFAULT_LAYOUT, { type: 'close', tile: 'remote' })).toBe(DEFAULT_LAYOUT);
  });

  it('puts the rest in the rail when their camera does not float', () => {
    let l: CallLayout = layoutReducer(DEFAULT_LAYOUT, { type: 'open', tile: 'chat' });
    l = layoutReducer(l, { type: 'remoteFloat', on: false });
    l = layoutReducer(l, { type: 'focus', tile: 'text' });
    expect(arrangeTiles(l, NO_SCREEN, WIDE).rail).toEqual(['remote', 'chat']);
  });

  it('two floating cameras never share a corner', () => {
    let l = layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'text' });
    l = layoutReducer(l, { type: 'remoteCorner', corner: 'br' });
    const f = arrangeTiles(l, NO_SCREEN, WIDE).floating;
    expect(new Set(f.map((x) => x.corner)).size).toBe(2);
  });
});

describe('phones', () => {
  it('always focus, cameras float, swipe walks the open tiles', () => {
    let l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' });
    const a = arrangeTiles(l, SCREEN, PHONE);
    expect(a.mode).toBe('focus');
    expect(a.stage).toEqual(['text']);
    expect(a.floating.map((f) => f.tile)).toEqual(['remote', 'self']);
    expect(a.rail).toEqual([]);
    expect(swipeOrder(l, SCREEN)).toEqual(['remote', 'screen', 'text']);
    l = swipeFocus(l, SCREEN, -1);
    expect(l.main).toBe('screen');
    l = swipeFocus(swipeFocus(l, SCREEN, -1), SCREEN, -1);
    expect(l.main).toBe('remote');
  });
});

describe('helpers', () => {
  it('snaps to the nearest corner', () => {
    expect(snapCorner(0.1, 0.1)).toBe('tl');
    expect(snapCorner(0.9, 0.2)).toBe('tr');
    expect(snapCorner(0.2, 0.9)).toBe('bl');
    expect(snapCorner(0.7, 0.7)).toBe('br');
  });
  it('maps shortcuts', () => {
    expect(layoutShortcut('2')).toEqual({ type: 'preset', preset: 'board' });
    expect(layoutShortcut('B')).toEqual({ type: 'focus', tile: 'text' });
    expect(layoutShortcut('x')).toBeNull();
  });
  it('sanitises stored layouts', () => {
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    const s = sanitizeLayout({ mode: 'split', main: 'text', second: 'bogus', ratio: 3, selfCorner: 'zz', open: ['chat', 'nope'] });
    expect(s.mode).toBe('split');
    expect(s.second).toBe('text');
    expect(s.ratio).toBe(0.8);
    expect(s.selfCorner).toBe('br');
    expect(s.open).toEqual(['remote', 'self', 'chat']);
  });
});

describe('rectangles', () => {
  const box = { w: 1440, h: 800 };
  it('focus fills the stage, cameras float in their corners', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'text' });
    const r = layoutRects(l, arrangeTiles(l, NO_SCREEN, box.w), box);
    expect(r.tiles.text).toMatchObject({ x: 0, y: 0, w: 1440, h: 800, role: 'stage' });
    expect(r.tiles.self.role).toBe('floating');
    expect(r.tiles.self.x + r.tiles.self.w).toBe(1440 - 12);
    expect(r.tiles.self.y + r.tiles.self.h).toBe(800 - 12);
    expect(r.tiles.remote.y).toBe(12); // top-right
    expect(r.tiles.chat.role).toBe('hidden');
  });
  it('split follows the ratio and has a divider', () => {
    const l = layoutReducer(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' }), { type: 'ratio', ratio: 0.5 });
    const r = layoutRects(l, arrangeTiles(l, NO_SCREEN, box.w), box);
    expect(r.tiles.text.w).toBe(714);
    expect(r.tiles.remote.x).toBe(714 + DIVIDER);
    expect(r.tiles.text.w + DIVIDER + r.tiles.remote.w).toBe(1440);
    expect(r.divider).toMatchObject({ x: 714, dir: 'row' });
  });
  it('the rail takes the right edge on wide screens', () => {
    let l = layoutReducer(DEFAULT_LAYOUT, { type: 'open', tile: 'chat' });
    l = layoutReducer(layoutReducer(l, { type: 'remoteFloat', on: false }), { type: 'focus', tile: 'text' });
    const r = layoutRects(l, arrangeTiles(l, NO_SCREEN, box.w), box);
    expect(r.tiles.remote.role).toBe('rail');
    expect(r.tiles.remote.x + r.tiles.remote.w).toBe(1440);
    expect(r.stage.w).toBe(1440 - r.tiles.remote.w - TILE_GAP);
  });
  it('grid picks columns that keep tiles wide', () => {
    expect(gridColumns(4, 1440, 800)).toBe(2);
    expect(gridColumns(2, 1440, 800)).toBe(2);
    expect(gridColumns(2, 400, 800)).toBe(1);
    expect(gridColumns(5, 1440, 800)).toBe(3);
  });
  it('floating cameras keep their shape and stay within half the stage', () => {
    const s = floatingSize({ x: 0, y: 0, w: 412, h: 700 }, 3 / 4, 1, true);
    expect(s.w / s.h).toBeCloseTo(0.75, 1);
    expect(s.h).toBeLessThanOrEqual(350);
    const big = floatingSize({ x: 0, y: 0, w: 1440, h: 800 }, 16 / 9, 2, false);
    expect(big.w).toBeLessThanOrEqual(720);
  });
});
