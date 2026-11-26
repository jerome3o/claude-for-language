/**
 * Merged geometry for the restaurant (local helper): many small same-material pieces (four chair legs
 * and a back, the tray's rim, eight dumplings, the shelf of bottles behind the till) become ONE mesh
 * = one draw call. The kit's primitives are one mesh each, which is right for a cup and too many for a
 * room full of furniture (docs/VR_WORLDS.md "Performance budget": ≤ 250 draw calls).
 *
 *   const g = merged('chair-wood', () => [box([0.035, 0.45, 0.035], [x, y, z]), …]);
 *   <mesh geometry={g} material={mat('wood', '#7a4a2a')} castShadow />
 *
 * Cached by key for the life of the page (like the kit's geometry cache).
 */
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Euler, LatheGeometry, Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

export interface Piece {
  g: BufferGeometry;
  p?: V3;
  r?: V3;
  s?: V3;
}

const cache = new Map<string, BufferGeometry>();

/** Merge the pieces (each moved / turned / scaled) into one geometry, cached by `key`. */
export function merged(key: string, make: () => Piece[]): BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new Matrix4();
  const q = new Quaternion();
  const parts = make().map(({ g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] }) => {
    const c = (g.index ? g.toNonIndexed() : g.clone());
    // Every piece keeps the same attribute set (position, normal, uv) so they merge.
    for (const name of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(name)) c.deleteAttribute(name);
    m.compose(new Vector3(...p), q.setFromEuler(new Euler(...r)), new Vector3(...s));
    c.applyMatrix4(m);
    return c;
  });
  const out = mergeGeometries(parts, false) ?? new BufferGeometry();
  out.computeBoundingSphere();
  cache.set(key, out);
  return out;
}

// Piece makers (positions in the merged mesh's frame).
export const box = (size: V3, p?: V3, r?: V3): Piece => ({ g: new BoxGeometry(...size), p, r });
export const cyl = (r: number, h: number, p?: V3, opts: { rTop?: number; seg?: number; rot?: V3; open?: boolean } = {}): Piece => ({
  g: new CylinderGeometry(opts.rTop ?? r, r, h, opts.seg ?? 16, 1, opts.open ?? false), p, r: opts.rot,
});
export const ball = (r: number, p?: V3, s?: V3, seg = 12): Piece => ({ g: new SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), p, s });
export const ring = (r: number, tube: number, p?: V3, rot?: V3, arc = Math.PI * 2, seg = 24): Piece => ({ g: new TorusGeometry(r, tube, 6, seg, arc), p, r: rot });
export const lathe = (profile: ReadonlyArray<readonly [number, number]>, p?: V3, s?: V3, seg = 20): Piece => ({
  g: new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), seg), p, s,
});

/** Points round a circle: n positions at radius r (x, z), starting at angle a0. */
export function around(n: number, r: number, a0 = 0): Array<[number, number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return [Math.sin(a) * r, Math.cos(a) * r, a];
  });
}
