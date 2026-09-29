import { describe, expect, it } from 'vitest';
import { decodePngGray, maskToPolygon, polygonFromMaskData, simplifyClosed, traceBoundary, largestBlob } from '../picture-hunt-mask';
import { makePng, pngDataUrl } from './picture-hunt-png';

const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? 255 : 0);

describe('decodePngGray', () => {
  it('decodes every row filter, gray and RGBA', async () => {
    for (const filter of [0, 1, 2, 3]) {
      for (const rgba of [false, true]) {
        const img = await decodePngGray(makePng(7, 5, (x, y) => x * 30 + y, { filter, rgba }));
        expect(img.width).toBe(7);
        expect(img.height).toBe(5);
        expect(img.data[4 * 7 + 6]).toBe(6 * 30 + 4);
      }
    }
  });
  it('rejects what is not a PNG', async () => {
    await expect(decodePngGray(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow('not a PNG');
  });
});

describe('outline tracing', () => {
  it('traces a square blob clockwise around its edge', () => {
    const grid = new Uint8Array(25);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) grid[y * 5 + x] = 1;
    const contour = traceBoundary(grid, 5, 5, 6);
    expect(contour).toEqual([[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]]);
  });
  it('keeps only the largest blob', () => {
    const blob = largestBlob({ width: 6, height: 1, data: new Uint8Array([255, 0, 255, 255, 255, 0]) });
    expect(blob?.size).toBe(3);
    expect(blob?.start).toBe(2);
  });
  it('simplifies a closed contour under the point cap', () => {
    const circle: Array<[number, number]> = Array.from({ length: 400 }, (_, i) => [50 + 40 * Math.cos(i / 400 * 2 * Math.PI), 50 + 40 * Math.sin(i / 400 * 2 * Math.PI)]);
    const s = simplifyClosed(circle, 0.2, 32);
    expect(s.length).toBeLessThanOrEqual(32);
    expect(s.length).toBeGreaterThanOrEqual(8);
  });
});

describe('maskToPolygon', () => {
  it('maps a disc mask into the box, in image coordinates', async () => {
    const png = makePng(40, 40, disc(20, 20, 15));
    const polygon = await polygonFromMaskData(pngDataUrl(png), { x: 0.5, y: 0.2, w: 0.2, h: 0.4 });
    expect(polygon).not.toBeNull();
    expect(polygon!.length).toBeGreaterThanOrEqual(6);
    for (const [x, y] of polygon!) {
      expect(x).toBeGreaterThanOrEqual(0.5);
      expect(x).toBeLessThanOrEqual(0.7);
      expect(y).toBeGreaterThanOrEqual(0.2);
      expect(y).toBeLessThanOrEqual(0.6);
    }
    // Roughly round: spans most of the box both ways.
    const xs = polygon!.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.13);
  });
  it('returns null for an empty mask or garbage data', async () => {
    const empty = await decodePngGray(makePng(10, 10, () => 0));
    expect(maskToPolygon(empty, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(await polygonFromMaskData('data:image/png;base64,AAAA', { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });
});
