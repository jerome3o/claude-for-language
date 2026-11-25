/**
 * Static colliders for a world's Scene (docs/VR_WORLDS.md "The contract"): walls, counters, the floor —
 * anything things should bump into or rest on that isn't an object of its own. Objects (the things with
 * a Chinese name) get their colliders from their spec instead, so don't wrap them in these.
 *
 *   <Solid size={[2.4, 0.9, 0.6]} at={[0, 0.45, -2]} />   // a counter: things rest on it at y = 0.9
 */
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';

type V3 = [number, number, number];

/** A fixed box (full size, centred at `at`, turned by `yaw`). */
export function Solid({ size, at, yaw = 0, friction = 0.7 }: { size: V3; at: V3; yaw?: number; friction?: number }) {
  return (
    <RigidBody type="fixed" colliders={false} position={at} rotation={[0, yaw, 0]}>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} friction={friction} />
    </RigidBody>
  );
}

/** A fixed upright cylinder (a pillar, a round table's foot). */
export function SolidCylinder({ r, h, at }: { r: number; h: number; at: V3 }) {
  return (
    <RigidBody type="fixed" colliders={false} position={at}>
      <CylinderCollider args={[h / 2, r]} friction={0.7} />
    </RigidBody>
  );
}

/** The ground: a thick slab whose top is y = 0, covering `size` (x, z) around `center`. */
export function FloorCollider({ size, center = [0, 0] }: { size: [number, number]; center?: [number, number] }) {
  return <Solid size={[size[0], 0.4, size[1]]} at={[center[0], -0.2, center[1]]} friction={0.9} />;
}
