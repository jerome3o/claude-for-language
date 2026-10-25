/**
 * Where VR windows go (docs/VR.md "Comfort"): a ring at arm's length around the learner's head,
 * upright, each window turned to face them. Pure maths, unit-tested (layout.test.ts).
 *
 * Conventions (three.js): metres, Y up, the learner looks down −Z at yaw 0. A window's `yaw` is
 * its rotation about +Y; its front (+Z) then points along (sin yaw, 0, cos yaw), so a window at
 * yaw ψ placed along the view direction of yaw ψ faces the learner.
 */

export interface Vec3 { x: number; y: number; z: number }

/**
 * A window's place: the middle of its TOP edge (windows hang down from it, so a taller window
 * never rises into the sky) and its turn about the vertical axis (never tilted — upright is calmer).
 */
export interface VrPose { x: number; y: number; z: number; yaw: number }

export const VR_RING = {
  /** Arm's length: grab-able, and text at ~0.85 m reads comfortably. */
  radius: 0.85,
  /** Degrees between neighbouring slots (a 0.62 m window spans ~40° at 0.85 m, plus a gap). */
  slotStepDeg: 46,
  /** A window's top edge sits just above the eyes, so its content is below them (looking slightly down is the comfortable angle). */
  topAboveEyes: 0.05,
  /** Slots used before the ring wraps: centre, right, left, far right, far left, … */
  maxSlots: 7,
  minDistance: 0.35,
  maxDistance: 3,
  minY: 0.2,
  maxY: 2.8,
} as const;

/** Eye height used before the headset reports one (standing ~1.6 m, seated ~1.2 m). */
export const VR_DEFAULT_EYE_HEIGHT = 1.5;

const DEG = Math.PI / 180;

/** The view direction's yaw from a forward vector (0 = looking down −Z). */
export function headYawFromForward(forward: Vec3): number {
  if (Math.abs(forward.x) < 1e-9 && Math.abs(forward.z) < 1e-9) return 0;
  return Math.atan2(-forward.x, -forward.z) + 0; // + 0: never -0
}

/** Slot 0 straight ahead, then alternately right and left, widening: 0, −1, +1, −2, +2, … steps. */
export function ringSlotYawOffset(slot: number): number {
  const s = Math.max(0, Math.floor(slot)) % VR_RING.maxSlots;
  if (s === 0) return 0;
  const step = Math.ceil(s / 2);
  const side = s % 2 === 1 ? -1 : 1; // odd = to the right (negative yaw), even = to the left
  return side * step * VR_RING.slotStepDeg * DEG;
}

/** The yaw that turns a window at `pos` to face `head`. */
export function facingYaw(pos: Vec3, head: Vec3): number {
  const dx = head.x - pos.x;
  const dz = head.z - pos.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return Math.atan2(dx, dz);
}

/** The pose of ring slot `slot` around a learner at `head` looking along `headYaw`. */
export function ringPose(slot: number, head: Vec3, headYaw: number, radius: number = VR_RING.radius): VrPose {
  const yaw = headYaw + ringSlotYawOffset(slot);
  return {
    x: head.x - radius * Math.sin(yaw),
    y: head.y + VR_RING.topAboveEyes,
    z: head.z - radius * Math.cos(yaw),
    yaw,
  };
}

/** The direction of a point as seen from the head, as a yaw (0 = straight down −Z). */
export function bearingFrom(head: Vec3, p: Vec3): number {
  return headYawFromForward({ x: p.x - head.x, y: 0, z: p.z - head.z });
}

function angleBetween(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * Where a new window goes: the first ring slot around where the learner looks now (straight
 * ahead, then right, left, further right, …) that no open window already covers.
 */
export function freeRingPose(existing: readonly Vec3[], head: Vec3, headYaw: number): VrPose {
  const clear = (VR_RING.slotStepDeg * DEG) * 0.7;
  for (let s = 0; s < VR_RING.maxSlots; s++) {
    const yaw = headYaw + ringSlotYawOffset(s);
    if (existing.every((p) => angleBetween(bearingFrom(head, p), yaw) >= clear)) return ringPose(s, head, headYaw);
  }
  return ringPose(existing.length % VR_RING.maxSlots, head, headYaw);
}

export function isFinitePose(p: unknown): p is VrPose {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return ['x', 'y', 'z', 'yaw'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
}

/**
 * Keeps a window reachable and readable: horizontally 0.35–3 m from the head, 0.2–2.8 m above
 * the floor, turned to face the head.
 */
export function clampPose(pose: VrPose, head: Vec3): VrPose {
  let dx = pose.x - head.x;
  let dz = pose.z - head.z;
  let dist = Math.hypot(dx, dz);
  if (dist < 1e-6) {
    dx = 0;
    dz = -1;
    dist = 1;
  }
  const clamped = Math.min(VR_RING.maxDistance, Math.max(VR_RING.minDistance, dist));
  const x = head.x + (dx / dist) * clamped;
  const z = head.z + (dz / dist) * clamped;
  const y = Math.min(VR_RING.maxY, Math.max(VR_RING.minY, pose.y));
  return { x, y, z, yaw: facingYaw({ x, y, z }, head) };
}

/** A world point in a window's own plane coordinates (metres from its anchor). */
export function localPoint(pose: VrPose, world: Vec3): { x: number; y: number } {
  // x along the window's right edge, y up from its anchor (the top edge's middle)
  const dx = world.x - pose.x;
  const dz = world.z - pose.z;
  return { x: dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw), y: world.y - pose.y };
}

/**
 * Dragging a window by its grab bar: the point grabbed (`grabLocal`, window coordinates) follows
 * the ray at the distance it was grabbed, and the window turns to keep facing the learner.
 */
export function dragPose(rayOrigin: Vec3, rayDir: Vec3, distance: number, grabLocal: { x: number; y: number }, head: Vec3): VrPose {
  const len = Math.hypot(rayDir.x, rayDir.y, rayDir.z) || 1;
  const hit = {
    x: rayOrigin.x + (rayDir.x / len) * distance,
    y: rayOrigin.y + (rayDir.y / len) * distance,
    z: rayOrigin.z + (rayDir.z / len) * distance,
  };
  // The window faces the head from its anchor, and the grabbed point must stay on the ray: a
  // few fixed-point steps settle both (the grab offset is small next to the distance).
  let yaw = facingYaw(hit, head);
  let anchor = { x: hit.x, y: hit.y - grabLocal.y, z: hit.z };
  for (let i = 0; i < 6; i++) {
    anchor = { x: hit.x - grabLocal.x * Math.cos(yaw), y: hit.y - grabLocal.y, z: hit.z + grabLocal.x * Math.sin(yaw) };
    yaw = facingYaw(anchor, head);
  }
  return clampPose({ ...anchor, yaw }, head);
}

/** "Bring windows here": `count` windows in ring slots around the current view. */
export function recallPoses(count: number, head: Vec3, headYaw: number): VrPose[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ringPose(i, head, headYaw));
}

/**
 * The tray (window menu): low and close in front, like a desk — looking straight at the windows
 * it stays below them; glance down to use it.
 */
export function trayPose(head: Vec3, headYaw: number): VrPose {
  const d = 0.55;
  return { x: head.x - d * Math.sin(headYaw), y: head.y - 0.45, z: head.z - d * Math.cos(headYaw), yaw: headYaw };
}
