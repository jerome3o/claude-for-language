/**
 * Moving around a VR world (docs/VR_WORLDS.md "Getting around"): the RIG is where the headset's play
 * space sits in the world (position + a turn about Y). Teleport puts your HEAD over the target (not the
 * play space's centre, which may be a metre away in room scale); a snap turn turns you about your head.
 * The headset session follows the rig through an offset reference space (`rigOffsetTransform`).
 * Pure maths, unit-tested.
 */
import type { Vec3 } from './types';

export interface Rig { x: number; y: number; z: number; yaw: number }

/** three.js rotation about +Y of an (x, z) pair. */
export function rotateXZ(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/** A point in the play space (the headset's own coordinates) → the world. */
export function rigToWorld(rig: Rig, local: Vec3): Vec3 {
  const [x, z] = rotateXZ(local[0], local[2], rig.yaw);
  return [rig.x + x, rig.y + local[1], rig.z + z];
}

/** Teleport: the head (play-space position `headLocal`) ends up over `target` (x / z); height unchanged. */
export function teleportRig(rig: Rig, headLocal: Vec3, target: Vec3): Rig {
  const [hx, hz] = rotateXZ(headLocal[0], headLocal[2], rig.yaw);
  return { ...rig, x: target[0] - hx, z: target[2] - hz };
}

/** Snap turn by `delta` radians about the head (positive = to the left). */
export function snapTurnRig(rig: Rig, headLocal: Vec3, delta: number): Rig {
  const head = rigToWorld(rig, headLocal);
  const yaw = normalizeAngle(rig.yaw + delta);
  const [hx, hz] = rotateXZ(headLocal[0], headLocal[2], yaw);
  return { ...rig, yaw, x: head[0] - hx, z: head[2] - hz };
}

export function normalizeAngle(a: number): number {
  const r = Math.atan2(Math.sin(a), Math.cos(a));
  return r === 0 ? 0 : r; // never -0
}

/**
 * The XRRigidTransform for `XRReferenceSpace.getOffsetReferenceSpace`: poses in the offset space are
 * the base space's poses moved by the rig, so the offset's origin is the rig's INVERSE.
 */
export function rigOffsetTransform(rig: Rig): { position: Vec3; orientation: [number, number, number, number] } {
  const [x, z] = rotateXZ(-rig.x, -rig.z, -rig.yaw);
  const h = -rig.yaw / 2;
  return { position: [x, -rig.y, z], orientation: [0, Math.sin(h), 0, Math.cos(h)] };
}

/** Snap-turn step (radians). */
export const SNAP_TURN = Math.PI / 6;

/**
 * The teleport arc: a ballistic curve from the controller (origin, unit direction), sampled as
 * points until it falls below the floor or `maxPoints` run out. Speed / gravity give ~6 m of reach.
 */
export function teleportArc(origin: Vec3, dir: Vec3, opts: { speed?: number; gravity?: number; step?: number; maxPoints?: number; floorY?: number } = {}): Vec3[] {
  const speed = opts.speed ?? 7;
  const g = opts.gravity ?? 9.8;
  const dt = opts.step ?? 0.03;
  const max = opts.maxPoints ?? 60;
  const floor = (opts.floorY ?? 0) - 0.5;
  const pts: Vec3[] = [];
  for (let i = 0; i < max; i++) {
    const t = i * dt;
    const p: Vec3 = [origin[0] + dir[0] * speed * t, origin[1] + dir[1] * speed * t - 0.5 * g * t * t, origin[2] + dir[2] * speed * t];
    pts.push(p);
    if (p[1] < floor) break;
  }
  return pts;
}

/** A world point → the play space (the inverse of `rigToWorld`): where the head is in the headset's own coordinates. */
export function worldToRig(rig: Rig, p: Vec3): Vec3 {
  const [x, z] = rotateXZ(p[0] - rig.x, p[2] - rig.z, -rig.yaw);
  return [x, p[1] - rig.y, z];
}
