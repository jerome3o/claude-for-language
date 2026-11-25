/**
 * Many small static pieces in ONE mesh (docs/VR_WORLDS.md "Performance budget": each mesh is a draw
 * call). A part list — boxes, cylinders, balls, planes, each placed / turned / scaled — is merged into
 * one BufferGeometry, cached by key, drawn with one material. The street's kerbs, crate rims, railings,
 * window frames, flowers and far buildings go through it.
 */
import { BoxGeometry, CylinderGeometry, Euler, Matrix4, PlaneGeometry, Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

export type Part = (
  /** A box; `uv` scales its texture coordinates (a facade repeated over a tower). */
  | { box: V3; uv?: [number, number] }
  | { cyl: [number, number] | [number, number, number] | [number, number, number, number] }
  | { ball: number | [number, number] }
  /** A plane [w, h] facing +Z; `uv` scales its texture coordinates (a repeated facade). */
  | { plane: [number, number]; uv?: [number, number] }
) & { at?: V3; rot?: V3; scale?: V3 };

const cache = new Map<string, BufferGeometry>();
const m = new Matrix4();
const q = new Quaternion();

function geometryOf(p: Part): BufferGeometry {
  if ('box' in p) return scaleUv(new BoxGeometry(p.box[0], p.box[1], p.box[2]), p.uv);
  if ('cyl' in p) {
    const [r, h, rTop, seg] = p.cyl;
    return new CylinderGeometry(rTop ?? r, r, h, seg ?? 14);
  }
  if ('ball' in p) {
    const [r, seg] = Array.isArray(p.ball) ? p.ball : [p.ball, 12];
    return new SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
  }
  return scaleUv(new PlaneGeometry(p.plane[0], p.plane[1]), p.uv);
}

function scaleUv<T extends BufferGeometry>(g: T, by?: [number, number]): T {
  if (!by) return g;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * by[0], uv.getY(i) * by[1]);
  return g;
}

/** The merged geometry of a part list (cached by `key`: the same key must always mean the same parts). */
export function mergedGeometry(key: string, parts: readonly Part[]): BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const list = parts.map((p) => {
    const g = geometryOf(p).toNonIndexed();
    q.setFromEuler(new Euler(...(p.rot ?? [0, 0, 0])));
    m.compose(new Vector3(...(p.at ?? [0, 0, 0])), q, new Vector3(...(p.scale ?? [1, 1, 1])));
    g.applyMatrix4(m);
    return g;
  });
  const merged = mergeGeometries(list, false) ?? list[0];
  merged.computeBoundingSphere();
  cache.set(key, merged);
  return merged;
}

/** One mesh of many parts. */
export function Merged({ id, parts, material, cast = false, receive = false, position, rotation }: {
  id: string; parts: readonly Part[]; material: Material; cast?: boolean; receive?: boolean; position?: V3; rotation?: V3;
}) {
  return <mesh geometry={mergedGeometry(id, parts)} material={material} castShadow={cast} receiveShadow={receive} position={position} rotation={rotation} />;
}
