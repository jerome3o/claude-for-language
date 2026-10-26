/**
 * The 3D room (docs/VR.md): the environment, the windows, the tray and the input — the headset's
 * controllers / hands when presenting, the mouse otherwise. Everything it shows comes in as
 * props (window views are plain UI nodes built on the page side), and everything the learner
 * does goes back out as callbacks; the scene itself holds no app data.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Quaternion, Vector3, WebGLRenderTarget, type Group } from 'three';
import { bearingFrom, headYawFromForward, trayPose, VR_DEFAULT_EYE_HEIGHT, type VrPose } from '@shared/vr';
import type { HeadPose, VrWindow } from '../windowStore';
import type { UiNode } from '../ui/layout';
import type { PanelImage } from '../ui/draw';
import { Environment } from './Environment';
import { FlatControls } from './FlatControls';
import { InteractionHub } from './interaction';
import { PanelMesh } from './PanelMesh';
import { WindowFrame, type PanelView } from './WindowFrame';
import { XrInput } from './XrInput';
import { debugTargets, type DebugTarget } from './debug';

export interface VrSceneApi {
  /** Starts the immersive session (call from a click: browsers need the user's gesture). */
  enterVr(): Promise<void>;
  exitVr(): void;
  presenting(): boolean;
  /** A picture of what the learner sees (the feedback screenshot), JPEG. */
  capture(): Promise<Blob | null>;
  head(): HeadPose;
  /** Dev builds: where each tap target is on screen (e2e). */
  targets(): DebugTarget[];
}

export interface VrSceneProps {
  windows: VrWindow[];
  focusedId: string | null;
  views: Readonly<Record<string, PanelView>>;
  images: ReadonlyMap<string, PanelImage>;
  tray: UiNode[];
  caption: UiNode[] | null;
  apiRef: MutableRefObject<VrSceneApi | null>;
  onWindowAction(id: string, action: string, source: string): void;
  onClose(id: string): void;
  onFocus(id: string): void;
  onMove(id: string, pose: VrPose): void;
  onFront(id: string): void;
  onTrayAction(action: string, source: string): void;
  /** A session started (with the real head pose) or ended. */
  onPresentingChange(presenting: boolean): void;
}

const TRAY_WIDTH_PX = 880;
const TRAY_TILT = -0.85;
const FOLLOW_AFTER_MS = 1500;
const FOLLOW_ANGLE = (55 * Math.PI) / 180;

/** sRGB encoding for the XR screenshot (render targets hold linear colour). */
const SRGB_LUT = (() => {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    lut[i] = Math.round(s * 255);
  }
  return lut;
})();

