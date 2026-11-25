/**
 * Shape primitives for VR worlds (docs/VR_WORLDS.md "The helper library"): rounded boxes, boxes,
 * cylinders, balls and lathe shapes (cups, bowls, bottles, plates, pots) with CACHED geometry — the
 * same size asks for the same BufferGeometry, so a shelf of identical cups is cheap. Every component
 * takes a material (kit/materials.ts `mat(...)`) and the usual position / rotation / scale props.
 *
 * Shadows: dynamic things cast (`cast` defaults on), big flat things receive (`receive`).
 */
import { useMemo } from 'react';
import { BoxGeometry, CylinderGeometry, LatheGeometry, SphereGeometry, Vector2, type BufferGeometry, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const geoCache = new Map<string, BufferGeometry>();
function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key);
  if (hit) return hit as T;
  const g = make();
  geoCache.set(key, g);
  return g;
}

type V3 = [number, number, number];

export interface PrimitiveProps {
  material: Material;
  position?: V3;
  rotation?: V3;
  scale?: number | V3;
  cast?: boolean;
  receive?: boolean;
  /** Name for debugging (three.js inspector). */
  name?: string;
}

function Mesh({ geometry, material, position, rotation, scale, cast = true, receive = false, name }: PrimitiveProps & { geometry: BufferGeometry }) {
  return <mesh geometry={geometry} material={material} position={position} rotation={rotation} scale={scale} castShadow={cast} receiveShadow={receive} name={name} />;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A box with rounded edges (furniture, appliances, cartons). `radius` ≤ half the smallest side. */
export function RBox({ size, radius = 0.01, segments = 2, ...rest }: PrimitiveProps & { size: V3; radius?: number; segments?: number }) {
  const rad = Math.min(radius, Math.min(...size) / 2 - 1e-4);
  const g = cached(`rbox:${size.map(r3)}:${r3(rad)}:${segments}`, () => new RoundedBoxGeometry(size[0], size[1], size[2], segments, Math.max(0, rad)));
  return <Mesh geometry={g} {...rest} />;
}

export function Box({ size, ...rest }: PrimitiveProps & { size: V3 }) {
  const g = cached(`box:${size.map(r3)}`, () => new BoxGeometry(size[0], size[1], size[2]));
  return <Mesh geometry={g} {...rest} />;
}

/** Upright cylinder (or a cone / frustum with `rTop`). */
export function Cyl({ r, h, rTop, segments = 24, open = false, ...rest }: PrimitiveProps & { r: number; h: number; rTop?: number; segments?: number; open?: boolean }) {
  const g = cached(`cyl:${r3(r)}:${r3(rTop ?? r)}:${r3(h)}:${segments}:${open}`, () => new CylinderGeometry(rTop ?? r, r, h, segments, 1, open));
  return <Mesh geometry={g} {...rest} />;
}

export function Ball({ r, segments = 20, ...rest }: PrimitiveProps & { r: number; segments?: number }) {
  const g = cached(`ball:${r3(r)}:${segments}`, () => new SphereGeometry(r, segments, Math.max(8, Math.round(segments * 0.7))));
  return <Mesh geometry={g} {...rest} />;
}

/**
 * A lathe shape: a profile of [radius, y] points (bottom → top, outside then back down the inside for
 * a hollow thing) spun about Y. The profile helpers below make the common kitchen shapes, centred on
 * their own height (origin = the middle, like an object's collider).
 */
export function Lathe({ profile, segments = 28, ...rest }: PrimitiveProps & { profile: ReadonlyArray<readonly [number, number]>; segments?: number }) {
  const key = `lathe:${profile.map(([a, b]) => `${r3(a)},${r3(b)}`).join(';')}:${segments}`;
  const g = useMemo(() => cached(key, () => new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), segments)), [key, profile, segments]);
  return <Mesh geometry={g} {...rest} />;
}

type Profile = Array<[number, number]>;

/** A cup / mug / glass: radius at the rim, height, wall thickness; slightly narrower at the foot. */
export function cupProfile(r: number, h: number, wall = 0.004, foot = 0.85): Profile {
  const y0 = -h / 2;
  const y1 = h / 2;
  return [
    [0, y0], [r * foot, y0], [r * foot + 0.002, y0 + 0.004], [r, y1],
    [r - wall, y1], [r * foot + 0.002 - wall, y0 + wall + 0.004], [0, y0 + wall + 0.004],
  ];
}

/** A bowl: rounded, wide at the rim. */
export function bowlProfile(r: number, h: number, wall = 0.005): Profile {
  const out: Profile = [[0, -h / 2], [r * 0.45, -h / 2]];
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    out.push([r * 0.45 + (r - r * 0.45) * Math.sin(a), -h / 2 + h * (1 - Math.cos(a))]);
  }
  for (let i = 8; i >= 1; i--) {
    const a = (i / 8) * (Math.PI / 2);
    out.push([r * 0.45 - wall + (r - r * 0.45) * Math.sin(a), -h / 2 + wall + (h - wall) * (1 - Math.cos(a))]);
  }
  out.push([0, -h / 2 + wall]);
  return out;
}

/** A plate: a flat disc with a raised rim. */
export function plateProfile(r: number, h = 0.02): Profile {
  return [[0, -h / 2], [r * 0.62, -h / 2], [r, h / 2], [r - 0.006, h / 2], [r * 0.6, -h / 2 + 0.004], [0, -h / 2 + 0.004]];
}

/** A bottle: body, shoulder, neck. */
export function bottleProfile(r: number, h: number, neck = r * 0.35): Profile {
  const y0 = -h / 2;
  return [
    [0, y0], [r * 0.95, y0], [r, y0 + 0.01], [r, y0 + h * 0.6], [r * 0.8, y0 + h * 0.72], [neck, y0 + h * 0.8],
    [neck, y0 + h * 0.97], [neck * 1.12, y0 + h * 0.98], [neck * 1.12, y0 + h], [0, y0 + h],
  ];
}

/** A cooking pot: straight sides, a lip. */
export function potProfile(r: number, h: number, wall = 0.004): Profile {
  return [[0, -h / 2], [r - 0.006, -h / 2], [r, -h / 2 + 0.008], [r, h / 2], [r + 0.006, h / 2], [r + 0.006, h / 2 - 0.006], [r - wall, h / 2 - 0.006], [r - wall, -h / 2 + wall], [0, -h / 2 + wall]];
}
