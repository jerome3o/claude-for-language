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
  boardButton,
  pairSize,
  PAIR_PAD,
  PAIR_GAP,
  TILE_HEADER,
} from './layout';

const NO_SCREEN = { screen: false };
const SCREEN = { screen: true };
const WIDE = 1440;
const PHONE = 412;
/** Round 2's floating cameras (the "Cameras: separate" choice). */
const SEPARATE = layoutReducer(DEFAULT_LAYOUT, { type: 'pip', pip: 'separate' });

describe('presets', () => {
  it('speaker: the other person on the stage, me floating', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'speaker' });
    expect(arrangeTiles(l, NO_SCREEN, WIDE)).toEqual({ stage: ['remote'], rail: [], floating: [{ tile: 'self', corner: 'br' }], pair: null, mode: 'focus' });
  });

  it('board + camera: a split, and focusing the board never hides their camera', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' });
    const a = arrangeTiles(l, NO_SCREEN, WIDE);
    expect(a.stage).toEqual(['text', 'remote']);
    expect(a.mode).toBe('split');
    const focused = layoutReducer(l, { type: 'focus', tile: 'text' });
    const b = arrangeTiles(focused, NO_SCREEN, WIDE);
    expect(b.stage).toEqual(['text']);
    expect(b.pair).toBe('tl');
    const sep = arrangeTiles({ ...focused, pip: 'separate' }, NO_SCREEN, WIDE);
    expect(sep.floating.map((f) => f.tile)).toContain('remote');
  });

  it('screen + camera: the share on the stage, their camera floating; falls back when the share ends', () => {
    const l = layoutReducer(SEPARATE, { type: 'preset', preset: 'screen' });
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
    expect(a.pair).toBeNull();
  });
});

