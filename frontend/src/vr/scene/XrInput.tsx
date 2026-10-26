/**
 * Controllers and tracked hands in the headset (docs/VR.md "Controls"): each input source's
 * target ray drives the interaction hub — trigger / pinch = select (press, click), grip / squeeze
 * = grab a window. Rays and cursors are plain meshes; hands are drawn as small joint spheres. No
 * controller or hand models are downloaded (that would mean a CDN — docs/VR.md "Security model").
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Ray,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type XRTargetRaySpace,
} from 'three';
import type { InteractionHub } from './interaction';

const MAX_RAY = 2.5;
const JOINTS = 25;

interface Source {
  id: string;
  controller: XRTargetRaySpace;
  hand: Group;
  input: XRInputSource | null;
  ray: Ray;
  line: Mesh;
  cursor: Mesh;
  joints: InstancedMesh;
}

const FORWARD = new Vector3();
const tmpMatrix = new Matrix4();
const tmpPos = new Vector3();

export function XrInput({ hub }: { hub: InteractionHub }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const lineGeom = useMemo(() => {
    const g = new CylinderGeometry(0.0015, 0.0015, 1, 6, 1, true);
    g.rotateX(Math.PI / 2); // along Z
    g.translate(0, 0, -0.5); // from the controller forward
    return g;
  }, []);
  const sources = useRef<Source[]>([]);

  useEffect(() => {
    const created: Source[] = [];
    const rayMat = new MeshBasicMaterial({ color: new Color('#cfe2ff'), transparent: true, opacity: 0.55, depthWrite: false });
    const cursorMat = new MeshBasicMaterial({ color: new Color('#ffffff'), transparent: true, opacity: 0.9, depthTest: false });
    const jointMat = new MeshBasicMaterial({ color: new Color('#e9eef7'), transparent: true, opacity: 0.75 });
    const cursorGeom = new RingGeometry(0.005, 0.009, 24);
    const jointGeom = new SphereGeometry(0.006, 8, 6);
    const cleanups: Array<() => void> = [];
    for (let i = 0; i < 2; i++) {
      const controller = gl.xr.getController(i);
      const hand = gl.xr.getHand(i);
      const line = new Mesh(lineGeom, rayMat);
      line.visible = false;
      controller.add(line);
      const cursor = new Mesh(cursorGeom, cursorMat);
      cursor.visible = false;
      cursor.renderOrder = 10;
      const joints = new InstancedMesh(jointGeom, jointMat, JOINTS);
      joints.visible = false;
      joints.frustumCulled = false;
      scene.add(controller, hand, cursor, joints);
      const s: Source = { id: `xr${i}`, controller, hand, input: null, ray: new Ray(), line, cursor, joints };
      const updateRay = () => {
        controller.updateMatrixWorld(true);
        s.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        s.ray.direction.copy(FORWARD.set(0, 0, -1).transformDirection(controller.matrixWorld));
      };
      const onConnected = (e: { data?: XRInputSource }) => {
        const input = e.data ?? null;
        // Gaze / screen taps have no ray to point with; tracked pointers and hands do.
        s.input = input && (input.targetRayMode === 'tracked-pointer' || input.targetRayMode === 'transient-pointer') ? input : null;
      };
      const onDisconnected = () => {
        s.input = null;
        hub.leave(s.id);
        line.visible = cursor.visible = joints.visible = false;
      };
      const onSelectStart = () => { if (!s.input) return; updateRay(); hub.down(s.id, s.ray); };
      const onSelectEnd = () => { if (!s.input) return; updateRay(); hub.up(s.id, s.ray); };
      const onSqueezeStart = () => { if (!s.input) return; updateRay(); hub.grab(s.id, s.ray); };
      const onSqueezeEnd = () => hub.release(s.id);
      type Listener = (e: { data?: XRInputSource }) => void;
      const listeners: Array<[string, Listener]> = [
        ['connected', onConnected],
        ['disconnected', onDisconnected],
        ['selectstart', onSelectStart],
        ['selectend', onSelectEnd],
        ['squeezestart', onSqueezeStart],
        ['squeezeend', onSqueezeEnd],
      ];
      const target = controller as unknown as { addEventListener(t: string, l: Listener): void; removeEventListener(t: string, l: Listener): void };
      for (const [t, l] of listeners) target.addEventListener(t, l);
      cleanups.push(() => {
        for (const [t, l] of listeners) target.removeEventListener(t, l);
        controller.remove(line);
        scene.remove(controller, hand, cursor, joints);
      });
      created.push(s);
    }
    sources.current = created;
    return () => {
      cleanups.forEach((c) => c());
      rayMat.dispose();
      cursorMat.dispose();
      jointMat.dispose();
      cursorGeom.dispose();
      jointGeom.dispose();
      sources.current = [];
    };
  }, [gl, scene, hub, lineGeom]);

  useFrame(() => {
    const presenting = gl.xr.isPresenting;
    for (const s of sources.current) {
      if (!presenting || !s.input) {
        s.line.visible = s.cursor.visible = s.joints.visible = false;
        continue;
      }
      s.controller.updateMatrixWorld(true);
      s.ray.origin.setFromMatrixPosition(s.controller.matrixWorld);
      s.ray.direction.copy(FORWARD.set(0, 0, -1).transformDirection(s.controller.matrixWorld));
      const hit = hub.move(s.id, s.ray);
      const len = hit ? Math.min(hit.distance, MAX_RAY) : MAX_RAY * 0.4;
      s.line.visible = true;
      s.line.scale.set(1, 1, len);
      if (hit && hit.distance <= MAX_RAY) {
        s.cursor.visible = true;
        s.cursor.position.copy(hit.point);
        // face the ray's origin
        s.cursor.lookAt(s.ray.origin);
      } else {
        s.cursor.visible = false;
      }
      // tracked hand: joint spheres
      const joints = (s.hand as unknown as { joints?: Record<string, Object3D> }).joints;
      const list = joints ? Object.values(joints) : [];
      if (s.input.hand && list.length > 0) {
        let n = 0;
        for (const j of list) {
          if (n >= JOINTS) break;
          if (!j.visible) continue;
          j.updateMatrixWorld(true);
          tmpPos.setFromMatrixPosition(j.matrixWorld);
          tmpMatrix.makeTranslation(tmpPos.x, tmpPos.y, tmpPos.z);
          s.joints.setMatrixAt(n++, tmpMatrix);
        }
        s.joints.count = n;
        s.joints.instanceMatrix.needsUpdate = true;
        s.joints.visible = n > 0;
      } else {
        s.joints.visible = false;
      }
    }
  });

  return null;
}
