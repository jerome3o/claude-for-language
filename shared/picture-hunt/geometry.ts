/**
 * Hit-testing and label placement for a hunt's regions (normalised 0..1
 * coordinates). Pure; the Lab app's port is parity-tested against this file.
 */
import type { HuntObject, HuntRegion } from './types';

/** Ray-casting point-in-polygon. */
export function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function regionContains(region: HuntRegion, x: number, y: number): boolean {
  const { box } = region;
  if (x < box.x || y < box.y || x > box.x + box.w || y > box.y + box.h) return false;
  return region.polygon && region.polygon.length >= 3 ? pointInPolygon(x, y, region.polygon) : true;
}

/**
 * The object under a tap: the smallest region containing the point wins (a cup
 * on a table is the cup). Within `slop` of a box edge counts as a hit when no
 * region contains the point exactly, so thin things stay tappable on a phone.
 */
export function objectAt(objects: HuntObject[], x: number, y: number, slop = 0.02): HuntObject | null {
  let best: { obj: HuntObject; area: number } | null = null;
  for (const obj of objects) {
    for (const region of obj.regions) {
      if (!regionContains(region, x, y)) continue;
      const area = region.box.w * region.box.h;
      if (!best || area < best.area) best = { obj, area };
    }
  }
  if (best) return best.obj;
  let near: { obj: HuntObject; d: number } | null = null;
  for (const obj of objects) {
    for (const { box } of obj.regions) {
      const dx = Math.max(box.x - x, 0, x - (box.x + box.w));
      const dy = Math.max(box.y - y, 0, y - (box.y + box.h));
      const d = Math.hypot(dx, dy);
      if (d <= slop && (!near || d < near.d)) near = { obj, d };
    }
  }
  return near?.obj ?? null;
}

/** Where to put a region's label: top-centre of its box, kept inside the picture. */
export function labelAnchor(region: HuntRegion): { x: number; y: number; above: boolean } {
  const { box } = region;
  const x = Math.min(0.95, Math.max(0.05, box.x + box.w / 2));
  const above = box.y > 0.06;
  return { x, y: above ? box.y : Math.min(0.97, box.y + box.h), above };
}
