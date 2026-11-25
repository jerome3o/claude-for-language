/**
 * The flat preview of a world (any browser without immersive WebXR — and the e2e tests): the mouse /
 * a finger is a ray from the camera through the pointer, fed to the SAME interaction hub as the
 * headset's controllers (docs/VR_WORLDS.md "Controls"):
 *   click a thing — inspect it (its word)        hold on it — pick it up, it follows the pointer
 *   flick + let go — throw                        Space / right-click while holding — throw ahead
 *   wheel while holding — nearer / further        drag empty space / arrows — look around
 *   W A S D — walk (Q / E turn)                   click the floor — walk there
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { Ray, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { WorldSpec } from '@shared/vr-worlds';
import type { InteractionHub } from '../../scene/interaction';
import type { Grabber } from './grabber';
import { blocked, castFloor } from './physicsQuery';

export const FLAT_SOURCE = 'mouse';
export const EYE_HEIGHT = 1.6;
const MAX_PITCH = 1.2;
const WALK_SPEED = 1.7;
const TURN_SPEED = 1.8;

export interface FlatRig {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** On-screen walk buttons (touch): forward / back (−1…1) and turn (−1…1). */
export interface WalkInput {
  forward: number;
  turn: number;
}

export function WorldFlatControls({ hub, grabber, rig, walk, bounds, onWalkTo }: {
  hub: InteractionHub;
  grabber: Grabber;
  rig: MutableRefObject<FlatRig>;
  walk: MutableRefObject<WalkInput>;
  bounds: WorldSpec['bounds'];
  onWalkTo?(): void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const { world, rapier } = useRapier();
  const keys = useRef(new Set<string>());
  const walkTo = useRef<Vector3 | null>(null);
  /** Where the pointer last was (client px): a carried thing follows it while you walk / turn. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const pick = useRef({ raycaster: new Raycaster(), ndc: new Vector2(), ray: new Ray() });

  useEffect(() => {
    const el = gl.domElement;
    const { raycaster, ndc, ray } = pick.current;
    let looking: { x: number; y: number; yaw: number; pitch: number; t: number; moved: number } | null = null;
    let pressed: { x: number; y: number } | null = null;

    const rayAt = (e: { clientX: number; clientY: number }) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      ray.copy(raycaster.ray);
      return ray;
    };
    const startLook = (e: PointerEvent) => {
      looking = { x: e.clientX, y: e.clientY, yaw: rig.current.yaw, pitch: rig.current.pitch, t: performance.now(), moved: 0 };
      el.style.cursor = 'move';
    };

    const onDown = (e: PointerEvent) => {
      if (gl.xr.isPresenting) return;
      if (e.pointerType === 'mouse' && e.button === 2) return; // the context menu throws (below)
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture?.(e.pointerId);
      const onSomething = hub.down(FLAT_SOURCE, rayAt(e));
      if (onSomething) {
        pressed = { x: e.clientX, y: e.clientY };
        el.style.cursor = 'grabbing';
      } else startLook(e);
    };
    const onMove = (e: PointerEvent) => {
      if (gl.xr.isPresenting) return;
      if (looking) {
        const r = el.getBoundingClientRect();
        const k = 2.4 / Math.max(300, r.width);
        looking.moved = Math.max(looking.moved, Math.hypot(e.clientX - looking.x, e.clientY - looking.y));
        rig.current.yaw = looking.yaw + (e.clientX - looking.x) * k;
        rig.current.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, looking.pitch + (e.clientY - looking.y) * k));
        return;
      }
      if (pressed && grabber.pendingFixed(FLAT_SOURCE) && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) {
        // Dragging on furniture looks around (it can't be picked up).
        grabber.cancel(FLAT_SOURCE);
        pressed = null;
        startLook(e);
        return;
      }
      const hit = hub.move(FLAT_SOURCE, rayAt(e));
      if (!pressed) el.style.cursor = hit ? 'pointer' : 'grab';
    };
    const onUp = (e: PointerEvent) => {
      if (gl.xr.isPresenting) return;
      el.releasePointerCapture?.(e.pointerId);
      if (looking) {
        const l = looking;
        looking = null;
        // A click on empty space: walk to the floor there.
        if (l.moved < 6 && performance.now() - l.t < 500) {
          const r = rayAt(e);
          const hit = castFloor(world, rapier, r.origin, r.direction, 30);
          if (hit?.floor) {
            walkTo.current = hit.point.clone();
            onWalkTo?.();
          }
        }
      } else {
        hub.up(FLAT_SOURCE, rayAt(e));
      }
      pressed = null;
      el.style.cursor = 'grab';
    };
    const onLeave = () => {
      if (!grabber.isHolding(FLAT_SOURCE)) hub.leave(FLAT_SOURCE);
      looking = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (gl.xr.isPresenting || !grabber.isHolding(FLAT_SOURCE)) return;
      e.preventDefault();
      grabber.nudgeDistance(FLAT_SOURCE, e.deltaY > 0 ? -0.1 : 0.1);
    };
    const onContext = (e: MouseEvent) => {
      if (grabber.throwHeld(FLAT_SOURCE)) e.preventDefault();
      else e.preventDefault();
    };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (gl.xr.isPresenting || typing(e)) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'f') {
        if (grabber.throwHeld(FLAT_SOURCE)) e.preventDefault();
        return;
      }
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keys.current.add(k);
        walkTo.current = null;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const onBlur = () => keys.current.clear();

    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, camera, hub, grabber, rig, world, rapier, onWalkTo]);

  const fwd = useRef(new Vector3());
  const probe = useRef(new Vector3());
  useFrame((_, dtRaw) => {
    if (gl.xr.isPresenting) return;
    const dt = Math.min(0.05, dtRaw);
    const r = rig.current;
    const k = keys.current;
    let f = walk.current.forward;
    let turn = walk.current.turn;
    let strafe = 0;
    if (k.has('w') || k.has('arrowup')) f += 1;
    if (k.has('s') || k.has('arrowdown')) f -= 1;
    if (k.has('a')) strafe -= 1;
    if (k.has('d')) strafe += 1;
    if (k.has('q') || k.has('arrowleft')) turn += 1;
    if (k.has('e') || k.has('arrowright')) turn -= 1;
    r.yaw += turn * TURN_SPEED * dt;
    // yaw 0 looks down −Z: forward = (−sin, 0, −cos), right = (cos, 0, −sin)
    let mx = (-Math.sin(r.yaw) * f + Math.cos(r.yaw) * strafe) * WALK_SPEED * dt;
    let mz = (-Math.cos(r.yaw) * f - Math.sin(r.yaw) * strafe) * WALK_SPEED * dt;
    const target = walkTo.current;
    if (target && mx === 0 && mz === 0) {
      const dx = target.x - r.x;
      const dz = target.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) walkTo.current = null;
      else {
        const step = Math.min(d, 2.2 * dt);
        mx = (dx / d) * step;
        mz = (dz / d) * step;
      }
    }
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      fwd.current.set(mx / len, 0, mz / len);
      probe.current.set(r.x, 0.6, r.z);
      if (!blocked(world, rapier, probe.current, fwd.current, len + 0.25)) {
        r.x = Math.max(bounds.min[0] + 0.2, Math.min(bounds.max[0] - 0.2, r.x + mx));
        r.z = Math.max(bounds.min[2] + 0.2, Math.min(bounds.max[2] - 0.2, r.z + mz));
      } else walkTo.current = null;
    }
    const cam = camera as PerspectiveCamera;
    // A phone held upright sees as wide as a landscape screen would (~62° across).
    const aspect = cam.aspect || 1.6;
    const vfov = aspect >= 1 ? 66 : Math.min(100, (2 * Math.atan(Math.tan((62 * Math.PI) / 360) / aspect) * 180) / Math.PI);
    if (Math.abs(cam.fov - vfov) > 0.1) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
    cam.position.set(r.x, EYE_HEIGHT, r.z);
    cam.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    const lp = lastPointer.current;
    if (lp && grabber.isHolding(FLAT_SOURCE)) {
      const rect = gl.domElement.getBoundingClientRect();
      const { raycaster, ndc, ray } = pick.current;
      ndc.set(((lp.x - rect.left) / rect.width) * 2 - 1, -((lp.y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, cam);
      ray.copy(raycaster.ray);
      hub.move(FLAT_SOURCE, ray);
    }
  }, -1);

  return null;
}
