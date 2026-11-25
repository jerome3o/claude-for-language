/**
 * A VR world's 3D scene (docs/VR_WORLDS.md): the world's room and objects under physics (Rapier), the
 * player (the flat camera, or the headset with teleport / snap turn through an offset reference space),
 * the panels (task HUD on the left wrist — or the corner of the flat view —, the inspect panel over an
 * object, the explorer beside it, the label over what you point at), sounds and the success burst.
 *
 * Like the /vr room the page owns the app data and builds panel nodes; this scene draws them and
 * reports what happened: a tick of the world (snapshot + events) ~10× a second, inspects, panel taps.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, useRapier } from '@react-three/rapier';
import { Group, PCFShadowMap, Quaternion, Ray, Vector3, type PerspectiveCamera } from 'three';
import {
  localBounds, rigOffsetTransform, snapTurnRig, teleportRig, worldToRig, type Rig, type Vec3, type WorldEvent, type WorldSnapshot,
} from '@shared/vr-worlds';
import { facingYaw } from '@shared/vr';
import { InteractionHub } from '../../scene/interaction';
import { PanelMesh, PX_PER_METRE } from '../../scene/PanelMesh';
import { debugTargets, type DebugTarget } from '../../scene/debug';
import type { UiNode } from '../../ui/layout';
import { WorldLighting } from '../kit/lighting';
import type { WorldDefinition } from '../types';
import type { SoundEngine } from '../sound';
import { hoverLabelNodes } from '../panels';
import { Burst } from './Burst';
import { Grabber } from './grabber';
import { LiveObjects } from './live';
import { WorldObject } from './WorldObject';
import { EYE_HEIGHT, FLAT_SOURCE, WorldFlatControls, type FlatRig, type WalkInput } from './WorldFlatControls';
import { WorldXrInput, type WorldXrInputApi } from './WorldXrInput';

export const HUD_WIDTH_PX = 680;
export const INSPECT_WIDTH_PX = 560;
export const EXPLORER_WIDTH_PX = 720;
const TICK_MS = 100;

export interface WorldDebugObject {
  id: string;
  /** Page pixels of its centre. */
  x: number;
  y: number;
  /** The first thing a ray from the camera hits there is this object. */
  visible: boolean;
  pos: Vec3;
  held: boolean;
}

export interface WorldSceneApi {
  enterVr(): Promise<void>;
  exitVr(): void;
  presenting(): boolean;
  /** The sparkles at these objects (or in front of you). */
  celebrate(objectIds: readonly string[]): void;
  /** Everything back where it started. */
  resetObjects(): void;
  /** Where an object is now. */
  objectPosition(id: string): Vec3 | null;
  head(): Vec3;
  /** Dev builds / e2e: tap targets of every panel, objects on screen, and moving an object by hand. */
  targets(): DebugTarget[];
  objects(): WorldDebugObject[];
  place(id: string, at: Vec3): void;
  /** Dev builds / e2e: where the floor at a point is on screen. */
  screenOf(p: Vec3): { x: number; y: number } | null;
  /** Dev builds / e2e: where the headset's play space sits in the world. */
  rig(): Rig;
}

export interface WorldSceneProps {
  def: WorldDefinition;
  states: Readonly<Record<string, Record<string, string>>>;
  /** Object ids whose word he knows (✓ on the label). */
  known: ReadonlySet<string>;
  hint: readonly string[];
  hud: UiNode[];
  inspect: { id: string; nodes: UiNode[] } | null;
  explorer: { nodes: UiNode[] } | null;
  seated: boolean;
  sound: SoundEngine;
  walk: MutableRefObject<WalkInput>;
  apiRef: MutableRefObject<WorldSceneApi | null>;
  onTick(snap: WorldSnapshot, events: WorldEvent[]): void;
  onInspect(id: string, source: string): void;
  onHudAction(action: string, source: string): void;
  onInspectAction(action: string, source: string): void;
  onExplorerAction(action: string, source: string): void;
  onPresentingChange(presenting: boolean): void;
}

const v1 = new Vector3();
const v2 = new Vector3();
const q1 = new Quaternion();