describe('faces together (round 3)', () => {
  it('is the default when content is focused: board, drawing, shared screen', () => {
    for (const tile of ['text', 'draw', 'screen'] as const) {
      const l = layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile });
      const a = arrangeTiles(l, { screen: tile === 'screen' }, WIDE);
      expect(a.stage).toEqual([tile]);
      expect(a.pair).toBe('tl');
      expect(a.floating).toEqual([]);
      expect(a.rail).toEqual([]);
    }
  });

  it('not when a camera is on the stage, nor in a grid', () => {
    expect(arrangeTiles(DEFAULT_LAYOUT, NO_SCREEN, WIDE).pair).toBeNull();
    expect(arrangeTiles(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' }), NO_SCREEN, WIDE).pair).toBeNull();
    expect(arrangeTiles(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'side' }), NO_SCREEN, WIDE).pair).toBeNull();
    expect(arrangeTiles(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'grid' }), NO_SCREEN, WIDE).pair).toBeNull();
    expect(arrangeTiles(layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'self' }), NO_SCREEN, WIDE).pair).toBeNull();
  });

  it('their camera in the rail (floating off) stays in the rail on wide screens; phones still pair', () => {
    let l = layoutReducer(DEFAULT_LAYOUT, { type: 'remoteFloat', on: false });
    l = layoutReducer(l, { type: 'focus', tile: 'text' });
    const a = arrangeTiles(l, NO_SCREEN, WIDE);
    expect(a.pair).toBeNull();
    expect(a.rail).toEqual(['remote']);
    expect(arrangeTiles(l, NO_SCREEN, PHONE).pair).toBe('tl');
  });

  it('separate cameras: the old two floating tiles', () => {
    const l = layoutReducer(SEPARATE, { type: 'focus', tile: 'text' });
    const a = arrangeTiles(l, NO_SCREEN, WIDE);
    expect(a.pair).toBeNull();
    expect(a.floating.map((f) => f.tile)).toEqual(['remote', 'self']);
    expect(layoutReducer(l, { type: 'pip', pip: 'pair' }).pip).toBe('pair');
  });

  it('a tap on the pair goes to Speaker', () => {
    const l = layoutReducer(layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'text' }), { type: 'pairTap' });
    expect([l.mode, l.main]).toEqual(['focus', 'remote']);
    expect(arrangeTiles(l, NO_SCREEN, WIDE)).toMatchObject({ stage: ['remote'], floating: [{ tile: 'self', corner: 'br' }], pair: null, mode: 'focus' });
    // Board again: the pair comes back where it was.
    const back = layoutReducer(layoutReducer(l, { type: 'pairCorner', corner: 'br' }), { type: 'focus', tile: 'text' });
    expect(arrangeTiles(back, NO_SCREEN, WIDE).pair).toBe('br');
  });

  it('their share starting: the screen with the faces pair, unless the user chose separate cameras', () => {
    const fromSpeaker = layoutReducer(DEFAULT_LAYOUT, { type: 'shareStarted' });
    expect(arrangeTiles(fromSpeaker, SCREEN, WIDE)).toMatchObject({ stage: ['screen'], pair: 'tl', floating: [] });
    const fromGrid = layoutReducer(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'grid' }), { type: 'shareStarted' });
    expect(arrangeTiles(fromGrid, SCREEN, WIDE).pair).toBe('tl');
    const chosen = layoutReducer(SEPARATE, { type: 'shareStarted' });
    const a = arrangeTiles(chosen, SCREEN, WIDE);
    expect(a.pair).toBeNull();
    expect(a.floating.map((f) => f.tile)).toEqual(['remote', 'self']);
  });

  it('remembered layouts: an explicit choice survives, old ones default to the pair', () => {
    // A layout stored by round 2 (no pip): the board focused → faces together.
    const old = sanitizeLayout({ mode: 'focus', main: 'text', second: 'text', ratio: 0.62, dir: 'row', selfCorner: 'tl', selfScale: 1.4, remoteFloat: true, remoteCorner: 'tr', open: ['remote', 'self', 'text'] });
    expect(old.pip).toBe('pair');
    expect(old.pairCorner).toBe('tl');
    expect(old.pairScale).toBe(1);
    expect(arrangeTiles(old, NO_SCREEN, WIDE).pair).toBe('tl');
    // Stored after choosing separate cameras / a corner / a size: all restored.
    const stored = JSON.parse(JSON.stringify(layoutReducer(layoutReducer(layoutReducer(SEPARATE, { type: 'pairCorner', corner: 'br' }), { type: 'pairScale', scale: 1.5 }), { type: 'focus', tile: 'draw' })));
    const back = sanitizeLayout(stored);
    expect({ ...back, open: [...back.open].sort() }).toEqual({ ...stored, open: [...stored.open].sort() });
    expect(arrangeTiles(back, NO_SCREEN, WIDE).pair).toBeNull();
    // An explicit preset (Board + camera) stays that preset.
    const board = sanitizeLayout(JSON.parse(JSON.stringify(layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' }))));
    expect(arrangeTiles(board, NO_SCREEN, WIDE).stage).toEqual(['text', 'remote']);
    // Odd values fall back.
    const odd = sanitizeLayout({ pip: 'both', pairCorner: 'middle', pairScale: 99 });
    expect([odd.pip, odd.pairCorner, odd.pairScale]).toEqual(['pair', 'tl', 2]);
  });

  it('clamps the pair size', () => {
    expect(layoutReducer(DEFAULT_LAYOUT, { type: 'pairScale', scale: 9 }).pairScale).toBe(2);
    expect(layoutReducer(DEFAULT_LAYOUT, { type: 'pairScale', scale: 0.1 }).pairScale).toBe(0.6);
  });

  it('the 📝 button focuses the board with the faces over it (the split only for separate cameras)', () => {
    expect(boardButton(DEFAULT_LAYOUT, false)).toEqual({ type: 'focus', tile: 'text' });
    expect(boardButton(SEPARATE, false)).toEqual({ type: 'preset', preset: 'board' });
    expect(boardButton(SEPARATE, true)).toEqual({ type: 'focus', tile: 'text' });
    expect(boardButton(layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'draw' }), false)).toEqual({ type: 'focus', tile: 'remote' });
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
    let l = layoutReducer(SEPARATE, { type: 'focus', tile: 'text' });
    l = layoutReducer(l, { type: 'remoteCorner', corner: 'br' });
    const f = arrangeTiles(l, NO_SCREEN, WIDE).floating;
    expect(new Set(f.map((x) => x.corner)).size).toBe(2);
  });
});

