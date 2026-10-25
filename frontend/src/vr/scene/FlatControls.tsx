/**
 * The flat preview's input (any browser without immersive WebXR): the mouse / a finger is a ray
 * from the camera through the pointer, fed to the same interaction hub as the headset's
 * controllers. Dragging empty space (or the arrow keys) looks around; nothing ever moves you.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Ray, Raycaster, Vector2, type PerspectiveCamera } from 'three';
import type { InteractionHub } from './interaction';

const SOURCE = 'mouse';
const MAX_PITCH = 1.1;

export function FlatControls({ hub, eyeHeight, turnRef }: {
  hub: InteractionHub;
  eyeHeight: number;
  /** Set here: turns the flat camera to a yaw (a window that just opened out of view). */
  turnRef: MutableRefObject<((yaw: number) => void) | null>;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const look = useRef({ yaw: 0, pitch: -0.3 });

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const ray = new Ray();
    let looking: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let pressedOnObject = false;

    const apply = () => {
      if (gl.xr.isPresenting) return;
      // A phone held upright sees as much width as a landscape screen: ~56° across.
      const persp = camera as PerspectiveCamera;
      if (persp.isPerspectiveCamera) {
        const r = el.getBoundingClientRect();
        const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 1.6;
        const hfov = (56 * Math.PI) / 180;
        const vfov = Math.min(100, Math.max(60, (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI));
        if (Math.abs(persp.fov - vfov) > 0.1) {
          persp.fov = vfov;
          persp.updateProjectionMatrix();
        }
      }
      camera.position.set(0, eyeHeight, 0);
      camera.rotation.set(look.current.pitch, look.current.yaw, 0, 'YXZ');
      camera.updateMatrixWorld();
    };
    apply();

    const rayAt = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      ray.copy(raycaster.ray);
      return ray;
    };

    const onDown = (e: PointerEvent) => {
      if (gl.xr.isPresenting || (e.pointerType === 'mouse' && e.button !== 0)) return;
      el.setPointerCapture?.(e.pointerId);
      pressedOnObject = hub.down(SOURCE, rayAt(e));
      if (!pressedOnObject) looking = { x: e.clientX, y: e.clientY, yaw: look.current.yaw, pitch: look.current.pitch };
      el.style.cursor = pressedOnObject ? 'grabbing' : 'move';
    };
    const onMove = (e: PointerEvent) => {
      if (gl.xr.isPresenting) return;
      if (looking) {
        const r = el.getBoundingClientRect();
        const k = 2.2 / Math.max(300, r.width);
        look.current.yaw = looking.yaw + (e.clientX - looking.x) * k;
        look.current.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, looking.pitch + (e.clientY - looking.y) * k));
        apply();
        return;
      }
      const hit = hub.move(SOURCE, rayAt(e));
      if (!pressedOnObject) el.style.cursor = hit ? 'pointer' : 'grab';
    };
    const onUp = (e: PointerEvent) => {
      if (gl.xr.isPresenting) return;
      el.releasePointerCapture?.(e.pointerId);
      if (looking) {
        looking = null;
      } else {
        hub.up(SOURCE, rayAt(e));
      }
      pressedOnObject = false;
      el.style.cursor = 'grab';
    };
    const onLeave = () => {
      hub.leave(SOURCE);
      looking = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (gl.xr.isPresenting) return;
      const step = 0.08;
      if (e.key === 'ArrowLeft') look.current.yaw += step;
      else if (e.key === 'ArrowRight') look.current.yaw -= step;
      else if (e.key === 'ArrowUp') look.current.pitch = Math.min(MAX_PITCH, look.current.pitch + step);
      else if (e.key === 'ArrowDown') look.current.pitch = Math.max(-MAX_PITCH, look.current.pitch - step);
      else return;
      e.preventDefault();
      apply();
    };
    const onSessionEnd = () => {
      // back from the headset: the flat camera again
      requestAnimationFrame(apply);
    };
    // A smooth turn (flat preview only — in the headset nothing ever moves the view).
    let anim = 0;
    turnRef.current = (yaw: number) => {
      if (gl.xr.isPresenting) return;
      cancelAnimationFrame(anim);
      const from = look.current.yaw;
      const delta = Math.atan2(Math.sin(yaw - from), Math.cos(yaw - from));
      if (Math.abs(delta) < 0.35) return; // already in view
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 450);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        look.current.yaw = from + delta * ease;
        apply();
        if (t < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', apply);
    gl.xr.addEventListener('sessionend', onSessionEnd);
    return () => {
      cancelAnimationFrame(anim);
      turnRef.current = null;
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', apply);
      gl.xr.removeEventListener('sessionend', onSessionEnd);
    };
  }, [gl, camera, hub, eyeHeight, turnRef]);

  return null;
}
