/**
 * Controllers and hands in a VR world (docs/VR_WORLDS.md "Controls"). Each input source's ray goes
 * through the same interaction hub as the /vr room (panels, and every object's pick boxes):
 *   trigger / pinch  — press: a quick click inspects; holding (or moving) picks up (grabber.ts)
 *   squeeze / grip   — pick up at once; let go to drop / throw
 *   thumbstick ↑     — aim the teleport arc (green = you can stand there), let go to jump
 *   thumbstick ← →   — snap turn 30°
 * The left controller's grip carries the task panel (WorldScene). Rays, cursors, arc and hand joints
 * are plain meshes — no models downloaded (docs/VR.md "Security model").
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, InstancedMesh, Line, LineBasicMaterial, Matrix4, Mesh,
  MeshBasicMaterial, Object3D, Quaternion, Ray, RingGeometry, SphereGeometry, Vector3, type XRGripSpace, type XRTargetRaySpace,
} from 'three';
import { SNAP_TURN, teleportArc, type Vec3 } from '@shared/vr-worlds';
import type { InteractionHub } from '../../scene/interaction';
import { castFloor } from './physicsQuery';

const MAX_RAY = 6;
const JOINTS = 25;
const ARC_POINTS = 60;

interface Source {
  id: string;
  controller: XRTargetRaySpace;
  grip: XRGripSpace;
  hand: Group;
  input: XRInputSource | null;
  ray: Ray;
  line: Mesh;
  cursor: Mesh;
  joints: InstancedMesh;
  aiming: boolean;
  turnArmed: boolean;
  landing: Vector3 | null;
}

export interface WorldXrInputApi {
  /** A source's world orientation (grabbed things turn with it). */
  quat(source: string, out: Quaternion): Quaternion;
  /** The grip of the left-hand controller (the task panel's mount), else null. */
  leftGrip(): Object3D | null;
}

const FORWARD = new Vector3();
const tmpMatrix = new Matrix4();
const tmpPos = new Vector3();

