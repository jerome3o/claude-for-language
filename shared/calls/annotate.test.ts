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
