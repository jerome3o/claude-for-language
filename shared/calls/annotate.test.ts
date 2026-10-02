import { describe, it, expect } from 'vitest';
import {
  ANNOT_FADE_MS,
  ANNOT_HOLD_MS,
  PING_MS,
  denormalizePoint,
  normalizePoint,
  pingProgress,
  pruneAnnotations,
  sanitizeAnnotStroke,
  sanitizePing,
  simplifyPoints,
  strokeAlpha,
  defaultAnnotColor,
  SHARER_ANNOT_COLOR,
  VIEWER_ANNOT_COLOR,
  sanitizeAnnotText,
  ANNOT_TEXT_SIZE,
  MAX_ANNOT_TEXT_CHARS,
  moveAnnotText,
  annotPersistOf,
  textAlpha,
  emptyKept,
  keepStroke,
  keepText,
  dropText,
  MAX_KEPT_STROKES,
} from './annotate';

const screen = { width: 1920, height: 1080 };

describe('normalizePoint', () => {
  it('maps a pointer to the shared picture, not the element', () => {
    // A 1920×1080 screen in a 800×800 box: picture 800×450 at y 175.
    const box = { width: 800, height: 800 };
    expect(normalizePoint(400, 400, box, screen)).toEqual([0.5, 0.5]);
    expect(normalizePoint(0, 175, box, screen)).toEqual([0, 0]);
    expect(normalizePoint(800, 625, box, screen)).toEqual([1, 1]);
  });

  it('refuses the letterbox (with a little slack at the edges)', () => {
    const box = { width: 800, height: 800 };
    expect(normalizePoint(400, 100, box, screen)).toBeNull();
    expect(normalizePoint(400, 172, box, screen)).toEqual([0.5, 0]);
  });

  it('lands on the same picture spot in different window sizes', () => {
    const a = normalizePoint(960, 540, { width: 1920, height: 1080 }, screen)!;
    const back = denormalizePoint(a, { width: 412, height: 700 }, screen);
    expect(back[0]).toBeCloseTo(206);
    expect(back[1]).toBeCloseTo(350);
  });

  it('works before the video size is known (the whole box)', () => {
    expect(normalizePoint(50, 50, { width: 100, height: 200 }, null)).toEqual([0.5, 0.25]);
    expect(normalizePoint(5, 5, { width: 0, height: 0 }, screen)).toBeNull();
  });
});

