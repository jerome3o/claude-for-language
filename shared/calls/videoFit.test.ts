import { describe, it, expect } from 'vitest';
import { aspectMismatch, chooseVideoFit, containRect, coverRect, pipSize, PIP_MAX, PIP_MIN } from './videoFit';

const phonePortrait = { width: 720, height: 1280 };
const webcam43 = { width: 640, height: 480 };
const webcam169 = { width: 1280, height: 720 };
const desktopStage = { width: 1400, height: 760 };
const phoneStage = { width: 396, height: 700 };

describe('chooseVideoFit', () => {
  it('shows a portrait phone feed whole in a wide desktop window (the "huge face" bug)', () => {
    expect(chooseVideoFit(phonePortrait, desktopStage)).toBe('contain');
  });

  it('shows a landscape webcam whole on a portrait phone', () => {
    expect(chooseVideoFit(webcam43, phoneStage)).toBe('contain');
    expect(chooseVideoFit(webcam169, phoneStage)).toBe('contain');
  });

  it('fills the box when the shapes nearly match', () => {
    expect(chooseVideoFit(phonePortrait, phoneStage)).toBe('cover'); // 0.5625 vs 0.566
    expect(chooseVideoFit(webcam169, desktopStage)).toBe('cover'); // 1.78 vs 1.84
    expect(chooseVideoFit(webcam43, { width: 800, height: 600 })).toBe('cover');
  });

  it('draws the line at 15% by default, and takes another tolerance', () => {
    expect(chooseVideoFit({ width: 115, height: 100 }, { width: 100, height: 100 })).toBe('cover');
    expect(chooseVideoFit({ width: 116, height: 100 }, { width: 100, height: 100 })).toBe('contain');
    expect(chooseVideoFit({ width: 100, height: 115 }, { width: 100, height: 100 })).toBe('cover');
    expect(chooseVideoFit({ width: 130, height: 100 }, { width: 100, height: 100 }, { tolerance: 0.3 })).toBe('cover');
  });

  it('always shows a shared screen whole', () => {
    expect(chooseVideoFit(webcam169, desktopStage, { screen: true })).toBe('contain');
  });

  it('shows the whole picture while a size is unknown', () => {
    expect(chooseVideoFit(null, desktopStage)).toBe('contain');
    expect(chooseVideoFit({ width: 0, height: 0 }, desktopStage)).toBe('contain');
    expect(chooseVideoFit(webcam43, { width: 0, height: 300 })).toBe('contain');
    expect(chooseVideoFit({ width: NaN, height: 1 }, desktopStage)).toBe('contain');
  });

  it('measures mismatch symmetrically', () => {
    expect(aspectMismatch(phonePortrait, desktopStage)).toBeCloseTo(aspectMismatch(desktopStage, phonePortrait));
    expect(aspectMismatch(webcam43, webcam43)).toBe(1);
  });
});

describe('containRect / coverRect', () => {
  it('centres a portrait feed in a wide box with side bars', () => {
    const r = containRect(phonePortrait, desktopStage);
    expect(r.height).toBe(760);
    expect(r.width).toBeCloseTo(427.5);
    expect(r.x).toBeCloseTo((1400 - 427.5) / 2);
    expect(r.y).toBe(0);
  });

  it('centres a landscape feed in a tall box with bars above and below', () => {
    const r = containRect(webcam169, phoneStage);
    expect(r.width).toBe(396);
    expect(r.height).toBeCloseTo(222.75);
    expect(r.y).toBeCloseTo((700 - 222.75) / 2);
  });

  it('overflows the box with cover', () => {
    const r = coverRect(phonePortrait, desktopStage);
    expect(r.width).toBe(1400);
    expect(r.y).toBeLessThan(0);
  });

  it('falls back to the whole box without a size', () => {
    expect(containRect(null, desktopStage)).toEqual({ x: 0, y: 0, width: 1400, height: 760 });
  });
});

describe('pipSize', () => {
  it('keeps a phone camera portrait and a webcam landscape', () => {
    const p = pipSize(phonePortrait, phoneStage);
    expect(p.height).toBeGreaterThan(p.width);
    const w = pipSize(webcam169, desktopStage);
    expect(w.width).toBeGreaterThan(w.height);
    expect(w.width / w.height).toBeCloseTo(16 / 9, 1);
  });

  it('is small on a phone and bigger on a desktop, within bounds', () => {
    expect(pipSize(phonePortrait, phoneStage)).toEqual({ width: 71, height: 127 });
    expect(pipSize(webcam43, desktopStage)).toEqual({ width: 243, height: 182 });
    const tiny = pipSize(webcam43, { width: 200, height: 150 });
    expect(tiny.width).toBeGreaterThanOrEqual(PIP_MIN);
    const huge = pipSize(webcam43, { width: 4000, height: 3000 });
    expect(huge.width).toBeLessThanOrEqual(PIP_MAX);
  });

  it('guesses the shape from the stage before the camera size is known', () => {
    const portrait = pipSize(null, phoneStage);
    expect(portrait.height).toBeGreaterThan(portrait.width);
    const wide = pipSize(null, desktopStage);
    expect(wide.width).toBeGreaterThan(wide.height);
  });
});
