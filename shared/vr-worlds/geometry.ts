/**
 * Where things are, for the task engine and the validator (docs/VR_WORLDS.md "The task language"):
 * object extents from their colliders, zones as world boxes (a basket's inside moves with the basket),
 * a surface's top. Pure maths over the spec + a snapshot; axis-aligned boxes, objects turned only
 * about Y (good enough for "is the apple in the basket?").
 */
import type { Vec3, WorldColliderPart, WorldColliderShape, WorldObjectSpec, WorldSpec } from './types';

export interface Box3 { min: Vec3; max: Vec3 }

export function shapeHalfExtents(shape: WorldColliderShape): Vec3 {
  if ('box' in shape) return [shape.box[0] / 2, shape.box[1] / 2, shape.box[2] / 2];
  if ('ball' in shape) return [shape.ball, shape.ball, shape.ball];
  return [shape.cylinder[0], shape.cylinder[1] / 2, shape.cylinder[0]];
}

export function colliderParts(o: Pick<WorldObjectSpec, 'collider'>): WorldColliderPart[] {
  return Array.isArray(o.collider) ? o.collider : [o.collider];
}

/** Does a part exist in these states? (`when` = every listed state holds.) */
export function partActive(part: WorldColliderPart, states: Record<string, string>): boolean {
  if (!part.when) return true;
  return Object.entries(part.when).every(([k, v]) => states[k] === v);
}

/** The object's local bounding box (all parts, any state), unrotated. */
export function localBounds(o: Pick<WorldObjectSpec, 'collider'>): Box3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of colliderParts(o)) {
    const h = shapeHalfExtents(p);
    const off = p.offset ?? [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], off[i] - h[i]);
      max[i] = Math.max(max[i], off[i] + h[i]);
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** A local box turned by `yaw` about Y and moved to `pos`: the world AABB around it. */
export function placeBox(local: Box3, pos: Vec3, yaw: number): Box3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const xs: number[] = [];
  const zs: number[] = [];
  for (const x of [local.min[0], local.max[0]]) {
    for (const z of [local.min[2], local.max[2]]) {
      // three.js rotation about +Y: x' = x cos + z sin, z' = −x sin + z cos
      xs.push(x * c + z * s);
      zs.push(-x * s + z * c);
    }
  }
  return {
    min: [pos[0] + Math.min(...xs), pos[1] + local.min[1], pos[2] + Math.min(...zs)],
    max: [pos[0] + Math.max(...xs), pos[1] + local.max[1], pos[2] + Math.max(...zs)],
  };
}

export function inBox(p: Vec3, b: Box3, pad = 0): boolean {
  return p[0] >= b.min[0] - pad && p[0] <= b.max[0] + pad
    && p[1] >= b.min[1] - pad && p[1] <= b.max[1] + pad
    && p[2] >= b.min[2] - pad && p[2] <= b.max[2] + pad;
}

export function boxInside(inner: Box3, outer: Box3, pad = 1e-6): boolean {
  return inBox(inner.min, outer, pad) && inBox(inner.max, outer, pad);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** How far above a surface's top a resting thing's centre may be (a tall bottle: ~0.15 m). */
export const SURFACE_REACH = 0.32;

/** The region "on top of" an object: its footprint, from just under its top to SURFACE_REACH above. */
export function surfaceRegion(o: WorldObjectSpec, pos: Vec3, yaw: number): Box3 {
  const b = placeBox(localBounds(o), pos, yaw);
  const top = b.max[1];
  return { min: [b.min[0] - 0.02, top - 0.03, b.min[2] - 0.02], max: [b.max[0] + 0.02, top + SURFACE_REACH, b.max[2] + 0.02] };
}

export function insideRegion(o: WorldObjectSpec, pos: Vec3, yaw: number): Box3 | null {
  if (!o.inside) return null;
  return placeBox(o.inside, pos, yaw);
}

export function objectById(world: Pick<WorldSpec, 'objects'>, id: string): WorldObjectSpec | undefined {
  return world.objects.find((o) => o.id === id);
}
