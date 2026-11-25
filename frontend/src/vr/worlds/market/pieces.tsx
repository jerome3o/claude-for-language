/**
 * Small helpers local to the market world: one draw call for a pile of things (an InstancedMesh with
 * a colour per instance — a crate of tomatoes, a bunch of grapes, an egg tray), cached geometries
 * the kit doesn't have (a lathe lying along an axis, a curved tube), and produce shapes shared by the
 * grabbable models and the decorative piles.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  CatmullRomCurve3, CircleGeometry, Color, ConeGeometry, CylinderGeometry, Euler, LatheGeometry, Matrix4, Quaternion, SphereGeometry,
  TorusGeometry, TubeGeometry, Vector2, Vector3, type BufferGeometry, type InstancedMesh, type Material,
} from 'three';

const geo = new Map<string, BufferGeometry>();
function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geo.get(key) as T | undefined;
  if (!g) {
    g = make();
    geo.set(key, g);
  }
  return g;
}

export const sphere = (r: number, seg = 14) => cached(`s:${r}:${seg}`, () => new SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))));
export const cone = (r: number, h: number, seg = 10) => cached(`c:${r}:${h}:${seg}`, () => new ConeGeometry(r, h, seg));
export const cylinder = (r: number, h: number, seg = 12, rTop = r) => cached(`y:${r}:${rTop}:${h}:${seg}`, () => new CylinderGeometry(rTop, r, h, seg));
export const torus = (r: number, tube: number, arc = Math.PI * 2, seg = 24) => cached(`t:${r}:${tube}:${arc}:${seg}`, () => new TorusGeometry(r, tube, 8, seg, arc));

/** The lower half of a disc (a scalloped awning edge), facing +z. */
export const halfDisc = (r: number, seg = 10) => cached(`hd:${r}:${seg}`, () => new CircleGeometry(r, seg, Math.PI, Math.PI));

/** A lathe from [radius, y] points (spun about Y). */
export function lathe(key: string, profile: ReadonlyArray<readonly [number, number]>, seg = 18): BufferGeometry {
  return cached(`l:${key}`, () => new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), seg));
}

/** A tube along a few points (a chilli, a banana). */
export function tube(key: string, points: ReadonlyArray<readonly [number, number, number]>, r: number, seg = 16): BufferGeometry {
  return cached(`tb:${key}`, () => new TubeGeometry(new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z))), seg, r, 7, false));
}

/** A long rounded shape along its own Y (cucumber, eggplant, carrot): radius at fractions of the length. */
export function podProfile(len: number, radii: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [[0, -len / 2]];
  radii.forEach((r, i) => out.push([r, -len / 2 + (len * (i + 1)) / (radii.length + 1)]));
  out.push([0, len / 2]);
  return out;
}

/** One instance: position, uniform or [x, y, z] scale, rotation (Euler XYZ), colour. */
export interface Inst {
  p: [number, number, number];
  s?: number | [number, number, number];
  r?: [number, number, number];
  c?: string;
}

/** Many copies of one mesh in ONE draw call; `c` tints each copy (the material should be light). */
export function Cluster({ geometry, material, items, cast = true, receive = false, position, rotation }: {
  geometry: BufferGeometry; material: Material; items: readonly Inst[]; cast?: boolean; receive?: boolean;
  position?: [number, number, number]; rotation?: [number, number, number];
}) {
  const ref = useRef<InstancedMesh>(null);
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), e: new Euler(), v: new Vector3(), s: new Vector3(), c: new Color() }), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      tmp.e.set(...(it.r ?? [0, 0, 0]));
      tmp.q.setFromEuler(tmp.e);
      const s = it.s ?? 1;
      if (typeof s === 'number') tmp.s.setScalar(s);
      else tmp.s.set(s[0], s[1], s[2]);
      tmp.m.compose(tmp.v.set(...it.p), tmp.q, tmp.s);
      mesh.setMatrixAt(i, tmp.m);
      if (it.c) mesh.setColorAt(i, tmp.c.set(it.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, tmp]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={cast}
      receiveShadow={receive}
      position={position}
      rotation={rotation}
      frustumCulled={false}
    />
  );
}

/**
 * A heap of round things in a crate-sized box: rows and layers, jittered (seeded), the top layer
 * thinner so it mounds. `w`, `d` = the box's inside; `r` = one thing's radius.
 */
export function heap(seed: number, w: number, d: number, r: number, layers: number, colors: string[], jitter = 0.25, squash = 1): Inst[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Inst[] = [];
  const step = r * 2 * 0.95;
  for (let l = 0; l < layers; l++) {
    const inset = l * r * 0.9;
    const nx = Math.max(1, Math.floor((w - 2 * inset) / step));
    const nz = Math.max(1, Math.floor((d - 2 * inset) / step));
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        if (l === layers - 1 && rnd() < 0.3) continue;
        const x = -((nx - 1) * step) / 2 + i * step + (rnd() - 0.5) * r * jitter + (l % 2) * r * 0.4;
        const z = -((nz - 1) * step) / 2 + k * step + (rnd() - 0.5) * r * jitter;
        const y = r * squash + l * r * 1.6 * squash;
        out.push({ p: [x, y, z], s: 0.9 + rnd() * 0.2, r: [rnd() * 0.6, rnd() * 6.28, rnd() * 0.6], c: colors[Math.floor(rnd() * colors.length)] });
      }
    }
  }
  return out;
}