function SceneContent(props: VrSceneProps & { worldOffset: MutableRefObject<number> }) {
  const { gl, scene, camera } = useThree();
  const hub = useMemo(() => new InteractionHub(), []);
  const worldRef = useRef<Group>(null);
  const trayRef = useRef<Group>(null);
  const captionRef = useRef<Group>(null);
  const trayPoseRef = useRef<VrPose>(trayPose({ x: 0, y: VR_DEFAULT_EYE_HEIGHT, z: 0 }, 0));
  const awaySince = useRef<number | null>(null);
  const captureRequest = useRef<((b: Blob | null) => void) | null>(null);
  const placeAfterFrames = useRef(-1);
  const latest = useRef(props);
  latest.current = props;
  const turnRef = useRef<((yaw: number) => void) | null>(null);
  const stepBackRef = useRef(0);

  const head = (): HeadPose => {
    const pos = new Vector3();
    camera.getWorldPosition(pos);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new Quaternion()));
    // Flat preview: the camera stands a step behind the spot windows are placed around.
    if (!gl.xr.isPresenting) pos.addScaledVector(fwd, stepBackRef.current);
    return { position: { x: pos.x, y: pos.y - props.worldOffset.current, z: pos.z }, yaw: headYawFromForward(fwd) };
  };
  const toRoom = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.y - props.worldOffset.current, z: p.z });

  const placeTray = (h: HeadPose) => {
    // Seen from a step back (flat preview) the desk sits a little lower so it never hides a window.
    const p = trayPose(h.position, h.yaw, gl.xr.isPresenting ? undefined : 0.62);
    trayPoseRef.current = p;
    const g = trayRef.current;
    if (g) {
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(TRAY_TILT, p.yaw, 0, 'YXZ');
    }
    const c = captionRef.current;
    if (c) {
      c.position.set(p.x - 0.12 * Math.sin(p.yaw), p.y + 0.2, p.z - 0.12 * Math.cos(p.yaw));
      c.rotation.set(-0.25, p.yaw, 0, 'YXZ');
    }
  };

  useEffect(() => {
    placeTray(head());
    const onStart = () => {
      placeAfterFrames.current = 3; // the head pose arrives with the first frames
    };
    const onEnd = () => {
      props.worldOffset.current = 0;
      if (worldRef.current) worldRef.current.position.y = 0;
      latest.current.onPresentingChange(false);
      requestAnimationFrame(() => placeTray(head()));
    };
    gl.xr.addEventListener('sessionstart', onStart);
    gl.xr.addEventListener('sessionend', onEnd);
    return () => {
      gl.xr.removeEventListener('sessionstart', onStart);
      gl.xr.removeEventListener('sessionend', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  const capture = (): Promise<Blob | null> => {
    if (!gl.xr.isPresenting) {
      // Flat: render now and copy the canvas in the same task (the buffer is still there).
      try {
        gl.render(scene, camera);
        return new Promise((resolve) => gl.domElement.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
      } catch {
        return Promise.resolve(null);
      }
    }
    return new Promise((resolve) => {
      captureRequest.current?.(null);
      captureRequest.current = resolve;
    });
  };

  const captureXr = (): Blob | null | Promise<Blob | null> => {
    const w = 1280;
    const h = 800;
    const rt = new WebGLRenderTarget(w, h);
    const cam = new PerspectiveCamera(70, w / h, 0.05, 200);
    camera.getWorldPosition(cam.position);
    camera.getWorldQuaternion(cam.quaternion);
    cam.updateMatrixWorld();
    const prevTarget = gl.getRenderTarget();
    const xrEnabled = gl.xr.enabled;
    const pixels = new Uint8Array(w * h * 4);
    try {
      gl.xr.enabled = false;
      gl.setRenderTarget(rt);
      gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
    } catch {
      return null;
    } finally {
      gl.setRenderTarget(prevTarget);
      gl.xr.enabled = xrEnabled;
      rt.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        img.data[dst + x] = SRGB_LUT[pixels[src + x]];
        img.data[dst + x + 1] = SRGB_LUT[pixels[src + x + 1]];
        img.data[dst + x + 2] = SRGB_LUT[pixels[src + x + 2]];
        img.data[dst + x + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
  };

  useEffect(() => {
    props.apiRef.current = {
      enterVr: async () => {
        const xr = navigator.xr;
        if (!xr) throw new Error('WebXR is not available in this browser');
        const session = await xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });
        // local-floor puts the floor at y = 0; without it ('local', eyes at y = 0) the room is
        // lowered by a standing eye height so the floor is still under your feet.
        let floor = true;
        try {
          await session.requestReferenceSpace('local-floor');
        } catch {
          floor = false;
        }
        gl.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
        props.worldOffset.current = floor ? 0 : -VR_DEFAULT_EYE_HEIGHT;
        if (worldRef.current) worldRef.current.position.y = props.worldOffset.current;
        await gl.xr.setSession(session);
      },
      exitVr: () => {
        void gl.xr.getSession()?.end().catch(() => {});
      },
      presenting: () => gl.xr.isPresenting,
      capture,
      head,
      targets: () => debugTargets(camera, gl.domElement, (ray) => hub.raycast(ray)?.object ?? null),
    };
    return () => {
      props.apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, scene]);

  useFrame(() => {
    if (captureRequest.current && gl.xr.isPresenting) {
      const resolve = captureRequest.current;
      captureRequest.current = null;
      void Promise.resolve(captureXr()).then(resolve, () => resolve(null));
    }
    if (placeAfterFrames.current > 0) {
      placeAfterFrames.current -= 1;
      if (placeAfterFrames.current === 0) {
        placeAfterFrames.current = -1;
        placeTray(head());
        latest.current.onPresentingChange(true);
      }
    }
    // The tray follows lazily when you have turned well away from it for a moment (headset);
    // in the flat preview it simply stays at the bottom of the view.
    if (!gl.xr.isPresenting) {
      const h = head();
      if (Math.abs(h.yaw - trayPoseRef.current.yaw) > 1e-3) placeTray(h);
    } else {
      const h = head();
      let d = h.yaw - trayPoseRef.current.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > FOLLOW_ANGLE) {
        const now = performance.now();
        if (awaySince.current === null) awaySince.current = now;
        else if (now - awaySince.current > FOLLOW_AFTER_MS) {
          awaySince.current = null;
          placeTray(h);
        }
      } else {
        awaySince.current = null;
      }
    }
  });

  // Flat preview: a window that just opened (or was asked for again) turns the view to it.
  const knownIds = useRef<Set<string>>(new Set(props.windows.map((w) => w.id)));
  const lastFocus = useRef(props.focusedId);
  useEffect(() => {
    const fresh = props.windows.find((w) => !knownIds.current.has(w.id));
    knownIds.current = new Set(props.windows.map((w) => w.id));
    const target = fresh ?? (props.focusedId !== lastFocus.current ? props.windows.find((w) => w.id === props.focusedId) : undefined);
    lastFocus.current = props.focusedId;
    if (target && !gl.xr.isPresenting) turnRef.current?.(bearingFrom(head().position, target.pose));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.windows, props.focusedId]);

  const getHead = () => head();
  return (
    <>
      <XrInput hub={hub} />
      <FlatControls hub={hub} eyeHeight={VR_DEFAULT_EYE_HEIGHT} turnRef={turnRef} stepBackRef={stepBackRef} />
      <group ref={worldRef}>
        <Environment />
        {props.windows.map((w) => (
          <WindowFrame
            key={w.id}
            win={w}
            view={props.views[w.id]}
            focused={w.id === props.focusedId}
            hub={hub}
            images={props.images}
            getHead={getHead}
            toRoom={toRoom}
            onAction={props.onWindowAction}
            onClose={props.onClose}
            onFocus={props.onFocus}
            onMove={props.onMove}
            onFront={props.onFront}
          />
        ))}
        <group ref={trayRef}>
          <PanelMesh
            nodes={props.tray}
            widthPx={TRAY_WIDTH_PX}
            hub={hub}
            anchor="center"
            padding={20}
            background="#1f2738"
            onAction={(a, s) => props.onTrayAction(a, s)}
            debugId="tray"
          />
        </group>
        <group ref={captionRef} visible={!!props.caption}>
          {props.caption && <PanelMesh nodes={props.caption} widthPx={700} hub={hub} anchor="center" padding={20} background="#13213a" debugId="caption" />}
        </group>
      </group>
    </>
  );
}

export function VrScene(props: VrSceneProps) {
  const worldOffset = useRef(0);
  return (
    <Canvas
      className="vr-canvas"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ fov: 62, near: 0.03, far: 300, position: [0, VR_DEFAULT_EYE_HEIGHT, 0] }}
      onCreated={({ gl }) => {
        gl.setClearColor('#cfc8bd');
      }}
    >
      <SceneContent {...props} worldOffset={worldOffset} />
    </Canvas>
  );
}