describe('fading', () => {
  it('holds, then fades to nothing', () => {
    expect(strokeAlpha(null, 99_999)).toBe(1);
    expect(strokeAlpha(1000, 1000 + ANNOT_HOLD_MS)).toBe(1);
    expect(strokeAlpha(1000, 1000 + ANNOT_HOLD_MS + ANNOT_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(strokeAlpha(1000, 1000 + ANNOT_HOLD_MS + ANNOT_FADE_MS)).toBe(0);
  });

  it('prunes what faded away and keeps strokes in progress', () => {
    const now = 100_000;
    const kept = pruneAnnotations({ a: { doneAt: null }, b: { doneAt: now - 1000 }, c: { doneAt: now - ANNOT_HOLD_MS - ANNOT_FADE_MS - 1 } }, now);
    expect(Object.keys(kept)).toEqual(['a', 'b']);
  });

  it('runs a ping for PING_MS', () => {
    expect(pingProgress(0, 0)).toBe(0);
    expect(pingProgress(0, PING_MS / 2)).toBeCloseTo(0.5);
    expect(pingProgress(0, PING_MS)).toBeNull();
  });
});

describe('wire validation', () => {
  it('cleans a stroke', () => {
    expect(sanitizeAnnotStroke({ id: 's1', color: '#f43f5e', width: 0.006, points: [[0.123456, 1.5], ['x', 1], [-1, 0.5]], done: true }))
      .toEqual({ id: 's1', color: '#f43f5e', width: 0.006, points: [[0.1235, 1], [0, 0.5]], done: true });
  });

  it('refuses junk', () => {
    expect(sanitizeAnnotStroke(null)).toBeNull();
    expect(sanitizeAnnotStroke({ id: 's', color: 'red', width: 0.01, points: [[0, 0]] })).toBeNull();
    expect(sanitizeAnnotStroke({ id: 's', color: '#ffffff', width: 0.5, points: [[0, 0]] })).toBeNull();
    expect(sanitizeAnnotStroke({ id: 's', color: '#ffffff', width: 0.01, points: [] })).toBeNull();
    expect(sanitizeAnnotStroke({ id: '', color: '#ffffff', width: 0.01, points: [[0, 0]] })).toBeNull();
    expect(sanitizePing({ x: 2, y: 0.5 })).toEqual({ x: 1, y: 0.5 });
    expect(sanitizePing({ x: 'a', y: 0.5 })).toBeNull();
  });

  it('thins a path but keeps its end', () => {
    const pts: [number, number][] = [[0, 0], [0.0005, 0], [0.001, 0], [0.01, 0], [0.0101, 0]];
    expect(simplifyPoints(pts)).toEqual([[0, 0], [0.01, 0], [0.0101, 0]]);
  });
});

describe('kept drawings and pen colours', () => {
  it('a kept stroke never fades; a fading one does', () => {
    expect(strokeAlpha(0, 60_000, true)).toBe(1);
    expect(strokeAlpha(0, 60_000)).toBe(0);
    expect(Object.keys(pruneAnnotations({ a: { doneAt: 0 } }, 60_000, true))).toEqual(['a']);
    expect(Object.keys(pruneAnnotations({ a: { doneAt: 0 } }, 60_000))).toEqual([]);
  });
  it('the sharer and the viewer start with different pens', () => {
    expect(defaultAnnotColor(true)).toBe(SHARER_ANNOT_COLOR);
    expect(defaultAnnotColor(false)).toBe(VIEWER_ANNOT_COLOR);
    expect(SHARER_ANNOT_COLOR).not.toBe(VIEWER_ANNOT_COLOR);
  });
});

describe('round 4: text on a shared screen, kept by default', () => {
  it('validates text boxes: position on the picture, colour, size, ≤ 200 characters, any script', () => {
    expect(sanitizeAnnotText({ id: 't', color: '#22c55e', x: 1.4, y: -0.2, text: '你好\r\nworld 😀', size: 0.5, done: true })).toEqual({
      id: 't', color: '#22c55e', x: 1, y: 0, text: '你好\nworld 😀', size: ANNOT_TEXT_SIZE, done: true,
    });
    expect(sanitizeAnnotText({ id: 't', color: 'red', x: 0, y: 0, text: 'a' })).toBeNull();
    expect(sanitizeAnnotText({ id: '', color: '#22c55e', x: 0, y: 0, text: 'a' })).toBeNull();
    expect(Array.from(sanitizeAnnotText({ id: 't', color: '#22c55e', x: 0, y: 0, text: '字'.repeat(300) })!.text)).toHaveLength(MAX_ANNOT_TEXT_CHARS);
  });

  it('moving keeps the box on the picture', () => {
    expect(moveAnnotText({ x: 0.5, y: 0.5 }, 0.1, -0.2)).toEqual({ x: 0.6, y: 0.3 });
    expect(moveAnnotText({ x: 0.9, y: 0.1 }, 0.5, -0.5)).toEqual({ x: 0.98, y: 0 });
  });

  it('Keep is the default for a room that never said; an explicit choice wins', () => {
    expect(annotPersistOf(undefined)).toBe(true);
    expect(annotPersistOf(null)).toBe(true);
    expect(annotPersistOf(false)).toBe(false);
    expect(textAlpha(0, 10_000, true)).toBe(1);
    expect(textAlpha(0, 10_000, false)).toBe(0);
  });

  it('the room keeps finished strokes and the latest of each text, bounded', () => {
    let k = emptyKept();
    k = keepStroke(k, 'c1', 'A', { id: 's', color: '#f43f5e', width: 0.006, points: [[0, 0]], done: false });
    expect(k.strokes).toHaveLength(0);
    for (let i = 0; i < MAX_KEPT_STROKES + 5; i++) k = keepStroke(k, 'c1', 'A', { id: `s${i}`, color: '#f43f5e', width: 0.006, points: [[0, 0]], done: true });
    expect(k.strokes).toHaveLength(MAX_KEPT_STROKES);
    expect(k.strokes[0].key).toBe('c1:s5');
    const t = { id: 't', color: '#f43f5e', x: 0, y: 0, text: 'a', size: ANNOT_TEXT_SIZE, done: true };
    k = keepText(keepText(k, 'c1', 'A', t), 'c2', 'B', { ...t, text: 'b' });
    expect(k.texts).toEqual([{ from: 'c2', name: 'B', text: { ...t, text: 'b' } }]);
    expect(dropText(k, 't').texts).toEqual([]);
  });
});
