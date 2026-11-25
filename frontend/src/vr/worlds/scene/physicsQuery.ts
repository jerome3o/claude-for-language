/**
 * Questions to the physics world: where does this ray first hit something, and is that somewhere you
 * can stand (an up-facing surface at floor height)? Teleport and click-to-walk use it, and so does the
 * flat preview's walking (a wall in the way).
 */
import { Vector3 } from 'three';
import type { useRapier } from '@react-three/rapier';

type Rapier = ReturnType<typeof useRapier>;

export interface FloorHit {
  point: Vector3;
  normal: Vector3;
  /** Standable: faces up and is at floor height. */
  floor: boolean;
}

/** The nearest STATIC thing on the ray within `max` metres (moving objects never block a teleport). */
export function castFloor(world: Rapier['world'], rapier: Rapier['rapier'], origin: Vector3, dir: Vector3, max: number): FloorHit | null {
  const ray = new rapier.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
  const hit = world.castRayAndGetNormal(ray, max, true, rapier.QueryFilterFlags.EXCLUDE_DYNAMIC);
  if (!hit) return null;
  const point = new Vector3(origin.x + dir.x * hit.timeOfImpact, origin.y + dir.y * hit.timeOfImpact, origin.z + dir.z * hit.timeOfImpact);
  const normal = new Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
  return { point, normal, floor: normal.y > 0.7 && point.y < 0.3 };
}

/** Is there a wall (anything static) within `dist` of `origin` along the horizontal `dir`? */
export function blocked(world: Rapier['world'], rapier: Rapier['rapier'], origin: Vector3, dir: Vector3, dist: number): boolean {
  const hit = castFloor(world, rapier, origin, dir, dist);
  return !!hit && !hit.floor;
}
