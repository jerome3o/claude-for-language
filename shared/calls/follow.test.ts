import { describe, expect, it } from 'vitest';
import {
  autoShowBoard, canShow, canStopShare, followStep, isShowing, nextShown, sanitizeShowView, shareStoppedNote, showingBanner, type ShownState,
} from './follow';
import { DEFAULT_LAYOUT, layoutReducer, type CallLayout, type TileId } from './layout';

const T = 'tutor';
const S = 'student';
const ids = () => {
  let n = 0;
  return () => `s${++n}`;
};

describe('follow: who leads', () => {
  it('only the relationship’s tutor shows and stops the other person’s share', () => {
    expect(canShow(T, T)).toBe(true);
    expect(canShow(S, T)).toBe(false);
    expect(canShow(T, null)).toBe(false); // solo call
    expect(canStopShare(T, T, S)).toBe(true);
    expect(canStopShare(S, T, T)).toBe(false); // the student can't stop the tutor's
    expect(canStopShare(T, T, T)).toBe(false);
    expect(canStopShare(T, null, S)).toBe(false);
  });

  it('cleans what clients send', () => {
    expect(sanitizeShowView({ kind: 'text', page: 'p1' })).toEqual({ kind: 'text', page: 'p1' });
    expect(sanitizeShowView({ kind: 'text', page: 7 })).toEqual({ kind: 'text' });
    expect(sanitizeShowView({ kind: 'material', page: 'x' })).toEqual({ kind: 'material' });
    expect(sanitizeShowView({ kind: 'remote' })).toBeNull();
    expect(sanitizeShowView('screen')).toBeNull();
    expect(sanitizeShowView(null)).toBeNull();
  });
});

describe('follow: the room’s state', () => {
  it('a press is a new show; a page turn of the same kind is a follow-up', () => {
    const id = ids();
    const by = { userId: T, name: 'Minghui' };
    const a = nextShown(null, { kind: 'text', page: 'p1' }, by, false, 1, id);
    expect(a).toEqual({ id: 's1', v: 1, by: T, name: 'Minghui', view: { kind: 'text', page: 'p1' }, at: 1 });
    const b = nextShown(a, { kind: 'text', page: 'p2' }, by, true, 2, id);
    expect(b).toEqual({ ...a, v: 2, view: { kind: 'text', page: 'p2' }, at: 2 });
    // A follow-up of another kind is new; so is the button pressed again.
    expect(nextShown(b, { kind: 'draw' }, by, true, 3, id).id).toBe('s2');
    expect(nextShown(b, { kind: 'text', page: 'p2' }, by, false, 4, id).id).toBe('s3');
    // A follow-up with nothing shown yet is new too.
    expect(nextShown(null, { kind: 'text', page: 'p2' }, by, true, 5, id)).toMatchObject({ id: 's4', v: 1 });
  });
});

describe('follow: the student’s device', () => {
  const shown = (over: Partial<ShownState> = {}): ShownState => ({ id: 'x', v: 1, by: T, name: 'Minghui', view: { kind: 'text', page: 'p1' }, at: 0, ...over });

  it('applies each new show once, then their own layout wins', () => {
    expect(followStep(null, shown(), S, true, false)).toEqual({ kind: 'stage', tile: 'text', page: 'p1' });
    // Applied: nothing more, even when they look elsewhere (onTile false).
    expect(followStep({ id: 'x', v: 1 }, shown(), S, true, false)).toEqual({ kind: 'none' });
    // A new show pulls them back.
    expect(followStep({ id: 'x', v: 1 }, shown({ id: 'y', view: { kind: 'material' } }), S, true, false)).toEqual({ kind: 'stage', tile: 'material', page: null });
  });

  it('follows her page turns only while on the board', () => {
    const turned = shown({ v: 2, view: { kind: 'text', page: 'p2' } });
    expect(followStep({ id: 'x', v: 1 }, turned, S, true, true)).toEqual({ kind: 'page', page: 'p2' });
    expect(followStep({ id: 'x', v: 1 }, turned, S, true, false)).toEqual({ kind: 'none' });
  });

  it('never follows itself, nor a tile that isn’t there (a material closed meanwhile)', () => {
    expect(followStep(null, shown(), T, true, false)).toEqual({ kind: 'none' });
    expect(followStep(null, shown({ view: { kind: 'screen' } }), S, false, false)).toEqual({ kind: 'none' });
    expect(followStep(null, null, S, true, false)).toEqual({ kind: 'none' });
  });

  it('a reconnect with the same show changes nothing; a fresh page load applies it once', () => {
    expect(followStep({ id: 'x', v: 2 }, shown({ v: 2 }), S, true, true)).toEqual({ kind: 'none' });
    expect(followStep(null, shown({ v: 2 }), S, true, true).kind).toBe('stage');
  });
});

describe('follow: the tutor’s side and copy', () => {
  it('the button reads Showing ✓ for what she shows (same board page)', () => {
    const s: ShownState = { id: 'x', v: 1, by: T, name: 'M', view: { kind: 'text', page: 'p1' }, at: 0 };
    expect(isShowing(s, T, { kind: 'text', page: 'p1' })).toBe(true);
    expect(isShowing(s, T, { kind: 'text', page: 'p2' })).toBe(false);
    expect(isShowing(s, T, { kind: 'draw' })).toBe(false);
    expect(isShowing(s, S, { kind: 'text', page: 'p1' })).toBe(false);
    expect(isShowing(null, T, { kind: 'draw' })).toBe(false);
  });

  it('opening the board shows it without the button', () => {
    expect(autoShowBoard(['remote'], ['text'])).toBe('text');
    expect(autoShowBoard(['remote'], ['draw', 'remote'])).toBe('draw');
    expect(autoShowBoard(['text'], ['text'])).toBeNull();
    expect(autoShowBoard(['text'], ['remote'])).toBeNull();
    expect(autoShowBoard(['remote'], ['material'])).toBeNull();
  });

  it('copy', () => {
    expect(showingBanner('Minghui')).toBe('Minghui is showing you this');
    expect(showingBanner(' ')).toBe('Your tutor is showing you this');
    expect(shareStoppedNote('Minghui')).toBe('Minghui stopped your screen share');
  });
});

describe('layout: shown', () => {
  it('puts the shown tile on the stage with the cameras floating; leaves it where it is when already there', () => {
    const l = layoutReducer({ ...DEFAULT_LAYOUT, open: ['remote', 'self'] as TileId[] }, { type: 'shown', tile: 'text' });
    expect(l).toMatchObject({ mode: 'focus', main: 'text', remoteFloat: true });
    expect(l.open).toContain('text');
    const split: CallLayout = { ...DEFAULT_LAYOUT, mode: 'split', main: 'remote', second: 'text', open: ['remote', 'self', 'text'] };
    expect(layoutReducer(split, { type: 'shown', tile: 'text' })).toMatchObject({ mode: 'split', main: 'remote', second: 'text' });
    const focused = layoutReducer(l, { type: 'shown', tile: 'text' });
    expect(focused.main).toBe('text'); // not toggled back like 'focus'
  });
});
