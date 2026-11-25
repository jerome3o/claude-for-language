/**
 * The market's scales really weigh (docs/VR_WORLDS.md — world-local helper): a few times a second a
 * scale asks Rapier which bodies' colliders are in the box over its pan and adds up their masses
 * (things held in a hand — gravity off — don't count; a bag of tomatoes counts with its tomatoes).
 * The electronic scale prints it in 斤 (half a kilo, how markets price things), the hanging scale's
 * needle swings to it.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { Quaternion, Vector3, type Object3D } from 'three';

/** 1 斤 = 0.5 kg. */
export const JIN_PER_KG = 2;

/**
 * Returns a ref holding the kilograms resting in the box `half` (half extents) centred `offset`
 * above the scale's own frame (`anchor`, a group inside the scale's model). `onChange` runs when the
 * reading moves by more than 5 g.
 */
export function useWeighed(anchor: React.RefObject<Object3D>, half: [number, number, number], offset: [number, number, number], onChange?: (kg: number) => void) {
  const { world, rapier } = useRapier();
  const kg = useRef(0);
  const last = useRef(0);
  const shape = useMemo(() => new rapier.Cuboid(half[0], half[1], half[2]), [rapier, half]);
  const tmp = useMemo(() => ({ p: new Vector3(), q: new Quaternion(), o: new Vector3() }), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t - last.current < 0.15) return;
    last.current = t;
    const a = anchor.current;
    if (!a) return;
    a.getWorldPosition(tmp.p);
    a.getWorldQuaternion(tmp.q);
    tmp.o.set(offset[0], offset[1], offset[2]).applyQuaternion(tmp.q).add(tmp.p);
    const seen = new Set<number>();
    let total = 0;
    try {
      world.intersectionsWithShape(
        { x: tmp.o.x, y: tmp.o.y, z: tmp.o.z },
        { x: tmp.q.x, y: tmp.q.y, z: tmp.q.z, w: tmp.q.w },
        shape,
        (collider) => {
          const body = collider.parent();
          if (!body || seen.has(body.handle)) return true;
          seen.add(body.handle);
          if (body.isFixed() || body.gravityScale() === 0) return true;
          total += body.mass();
          return true;
        },
      );
    } catch {
      return;
    }
    if (Math.abs(total - kg.current) > 0.005) {
      kg.current = total;
      onChange?.(total);
    }
  });
  return kg;
}

/** "8.00" — the reading in 斤, two decimals (what the market's scales show). */
export function jinReading(kg: number): string {
  return (Math.max(0, kg) * JIN_PER_KG).toFixed(2);
}
