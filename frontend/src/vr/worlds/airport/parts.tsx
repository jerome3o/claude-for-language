/**
 * Airport building blocks kept in this folder (docs/VR_WORLDS.md: prefer helpers local to a world):
 *
 * - `<Inst>` — many copies of one shape + material as ONE InstancedMesh (one draw call): mullions,
 *   ceiling light strips, seat legs, rollers, stanchions.
 * - `useBeltDrive` — a running belt: every frame, dynamic bodies resting on a box above the belt (not
 *   held) are carried along it at belt speed and stop near its end. Used by the check-in conveyor (传送带)
 *   and the x-ray machine (安检机). It reads the Rapier world the models are drawn in.
 * - `useWeigher` — the luggage scale: the mass of what lies on its pan, for its display.
 * - `<Static>` — bakes the plain meshes inside it into one mesh per material (+ shadow flags) after
 *   they mount: a detailed hall stays within the draw-call budget. Only for parts that never change
 *   (no state-driven materials, no animated refs) — leave those outside it.
 */
import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { BoxGeometry, BufferAttribute, CylinderGeometry, Euler, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Group, type InstancedMesh, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

const geoCache = new Map<string, BufferGeometry>();
export function boxGeo(w: number, h: number, d: number): BufferGeometry {
  const k = `b:${w}:${h}:${d}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new BoxGeometry(w, h, d);
    geoCache.set(k, g);
  }
  return g;
}
export function cylGeo(r: number, h: number, segments = 12, rTop = r): BufferGeometry {
  const k = `c:${r}:${rTop}:${h}:${segments}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new CylinderGeometry(rTop, r, h, segments);
    geoCache.set(k, g);
  }
  return g;
}

/** One instance: position, optional rotation (radians) and scale. */
export type InstanceAt = { p: V3; r?: V3; s?: V3 };

/** Copies of one geometry + material in a single draw call. */
export function Inst({ geometry, material, at, cast = true, receive = false }: { geometry: BufferGeometry; material: Material; at: readonly InstanceAt[]; cast?: boolean; receive?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mat4 = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const pos = new Vector3();
    const scl = new Vector3();
    at.forEach((a, i) => {
      e.set(...(a.r ?? [0, 0, 0]));
      q.setFromEuler(e);
      pos.set(...a.p);
      scl.set(...(a.s ?? [1, 1, 1]));
      mat4.compose(pos, q, scl);
      m.setMatrixAt(i, mat4);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [at]);
  return <instancedMesh ref={ref} args={[geometry, material, at.length]} castShadow={cast} receiveShadow={receive} />;
}

const tmpV = new Vector3();
const tmpQ = new Quaternion();
const tmpRel = new Vector3();

/**
 * Carries resting things along a belt while `running`. The belt is described in the frame of `ref`
 * (a group inside the object's model): its top surface centre `centre`, its length along local +X
 * (`length`) and width (`width`). Things move toward +X at `speed` m/s and stop `stopBefore` metres
 * before the far end (where a bumper catches them).
 */
export function useBeltDrive(ref: RefObject<Group>, running: boolean, belt: { centre: V3; length: number; width: number; speed: number; stopBefore?: number; height?: number }) {
  const { world, rapier } = useRapier();
  const h = belt.height ?? 0.4;
  const shape = useMemo(() => new rapier.Cuboid(belt.length / 2, h / 2, belt.width / 2), [rapier, belt.length, belt.width, h]);
  const seen = useRef(new Set<number>());
  const on = useRef(running);
  on.current = running;
  // Where the belt is in the world: read from the model's group each frame (it is fixed), used by the
  // physics step — so the belt carries things at its speed whatever the frame rate.
  const frame = useRef<{ origin: { x: number; y: number; z: number }; rot: { x: number; y: number; z: number; w: number }; dir: Vector3 } | null>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.updateWorldMatrix(true, false);
    g.getWorldQuaternion(tmpQ);
    tmpV.set(belt.centre[0], belt.centre[1] + h / 2, belt.centre[2]);
    g.localToWorld(tmpV);
    const f = frame.current ?? { origin: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, dir: new Vector3() };
    f.origin.x = tmpV.x; f.origin.y = tmpV.y; f.origin.z = tmpV.z;
    f.rot.x = tmpQ.x; f.rot.y = tmpQ.y; f.rot.z = tmpQ.z; f.rot.w = tmpQ.w;
    f.dir.set(1, 0, 0).applyQuaternion(tmpQ);
    frame.current = f;
  });
  useBeforePhysicsStep(() => {
    const f = frame.current;
    if (!on.current || !f) return;
    const ends = belt.length / 2 - (belt.stopBefore ?? 0.25);
    seen.current.clear();
    world.intersectionsWithShape(f.origin, f.rot, shape, (collider) => {
      const body = collider.parent();
      if (!body || !body.isDynamic() || seen.current.has(body.handle)) return true;
      seen.current.add(body.handle);
      if (body.gravityScale() === 0) return true; // held: the hand wins
      const t = body.translation();
      tmpRel.set(t.x - f.origin.x, 0, t.z - f.origin.z);
      if (tmpRel.dot(f.dir) > ends) return true;
      const v = body.linvel();
      body.setLinvel({ x: f.dir.x * belt.speed, y: Math.min(v.y, 0.5), z: f.dir.z * belt.speed }, true);
      const w = body.angvel();
      body.setAngvel({ x: w.x * 0.8, y: w.y * 0.8, z: w.z * 0.8 }, true);
      return true;
    }, rapier.QueryFilterFlags.EXCLUDE_FIXED);
  });
}

