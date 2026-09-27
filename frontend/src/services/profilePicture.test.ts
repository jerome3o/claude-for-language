import { describe, it, expect } from 'vitest';
import { clampCrop, cropRect, initialCrop, outputSize, panCrop, zoomCrop, MAX_ZOOM } from './profilePicture';
import { draftFrom, profileChanges, timeZoneOptions } from './profileForm';
import type { Profile } from '@shared/profile';

describe('crop geometry', () => {
  it('starts centred with the short side filling the viewport', () => {
    const s = initialCrop(4000, 3000, 300); // landscape
    expect(s.zoom).toBe(1);
    expect(s.oy).toBe(0);
    expect(s.ox).toBeCloseTo(-50); // 4000 × 0.1 = 400 wide, 100 overflow split
    expect(cropRect(s)).toEqual({ sx: 500, sy: 0, side: 3000 });
  });

  it('never lets the photo stop covering the viewport', () => {
    const s = initialCrop(3000, 4000, 300); // portrait
    const far = panCrop(s, 500, -9999);
    expect(far.ox).toBe(0);
    expect(far.oy).toBeCloseTo(300 - 400);
    expect(cropRect(far)).toEqual({ sx: 0, sy: 1000, side: 3000 });
  });

  it('zooms around the anchor and clamps zoom to [1, MAX_ZOOM]', () => {
    const s = initialCrop(1000, 1000, 250);
    const z = zoomCrop(s, 2); // around the centre
    expect(z.zoom).toBe(2);
    const r = cropRect(z);
    expect(r.side).toBeCloseTo(500);
    expect(r.sx).toBeCloseTo(250);
    expect(r.sy).toBeCloseTo(250);
    expect(zoomCrop(s, 99).zoom).toBe(MAX_ZOOM);
    expect(zoomCrop(s, 0.2).zoom).toBe(1);
  });

  it('zooming at a corner keeps that corner', () => {
    const s = initialCrop(1000, 1000, 250);
    const r = cropRect(zoomCrop(s, 2, 0, 0));
    expect(r.sx).toBeCloseTo(0);
    expect(r.sy).toBeCloseTo(0);
    expect(r.side).toBeCloseTo(500);
  });

  it('crop rect always lies inside the image', () => {
    const s = clampCrop({ w: 640, h: 480, view: 320, zoom: 3.3, ox: -123456, oy: 99 });
    const r = cropRect(s);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.side).toBeLessThanOrEqual(640 + 1e-9);
    expect(r.sy + r.side).toBeLessThanOrEqual(480 + 1e-9);
  });

  it('outputs 512px, smaller for a tiny crop, never below 64', () => {
    expect(outputSize(3000)).toBe(512);
    expect(outputSize(120)).toBe(240);
    expect(outputSize(10)).toBe(64);
  });
});

const saved: Profile = {
  id: 'u1', email: 'm@example.com', name: 'Minghui Zhang', picture_url: null, picture_source: 'google',
  name_custom: false, google_name: 'Minghui Zhang', google_picture_url: null,
  bio: null, about: 'Hi', time_zone: null,
};

describe('profile form', () => {
  it('sends nothing when nothing changed (whitespace included)', () => {
    expect(profileChanges(saved, { ...draftFrom(saved), name: '  Minghui   Zhang ', about: 'Hi  ' })).toEqual({});
  });

  it('sends only the changed fields, blanks as null', () => {
    expect(profileChanges(saved, { name: '明慧老师', about: '', time_zone: 'Asia/Shanghai', bio: '' })).toEqual({
      name: '明慧老师', about: null, time_zone: 'Asia/Shanghai',
    });
  });

  it('an emptied name is sent so the server can explain', () => {
    expect(profileChanges(saved, { ...draftFrom(saved), name: '  ' })).toEqual({ name: '' });
  });

  it('time zone options include the saved zone', () => {
    const zones = timeZoneOptions(['Etc/Unknown_Zone']);
    expect(zones).toContain('Etc/Unknown_Zone');
    expect(zones).toContain('Asia/Shanghai');
  });
});