describe('phones', () => {
  it('always focus, the faces pair floats, swipe walks the open tiles', () => {
    let l = layoutReducer(DEFAULT_LAYOUT, { type: 'preset', preset: 'board' });
    const a = arrangeTiles(l, SCREEN, PHONE);
    expect(a.mode).toBe('focus');
    expect(a.stage).toEqual(['text']);
    expect(a.pair).toBe('tl');
    expect(a.floating).toEqual([]);
    expect(a.rail).toEqual([]);
    expect(arrangeTiles({ ...l, pip: 'separate' }, SCREEN, PHONE).floating.map((f) => f.tile)).toEqual(['remote', 'self']);
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
  it('the faces pair: both faces side by side in one box, the other person first, below the board tabs', () => {
    const l = layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'text' });
    const r = layoutRects(l, arrangeTiles(l, NO_SCREEN, box.w), box, { remote: 16 / 9, self: 4 / 3 });
    expect(r.pair).toMatchObject({ x: 12, y: 12 + TILE_HEADER.text!, corner: 'tl' });
    const p = r.pair!;
    expect(r.tiles.remote).toMatchObject({ x: 12 + PAIR_PAD, y: p.y + PAIR_PAD, role: 'pair', h: 120, w: 213 });
    expect(r.tiles.self).toMatchObject({ x: r.tiles.remote.x + 213 + PAIR_GAP, y: r.tiles.remote.y, role: 'pair', h: 120, w: 160 });
    expect(p.w).toBe(213 + 160 + PAIR_GAP + 2 * PAIR_PAD);
    expect(p.h).toBe(120 + 2 * PAIR_PAD);
    // Bottom-right: from the far edges; top-right on a shared screen: below its drawing tools.
    const s = layoutReducer(layoutReducer(DEFAULT_LAYOUT, { type: 'shareStarted' }), { type: 'pairCorner', corner: 'br' });
    const rs = layoutRects(s, arrangeTiles(s, SCREEN, box.w), box);
    expect(rs.pair!.x + rs.pair!.w).toBe(1440 - 12);
    expect(rs.pair!.y + rs.pair!.h).toBe(800 - 12);
    const t = layoutReducer(s, { type: 'pairCorner', corner: 'tr' });
    expect(layoutRects(t, arrangeTiles(t, SCREEN, box.w), box).pair!.y).toBe(12 + TILE_HEADER.screen!);
    // The drawing: below its tabs AND its tool row.
    const d = layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'draw' });
    expect(layoutRects(d, arrangeTiles(d, NO_SCREEN, box.w), box).pair!.y).toBe(12 + 104);
  });
  it('the pair is smaller on phones and stays within the stage', () => {
    const phone = pairSize({ x: 0, y: 0, w: 396, h: 700 }, { remote: 4 / 3, self: 3 / 4 }, 1, true);
    expect(phone.faceH).toBe(63);
    expect(phone.w).toBeLessThan(170);
    const wide = pairSize({ x: 0, y: 0, w: 1440, h: 800 }, {}, 1, false);
    expect(wide.faceH).toBe(120);
    const huge = pairSize({ x: 0, y: 0, w: 412, h: 700 }, { remote: 16 / 9, self: 16 / 9 }, 2, true);
    expect(huge.w).toBeLessThanOrEqual(Math.ceil(412 * 0.7) + 1);
    // Odd camera shapes are kept between 3:4 and 16:9.
    const odd = pairSize({ x: 0, y: 0, w: 1440, h: 800 }, { remote: 0, self: 9 }, 1, false);
    expect(odd.remoteW).toBe(160);
    expect(odd.selfW).toBe(213);
  });
  it('focus fills the stage, separate cameras float in their corners', () => {
    const l = layoutReducer(SEPARATE, { type: 'focus', tile: 'text' });
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
    let l = layoutReducer(SEPARATE, { type: 'open', tile: 'chat' });
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