function SceneContent(props: WorldSceneProps) {
  const { def } = props;
  const { gl, camera, scene } = useThree();
  const { world, rapier } = useRapier();
  const hub = useMemo(() => new InteractionHub(), []);
  const live = useMemo(() => new LiveObjects(def.objects), [def]);
  const latest = useRef(props);
  latest.current = props;
  const xrApi = useRef<WorldXrInputApi | null>(null);
  const flatRig = useRef<FlatRig>({ x: def.spawn.at[0], z: def.spawn.at[2], yaw: def.spawn.yaw, pitch: -0.32 });
  const rig = useRef<Rig>({ x: def.spawn.at[0], y: 0, z: def.spawn.at[2], yaw: def.spawn.yaw });
  const baseRef = useRef<XRReferenceSpace | null>(null);
  const floorY = useRef(0);
  const placeAfterFrames = useRef(-1);
  const burst = useRef<((at: Vector3) => void) | null>(null);
  const hovered = useRef(new Map<string, string>());
  const [hoverId, setHoverId] = useState<string | null>(null);

  const head = useCallback((): Vec3 => {
    if (gl.xr.isPresenting) {
      const c = gl.xr.getCamera();
      c.getWorldPosition(v1);
      return [v1.x, v1.y, v1.z];
    }
    return [camera.position.x, camera.position.y, camera.position.z];
  }, [gl, camera]);

  const grabber = useMemo(() => new Grabber(live, hub, {
    mode: (source) => (source === FLAT_SOURCE ? 'flat' : 'xr'),
    sourceQuat: (source, out) => {
      if (source === FLAT_SOURCE) return out.setFromAxisAngle(v2.set(0, 1, 0), flatRig.current.yaw);
      return xrApi.current?.quat(source, out) ?? out.identity();
    },
    forward: (out) => {
      if (gl.xr.isPresenting) return gl.xr.getCamera().getWorldDirection(out);
      return camera.getWorldDirection(out);
    },
    onClick: (id, source) => latest.current.onInspect(id, source),
    surfaceUnder: (ray, exclude) => {
      const r = new rapier.Ray({ x: ray.origin.x, y: ray.origin.y, z: ray.origin.z }, { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z });
      const hit = world.castRayAndGetNormal(r, 6, true, undefined, undefined, undefined, exclude);
      if (!hit) return null;
      const d = hit.timeOfImpact;
      return { point: ray.origin.clone().addScaledVector(ray.direction, d), normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z), distance: d };
    },
  }, props.sound), [live, hub, gl, camera, props.sound, world, rapier]);

  // Sound: the listener rides on the camera, voices live in the scene.
  useEffect(() => {
    props.sound.attach(camera, scene);
    props.sound.mutedUntil = performance.now() + 1500;
  }, [camera, scene, props.sound]);

  // ── the headset: the rig follows through an offset reference space ──
  const applyRig = useCallback(() => {
    const base = baseRef.current;
    if (!base || !gl.xr.isPresenting) return;
    const t = rigOffsetTransform(rig.current);
    const XRT = (window as unknown as { XRRigidTransform?: typeof XRRigidTransform }).XRRigidTransform;
    if (!XRT) return;
    const transform = new XRT(
      { x: t.position[0], y: t.position[1], z: t.position[2] },
      { x: t.orientation[0], y: t.orientation[1], z: t.orientation[2], w: t.orientation[3] },
    );
    gl.xr.setReferenceSpace(base.getOffsetReferenceSpace(transform));
  }, [gl]);

  const headLocal = useCallback((): Vec3 => worldToRig(rig.current, head()), [head]);

  const teleport = useCallback((p: Vec3) => {
    rig.current = teleportRig(rig.current, headLocal(), p);
    applyRig();
    props.sound.play('teleport', null, 0.5);
  }, [applyRig, headLocal, props.sound]);

  const snapTurn = useCallback((delta: number) => {
    rig.current = snapTurnRig(rig.current, headLocal(), delta);
    applyRig();
    props.sound.play('click', null, 0.4);
  }, [applyRig, headLocal, props.sound]);

  useEffect(() => {
    const onStart = () => {
      baseRef.current = gl.xr.getReferenceSpace();
      // Start where the flat camera stood, facing the same way (head placed after the first frames).
      rig.current = { x: flatRig.current.x, y: floorY.current, z: flatRig.current.z, yaw: flatRig.current.yaw };
      applyRig();
      placeAfterFrames.current = 4;
    };
    const onEnd = () => {
      baseRef.current = null;
      grabber.dropAll();
      latest.current.onPresentingChange(false);
    };
    gl.xr.addEventListener('sessionstart', onStart);
    gl.xr.addEventListener('sessionend', onEnd);
    return () => {
      gl.xr.removeEventListener('sessionstart', onStart);
      gl.xr.removeEventListener('sessionend', onEnd);
    };
  }, [gl, applyRig, grabber]);

  // Seated: lift the world view so the eyes are at standing height.
  const seatedLift = useRef(0);
  useEffect(() => {
    if (!gl.xr.isPresenting) return;
    const h = headLocal();
    const lift = props.seated ? Math.max(0, 1.55 - (h[1] - seatedLift.current)) : 0;
    rig.current = { ...rig.current, y: floorY.current + lift };
    seatedLift.current = lift;
    applyRig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seated]);

  const resetObjects = useCallback(() => {
    grabber.dropAll();
    for (const o of live.all()) {
      const b = o.body;
      if (!b || o.def.mass <= 0) continue;
      const yaw = o.def.yaw ?? 0;
      b.setTranslation({ x: o.def.at[0], y: o.def.at[1], z: o.def.at[2] }, true);
      b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    props.sound.mutedUntil = performance.now() + 800;
  }, [grabber, live, props.sound]);

  useEffect(() => {
    props.apiRef.current = {
      enterVr: async () => {
        const xr = navigator.xr;
        if (!xr) throw new Error('WebXR is not available in this browser');
        const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
        let floor = true;
        try {
          await session.requestReferenceSpace('local-floor');
        } catch {
          floor = false;
        }
        gl.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
        // Without a floor the headset's origin is at the eyes: lift the rig by a standing eye height.
        floorY.current = floor ? 0 : EYE_HEIGHT;
        await gl.xr.setSession(session);
      },
      exitVr: () => void gl.xr.getSession()?.end().catch(() => undefined),
      presenting: () => gl.xr.isPresenting,
      celebrate: (ids) => {
        const at = ids.length > 0 ? live.position(ids[0], new Vector3()) : null;
        if (at) at.y += 0.12;
        const p = at ?? (() => {
          const h = head();
          const f = (gl.xr.isPresenting ? gl.xr.getCamera() : camera).getWorldDirection(new Vector3());
          return new Vector3(h[0] + f.x * 0.8, h[1] - 0.2, h[2] + f.z * 0.8);
        })();
        burst.current?.(p);
      },
      resetObjects,
      objectPosition: (id) => (live.get(id) ? (live.position(id, new Vector3()).toArray() as Vec3) : null),
      head,
      targets: () => debugTargets(camera, gl.domElement, (ray) => hub.raycast(ray)?.object ?? null),
      objects: () => {
        const rect = gl.domElement.getBoundingClientRect();
        camera.updateMatrixWorld();
        const eye = new Vector3().setFromMatrixPosition(camera.matrixWorld);
        return live.all().map((o) => {
          const p = live.position(o.def.id, new Vector3());
          const c = localBounds(o.def);
          const centre = p.clone().add(new Vector3((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2));
          const ndc = centre.clone().project(camera);
          const hit = hub.raycast(new Ray(eye, centre.clone().sub(eye).normalize()));
          const visible = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1 && !!hit && live.idOfProxy(hit.object) === o.def.id;
          return { id: o.def.id, x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, visible, pos: p.toArray() as Vec3, held: o.heldBy !== null };
        });
      },
      place: (id, at) => {
        const b = live.get(id)?.body;
        if (!b) return;
        b.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
      rig: () => ({ ...rig.current }),
      screenOf: (p) => {
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new Vector3(...p).project(camera);
        if (ndc.z > 1) return null;
        return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
      },
    };
    return () => { props.apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, hub, live, head, resetObjects]);

  // ── per frame: holds, velocities, ticks, respawns, panel placement ──
  const lastTick = useRef(0);
  const lastRespawnCheck = useRef(0);
  const hudRef = useRef<Group>(null);
  const inspectRef = useRef<Group>(null);
  const explorerRef = useRef<Group>(null);
  const labelRef = useRef<Group>(null);
  const bodyHud = useRef<{ yaw: number; pos: Vector3 } | null>(null);
  const [inspectH, setInspectH] = useState(0.2);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    grabber.update(dt, dtRaw);
    live.trackVelocities();
    const now = performance.now();

    if (placeAfterFrames.current > 0 && gl.xr.isPresenting) {
      placeAfterFrames.current -= 1;
      if (placeAfterFrames.current === 0) {
        placeAfterFrames.current = -1;
        rig.current = teleportRig(rig.current, headLocal(), [flatRig.current.x, 0, flatRig.current.z]);
        applyRig();
        latest.current.onPresentingChange(true);
      }
    }

    if (now - lastTick.current >= TICK_MS) {
      lastTick.current = now;
      latest.current.onTick(live.snapshot(now, head(), latest.current.states), grabber.takeEvents());
    }

    // Something fell out of the world: back where it started.
    if (now - lastRespawnCheck.current > 1000) {
      lastRespawnCheck.current = now;
      const b = def.bounds;
      for (const o of live.all()) {
        if (!o.body || o.def.mass <= 0 || o.heldBy) continue;
        const p = o.body.translation();
        if (p.y < -1 || p.x < b.min[0] - 1 || p.x > b.max[0] + 1 || p.z < b.min[2] - 1 || p.z > b.max[2] + 1) {
          o.body.setTranslation({ x: o.def.at[0], y: o.def.at[1] + 0.05, z: o.def.at[2] }, true);
          o.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }

    const presenting = gl.xr.isPresenting;
    const viewCam = (presenting ? gl.xr.getCamera() : camera) as PerspectiveCamera;
    const h = head();
    const headV = new Vector3(h[0], h[1], h[2]);

    // The task panel: on the left wrist in the headset (else body-locked low on the left), the top-left corner of the flat view.
    const hud = hudRef.current;
    if (hud) {
      const grip = presenting ? xrApi.current?.leftGrip() ?? null : null;
      if (grip) {
        grip.updateMatrixWorld();
        grip.getWorldPosition(v1);
        grip.getWorldQuaternion(q1);
        hud.quaternion.copy(q1).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -1.05));
        v2.set(0, 0.03, -0.03).applyQuaternion(q1);
        hud.position.copy(v1).add(v2);
        hud.scale.setScalar(0.5);
        bodyHud.current = null;
      } else if (presenting) {
        const yaw = Math.atan2(-viewCam.getWorldDirection(v2).x, -v2.z);
        const cur = bodyHud.current;
        let d = cur ? yaw - cur.yaw : 10;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (!cur || Math.abs(d) > 0.9 || cur.pos.distanceTo(headV) > 0.9) {
          bodyHud.current = { yaw, pos: headV.clone() };
        }
        const b = bodyHud.current!;
        const fx = -Math.sin(b.yaw);
        const fz = -Math.cos(b.yaw);
        hud.position.set(b.pos.x + fx * 0.55 + fz * 0.28, b.pos.y - 0.35, b.pos.z + fz * 0.55 - fx * 0.28);
        hud.rotation.set(-0.5, facingYaw({ x: hud.position.x, y: 0, z: hud.position.z }, { x: b.pos.x, y: 0, z: b.pos.z }), 0, 'YXZ');
        hud.scale.setScalar(0.8);
      } else {
        const cam = camera as PerspectiveCamera;
        const d = 0.7;
        const halfH = d * Math.tan((cam.fov * Math.PI) / 360);
        const halfW = halfH * cam.aspect;
        const w = HUD_WIDTH_PX / PX_PER_METRE;
        const s = Math.min(1, ((cam.aspect < 1 ? 0.94 : 0.42) * 2 * halfW) / w);
        hud.quaternion.copy(cam.quaternion);
        // Below the page's top bar (✕, the title, Enter VR): ~64 px of the canvas.
        const below = (2 * halfH * 66) / Math.max(200, gl.domElement.clientHeight);
        v1.set(-halfW + (w * s) / 2 + 0.02 * s, halfH - below, -d).applyQuaternion(cam.quaternion);
        hud.position.copy(cam.position).add(v1);
        hud.scale.setScalar(s);
      }
    }

    // The inspect panel: between you and the object at reading distance, around eye level (a tall
    // fridge's panel isn't up at its top). The flat preview keeps it within ±25° of the view's centre.
    const ins = latest.current.inspect;
    const ip = inspectRef.current;
    if (ins && ip) {
      const o = live.get(ins.id);
      if (o) {
        const p = live.position(ins.id, v1);
        const bnd = localBounds(o.def);
        let yaw = Math.atan2(-(p.x - headV.x), -(p.z - headV.z));
        if (!presenting) {
          const fwd = viewCam.getWorldDirection(v2);
          const camYaw = Math.atan2(-fwd.x, -fwd.z);
          let d = yaw - camYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          yaw = camYaw + Math.max(-0.44, Math.min(0.44, d));
        }
        const dist = Math.hypot(p.x - headV.x, p.z - headV.z);
        const radius = Math.max(bnd.max[0], bnd.max[2], 0.05);
        const reach = Math.max(0.5, Math.min(presenting ? 1.0 : 0.85, dist - radius - 0.1));
        const anchor = new Vector3(headV.x - Math.sin(yaw) * reach, 0, headV.z - Math.cos(yaw) * reach);
        anchor.y = Math.min(headV.y - 0.06, Math.max(headV.y - 0.45, p.y + bnd.max[1] + 0.15));
        if (ip.position.distanceTo(anchor) > 0.6 || ip.userData.forId !== ins.id) ip.position.copy(anchor);
        else ip.position.lerp(anchor, Math.min(1, dt * 6));
        ip.userData.forId = ins.id;
        ip.rotation.set(0, facingYaw({ x: ip.position.x, y: 0, z: ip.position.z }, { x: headV.x, y: 0, z: headV.z }), 0);
        const ex = explorerRef.current;
        if (ex) {
          // Beside it on the right, turned to face you.
          const side = (INSPECT_WIDTH_PX / 2 + 24 + EXPLORER_WIDTH_PX / 2) / PX_PER_METRE;
          ex.position.set(ip.position.x + Math.cos(ip.rotation.y) * side, ip.position.y + inspectH / 2, ip.position.z - Math.sin(ip.rotation.y) * side);
          ex.rotation.set(0, facingYaw({ x: ex.position.x, y: 0, z: ex.position.z }, { x: headV.x, y: 0, z: headV.z }), 0);
          ex.userData.placed = true;
        }
      }
    }
    // The explorer on its own (a word tapped on the task panel): in front of you, placed once.
    const ex = explorerRef.current;
    if (ex) {
      if (!latest.current.explorer) ex.userData.placed = false;
      else if (!ins && !ex.userData.placed) {
        const f = viewCam.getWorldDirection(v2);
        f.y = 0;
        f.normalize();
        ex.position.set(headV.x + f.x * 0.95, headV.y + 0.25, headV.z + f.z * 0.95);
        ex.rotation.set(0, facingYaw({ x: ex.position.x, y: 0, z: ex.position.z }, { x: headV.x, y: 0, z: headV.z }), 0);
        ex.userData.placed = true;
      }
    }

    // The label over what you point at.
    const lab = labelRef.current;
    if (lab && hoverId && hoverId !== ins?.id) {
      const o = live.get(hoverId);
      if (o) {
        const p = live.position(hoverId, v1);
        const bnd = localBounds(o.def);
        lab.position.set(p.x, p.y + bnd.max[1] + 0.09, p.z);
        lab.rotation.set(0, facingYaw({ x: p.x, y: 0, z: p.z }, { x: headV.x, y: 0, z: headV.z }), 0);
        const far = Math.max(0.6, headV.distanceTo(lab.position));
        lab.scale.setScalar(Math.min(2.2, far / 0.9));
      }
    }
  });

  const onHover = useCallback((id: string, source: string, on: boolean) => {
    if (on) hovered.current.set(source, id);
    else if (hovered.current.get(source) === id) hovered.current.delete(source);
    const first = hovered.current.values().next().value ?? null;
    setHoverId(first);
  }, []);

  // Loops tied to states (a running tap).
  useEffect(() => {
    for (const o of def.objects) {
      for (const [when, name] of Object.entries(o.loops ?? {})) {
        const [k, v] = when.split('=');
        const on = (props.states[o.id] ?? {})[k] === v;
        props.sound.loop(`${o.id}:${when}`, on ? name : null, new Vector3(...o.at));
      }
    }
  }, [def, props.states, props.sound]);

  const hintSet = useMemo(() => new Set(props.hint), [props.hint]);
  const hoverDef = hoverId ? def.objects.find((o) => o.id === hoverId) : undefined;
  const labelNodes = useMemo(() => (hoverDef ? hoverLabelNodes(hoverDef.word, props.known.has(hoverDef.id)) : null), [hoverDef, props.known]);
  const Scene = def.Scene;

  return (
    <>
      <WorldLighting preset={def.lighting} shadowArea={def.shadowArea} />
      <Scene />
      {def.objects.map((o) => (
        <WorldObject
          key={o.id}
          def={o}
          states={props.states[o.id] ?? {}}
          live={live}
          hub={hub}
          grabber={grabber}
          sound={props.sound}
          hinted={hintSet.has(o.id)}
          onHover={onHover}
        />
      ))}
      <WorldFlatControls hub={hub} grabber={grabber} rig={flatRig} walk={props.walk} bounds={def.bounds} />
      <WorldXrInput hub={hub} apiRef={xrApi} onTeleport={teleport} onSnapTurn={snapTurn} isHolding={(s) => grabber.isHolding(s)} />
      <Burst trigger={burst} />
      <group ref={hudRef} visible={props.hud.length > 0}>
        <PanelMesh nodes={props.hud} widthPx={HUD_WIDTH_PX} hub={hub} anchor="top" padding={22} background="rgba(20,27,41,0.92)" onAction={props.onHudAction} debugId="hud" overlay renderOrder={22} />
      </group>
      <group ref={inspectRef} visible={!!props.inspect}>
        {props.inspect && (
          <PanelMesh nodes={props.inspect.nodes} widthPx={INSPECT_WIDTH_PX} hub={hub} anchor="center" padding={22} onAction={props.onInspectAction} onHeight={setInspectH} debugId="inspect" overlay renderOrder={21} />
        )}
      </group>
      <group ref={explorerRef} visible={!!props.explorer}>
        {props.explorer && (
          <PanelMesh nodes={props.explorer.nodes} widthPx={EXPLORER_WIDTH_PX} hub={hub} anchor="top" padding={22} maxHeightPx={1100} onAction={props.onExplorerAction} debugId="explorer" overlay renderOrder={21} />
        )}
      </group>
      <group ref={labelRef} visible={!!labelNodes && hoverId !== props.inspect?.id}>
        {labelNodes && <PanelMesh nodes={labelNodes} widthPx={300} hub={hub} anchor="center" padding={10} radius={18} background="rgba(20,27,41,0.85)" overlay interactive={false} />}
      </group>
    </>
  );
}

export function WorldScene(props: WorldSceneProps) {
  return (
    <Canvas
      className="vr-canvas"
      shadows={{ type: PCFShadowMap }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ fov: 70, near: 0.03, far: 120, position: [props.def.spawn.at[0], EYE_HEIGHT, props.def.spawn.at[2]] }}
      onPointerDown={() => props.sound.unlock()}
    >
      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate>
          <SceneContent {...props} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
