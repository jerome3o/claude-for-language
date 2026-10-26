/**
 * Test hooks for the flat preview (dev builds only — e2e/tests/vr.spec.ts, screenshots): where
 * every tap target of every panel is on the screen, so a test clicks real canvas pixels and goes
 * through the same raycast + hit-test path as a controller. Never installed in production builds.
 */
import { Ray, Vector3, type Camera, type Mesh, type Object3D } from 'three';
import type { UiLayout } from '../ui/layout';

interface DebugPanel {
  mesh: Mesh;
  layout: () => UiLayout | null;
  widthPx: number;
}

const panels = new Map<string, DebugPanel>();

export function registerDebugPanel(id: string, panel: DebugPanel): () => void {
  if (!import.meta.env.DEV) return () => {};
  panels.set(id, panel);
  return () => {
    if (panels.get(id) === panel) panels.delete(id);
  };
}

export interface DebugTarget {
  panel: string;
  action: string;
  /** Client (page) pixel coordinates of the target's centre. */
  x: number;
  y: number;
  /** Nothing in front of it (a click there reaches it). */
  visible: boolean;
  /** The centre in the room (metres) — an emulated controller aims at it. */
  world: [number, number, number];
}

export function debugTargets(camera: Camera, canvas: HTMLCanvasElement, firstHit: (ray: Ray) => Object3D | null): DebugTarget[] {
  const rect = canvas.getBoundingClientRect();
  const out: DebugTarget[] = [];
  camera.updateMatrixWorld();
  for (const [id, p] of panels) {
    const layout = p.layout();
    if (!layout) continue;
    p.mesh.updateWorldMatrix(true, false);
    for (const h of layout.hits) {
      const cx = (h.x + h.w / 2) / p.widthPx - 0.5;
      const cy = 0.5 - (h.y + h.h / 2) / layout.height;
      const world = p.mesh.localToWorld(new Vector3(cx, cy, 0));
      const v = world.clone().project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const eye = new Vector3().setFromMatrixPosition(camera.matrixWorld);
      const visible = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && firstHit(new Ray(eye, world.clone().sub(eye).normalize())) === p.mesh;
      out.push({ panel: id, action: h.action, x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible, world: [world.x, world.y, world.z] });
    }
  }
  return out;
}