export function WorldXrInput({ hub, apiRef, onTeleport, onSnapTurn, isHolding }: {
  hub: InteractionHub;
  apiRef: MutableRefObject<WorldXrInputApi | null>;
  onTeleport(point: Vec3): void;
  onSnapTurn(delta: number): void;
  isHolding(source: string): boolean;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { world, rapier } = useRapier();
  const lineGeom = useMemo(() => {
    const g = new CylinderGeometry(0.0015, 0.0015, 1, 6, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -0.5);
    return g;
  }, []);
  const sources = useRef<Source[]>([]);
  const arc = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    const line = new Line(g, new LineBasicMaterial({ color: '#63d394', transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    line.visible = false;
    const ring = new Mesh(new RingGeometry(0.16, 0.22, 32), new MeshBasicMaterial({ color: '#63d394', transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    return { line, ring };
  }, []);

  useEffect(() => {
    const created: Source[] = [];
    const rayMat = new MeshBasicMaterial({ color: new Color('#cfe2ff'), transparent: true, opacity: 0.5, depthWrite: false });
    const cursorMat = new MeshBasicMaterial({ color: new Color('#ffffff'), transparent: true, opacity: 0.9, depthTest: false });
    const jointMat = new MeshBasicMaterial({ color: new Color('#e9eef7'), transparent: true, opacity: 0.75 });
    const cursorGeom = new RingGeometry(0.006, 0.011, 24);
    const jointGeom = new SphereGeometry(0.007, 8, 6);
    const cleanups: Array<() => void> = [];
    scene.add(arc.line, arc.ring);
    for (let i = 0; i < 2; i++) {
      const controller = gl.xr.getController(i);
      const grip = gl.xr.getControllerGrip(i);
      const hand = gl.xr.getHand(i);
      const line = new Mesh(lineGeom, rayMat);
      line.visible = false;
      controller.add(line);
      // A small "hand": a rounded nub on the grip so you can see where your hand is.
      const nub = new Mesh(new SphereGeometry(0.025, 12, 10), new MeshBasicMaterial({ color: '#d8dde6' }));
      grip.add(nub);
      const cursor = new Mesh(cursorGeom, cursorMat);
      cursor.visible = false;
      cursor.renderOrder = 10;
      const joints = new InstancedMesh(jointGeom, jointMat, JOINTS);
      joints.visible = false;
      joints.frustumCulled = false;
      scene.add(controller, grip, hand, cursor, joints);
      const s: Source = { id: `xr${i}`, controller, grip, hand, input: null, ray: new Ray(), line, cursor, joints, aiming: false, turnArmed: true, landing: null };
      const updateRay = () => {
        controller.updateMatrixWorld(true);
        s.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        s.ray.direction.copy(FORWARD.set(0, 0, -1).transformDirection(controller.matrixWorld));
      };
      const onConnected = (e: { data?: XRInputSource }) => {
        const input = e.data ?? null;
        s.input = input && (input.targetRayMode === 'tracked-pointer' || input.targetRayMode === 'transient-pointer') ? input : null;
      };
      const onDisconnected = () => {
        s.input = null;
        hub.leave(s.id);
        line.visible = cursor.visible = joints.visible = false;
      };
      const onSelectStart = () => { if (!s.input || s.aiming) return; updateRay(); hub.down(s.id, s.ray); };
      const onSelectEnd = () => { if (!s.input) return; updateRay(); hub.up(s.id, s.ray); };
      const onSqueezeStart = () => { if (!s.input) return; updateRay(); hub.grab(s.id, s.ray); };
      const onSqueezeEnd = () => hub.release(s.id);
      type Listener = (e: { data?: XRInputSource }) => void;
      const listeners: Array<[string, Listener]> = [
        ['connected', onConnected], ['disconnected', onDisconnected], ['selectstart', onSelectStart],
        ['selectend', onSelectEnd], ['squeezestart', onSqueezeStart], ['squeezeend', onSqueezeEnd],
      ];
      const target = controller as unknown as { addEventListener(t: string, l: Listener): void; removeEventListener(t: string, l: Listener): void };
      for (const [t, l] of listeners) target.addEventListener(t, l);
      cleanups.push(() => {
        for (const [t, l] of listeners) target.removeEventListener(t, l);
        controller.remove(line);
        grip.remove(nub);
        nub.geometry.dispose();
        (nub.material as MeshBasicMaterial).dispose();
        scene.remove(controller, grip, hand, cursor, joints);
      });
      created.push(s);
    }
    sources.current = created;
    apiRef.current = {
      quat: (source, out) => {
        const s = sources.current.find((x) => x.id === source);
        return s ? s.controller.getWorldQuaternion(out) : out.identity();
      },
      leftGrip: () => sources.current.find((x) => x.input?.handedness === 'left')?.grip ?? null,
    };
    return () => {
      cleanups.forEach((c) => c());
      scene.remove(arc.line, arc.ring);
      rayMat.dispose();
      cursorMat.dispose();
      jointMat.dispose();
      cursorGeom.dispose();
      jointGeom.dispose();
      sources.current = [];
      apiRef.current = null;
    };
  }, [gl, scene, hub, lineGeom, arc, apiRef]);

  useFrame(() => {
    const presenting = gl.xr.isPresenting;
    let arcShown = false;
    for (const s of sources.current) {
      if (!presenting || !s.input) {
        s.line.visible = s.cursor.visible = s.joints.visible = false;
        continue;
      }
      s.controller.updateMatrixWorld(true);
      s.ray.origin.setFromMatrixPosition(s.controller.matrixWorld);
      s.ray.direction.copy(FORWARD.set(0, 0, -1).transformDirection(s.controller.matrixWorld));

      // Thumbstick: teleport arc (forward) and snap turn (left / right).
      const axes = s.input.gamepad?.axes ?? [];
      const ax = axes.length >= 4 ? axes[2] : axes[0] ?? 0;
      const ay = axes.length >= 4 ? axes[3] : axes[1] ?? 0;
      if (!s.aiming && ay < -0.65 && Math.abs(ax) < 0.6 && !isHolding(s.id)) s.aiming = true;
      if (s.aiming) {
        if (ay > -0.25) {
          s.aiming = false;
          if (s.landing) onTeleport([s.landing.x, s.landing.y, s.landing.z]);
          s.landing = null;
        } else if (!arcShown) {
          arcShown = true;
          const pts = teleportArc(s.ray.origin.toArray() as Vec3, s.ray.direction.toArray() as Vec3, { maxPoints: ARC_POINTS });
          const attr = arc.line.geometry.getAttribute('position') as BufferAttribute;
          let n = 0;
          let landing: Vector3 | null = null;
          let blocked = false;
          for (let i = 0; i < pts.length; i++) {
            attr.setXYZ(i, pts[i][0], pts[i][1], pts[i][2]);
            n = i + 1;
            if (i === 0) continue;
            const a = new Vector3(...pts[i - 1]);
            const b = new Vector3(...pts[i]);
            const d = b.clone().sub(a);
            const len = d.length();
            const hit = castFloor(world, rapier, a, d.normalize(), len);
            if (hit) {
              attr.setXYZ(i, hit.point.x, hit.point.y, hit.point.z);
              if (hit.floor) landing = hit.point;
              else blocked = true;
              break;
            }
          }
          attr.needsUpdate = true;
          arc.line.geometry.setDrawRange(0, n);
          arc.line.visible = true;
          const ok = !!landing && !blocked;
          (arc.line.material as LineBasicMaterial).color.set(ok ? '#63d394' : '#ff8585');
          s.landing = ok ? landing : null;
          arc.ring.visible = ok;
          if (ok && landing) arc.ring.position.set(landing.x, landing.y + 0.01, landing.z);
        }
      }
      if (s.turnArmed && Math.abs(ax) > 0.75 && Math.abs(ay) < 0.5 && !s.aiming) {
        s.turnArmed = false;
        onSnapTurn(ax > 0 ? -SNAP_TURN : SNAP_TURN);
      } else if (Math.abs(ax) < 0.3) s.turnArmed = true;

      const hit = s.aiming ? null : hub.move(s.id, s.ray);
      const len = hit ? Math.min(hit.distance, MAX_RAY) : 0.8;
      s.line.visible = !s.aiming;
      s.line.scale.set(1, 1, len);
      if (hit && hit.distance <= MAX_RAY) {
        s.cursor.visible = true;
        s.cursor.position.copy(hit.point);
        s.cursor.lookAt(s.ray.origin);
      } else {
        s.cursor.visible = false;
      }
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
    if (!arcShown) {
      arc.line.visible = false;
      arc.ring.visible = false;
    }
  });

  return null;
}