/**
 * Weighs what rests on a pan: the total mass (kg) of the dynamic bodies inside a box over it (held
 * things don't count). `onWeight` is called when the reading changes by ≥ 0.1 kg (a few times a second).
 */
export function useWeigher(ref: RefObject<Group>, pan: { centre: V3; size: [number, number]; height?: number }, onWeight: (kg: number) => void) {
  const { world, rapier } = useRapier();
  const h = pan.height ?? 0.7;
  const shape = useMemo(() => new rapier.Cuboid(pan.size[0] / 2, h / 2, pan.size[1] / 2), [rapier, pan.size, h]);
  const last = useRef(-1);
  const since = useRef(0);
  const seen = useRef(new Set<number>());
  useFrame((_, dt) => {
    since.current += dt;
    const g = ref.current;
    if (since.current < 0.2 || !g) return;
    since.current = 0;
    g.updateWorldMatrix(true, false);
    g.getWorldQuaternion(tmpQ);
    tmpV.set(pan.centre[0], pan.centre[1] + h / 2, pan.centre[2]);
    g.localToWorld(tmpV);
    let kg = 0;
    seen.current.clear();
    world.intersectionsWithShape({ x: tmpV.x, y: tmpV.y, z: tmpV.z }, { x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, shape, (collider) => {
      const body = collider.parent();
      if (!body || !body.isDynamic() || seen.current.has(body.handle)) return true;
      seen.current.add(body.handle);
      if (body.gravityScale() === 0) return true;
      kg += body.mass();
      return true;
    }, rapier.QueryFilterFlags.EXCLUDE_FIXED);
    const r = Math.round(kg * 10) / 10;
    if (Math.abs(r - last.current) >= 0.1) {
      last.current = r;
      onWeight(r);
    }
  });
}

const KEEP = ['position', 'normal', 'uv'];

/** Bakes the static meshes under `root` into one mesh per (material, cast, receive); hides the originals. */
function bake(root: Group): { baked: Mesh[]; hidden: Mesh[] } {
  root.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: Material; cast: boolean; receive: boolean; parts: BufferGeometry[]; meshes: Mesh[] }>();
  const m = new Matrix4();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (mesh as unknown as InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || mesh.userData.noMerge) return;
    let visible = true;
    for (let p: typeof o | null = o; p && p !== root; p = p.parent) if (!p.visible) visible = false;
    if (!visible) return;
    let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {};
    g.clearGroups();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    g = g.applyMatrix4(m);
    const key = `${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = { material: mesh.material as Material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [], meshes: [] };
      groups.set(key, entry);
    }
    entry.parts.push(g);
    entry.meshes.push(mesh);
  });
  const out: Mesh[] = [];
  const hidden: Mesh[] = [];
  for (const e of groups.values()) {
    if (e.meshes.length < 2) {
      e.parts.forEach((g) => g.dispose());
      continue;
    }
    const merged = mergeGeometries(e.parts, false);
    e.parts.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new Mesh(merged, e.material);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = e.receive;
    mesh.userData.noMerge = true;
    mesh.name = 'baked';
    for (const src of e.meshes) {
      src.visible = false;
      hidden.push(src);
    }
    root.add(mesh);
    out.push(mesh);
  }
  return { baked: out, hidden };
}

/** Static parts, baked into a few meshes once mounted (see the file comment). */
export function Static({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const { baked, hidden } = bake(root);
    return () => {
      for (const b of baked) {
        root.remove(b);
        b.geometry.dispose();
      }
      for (const h of hidden) h.visible = true;
    };
  }, []);
  return <group ref={ref}>{children}</group>;
}
