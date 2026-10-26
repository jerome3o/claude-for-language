/**
 * One pointer pipeline for every input (docs/VR.md "Controls"): the mouse in the flat preview and
 * each XR controller / tracked hand ray go through the same hub — raycast against the registered
 * interactive meshes, hover, press, click (released on what was pressed), and drags (a window's
 * grab bar, or squeeze / grip anywhere on a window). The flat preview therefore exercises the
 * exact hit-testing the headset uses (e2e/tests/vr.spec.ts).
 */
import { Raycaster, type Object3D, type Ray, type Vector3 } from 'three';

export interface VrHit {
  object: Object3D;
  point: Vector3;
  uv: { x: number; y: number } | null;
  distance: number;
  ray: Ray;
}

export interface Interactive {
  onHover?(hit: VrHit | null, source: string): void;
  onDown?(hit: VrHit, source: string): void;
  /** `click` = released on the object it was pressed on. */
  onUp?(hit: VrHit | null, source: string, click: boolean): void;
  /** Squeeze / grip on it: start a grab (return true when it did). */
  onGrab?(hit: VrHit, source: string): boolean;
}

export interface DragHandler {
  move(ray: Ray): void;
  end(): void;
}

interface SourceState {
  hovered: Object3D | null;
  pressed: Object3D | null;
  drag: DragHandler | null;
  lastHit: VrHit | null;
}

function visibleInScene(obj: Object3D): boolean {
  let o: Object3D | null = obj;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

export class InteractionHub {
  private items = new Map<Object3D, Interactive>();
  private sources = new Map<string, SourceState>();
  private raycaster = new Raycaster();

  register(obj: Object3D, handlers: Interactive): () => void {
    this.items.set(obj, handlers);
    return () => {
      if (this.items.get(obj) === handlers) this.items.delete(obj);
    };
  }

  private source(id: string): SourceState {
    let s = this.sources.get(id);
    if (!s) {
      s = { hovered: null, pressed: null, drag: null, lastHit: null };
      this.sources.set(id, s);
    }
    return s;
  }

  /** The nearest registered, visible object on the ray. */
  raycast(ray: Ray): VrHit | null {
    this.raycaster.ray.copy(ray);
    this.raycaster.far = 50;
    const objects = [...this.items.keys()].filter(visibleInScene);
    const hits = this.raycaster.intersectObjects(objects, false);
    const h = hits[0];
    if (!h) return null;
    return { object: h.object, point: h.point, uv: h.uv ? { x: h.uv.x, y: h.uv.y } : null, distance: h.distance, ray };
  }

  isDragging(sourceId: string): boolean {
    return !!this.sources.get(sourceId)?.drag;
  }

  /** Pointer moved: hover changes (or the drag follows). Returns what it points at. */
  move(sourceId: string, ray: Ray): VrHit | null {
    const s = this.source(sourceId);
    if (s.drag) {
      s.drag.move(ray);
      return s.lastHit;
    }
    const hit = this.raycast(ray);
    s.lastHit = hit;
    const obj = hit?.object ?? null;
    if (obj !== s.hovered) {
      if (s.hovered) this.items.get(s.hovered)?.onHover?.(null, sourceId);
      s.hovered = obj;
    }
    if (obj && hit) this.items.get(obj)?.onHover?.(hit, sourceId);
    return hit;
  }

  /** Trigger / pinch / mouse button pressed. Returns true when it landed on something. */
  down(sourceId: string, ray: Ray): boolean {
    const s = this.source(sourceId);
    const hit = this.raycast(ray);
    s.lastHit = hit;
    s.pressed = hit?.object ?? null;
    if (hit) this.items.get(hit.object)?.onDown?.(hit, sourceId);
    return !!hit;
  }

  up(sourceId: string, ray: Ray): void {
    const s = this.source(sourceId);
    if (s.drag) {
      const d = s.drag;
      s.drag = null;
      s.pressed = null;
      d.end();
      return;
    }
    const hit = this.raycast(ray);
    const pressed = s.pressed;
    s.pressed = null;
    if (!pressed) return;
    const click = !!hit && hit.object === pressed;
    this.items.get(pressed)?.onUp?.(hit, sourceId, click);
  }

  /** Squeeze / grip: grab whatever window is under the ray. */
  grab(sourceId: string, ray: Ray): boolean {
    const hit = this.raycast(ray);
    if (!hit) return false;
    return this.items.get(hit.object)?.onGrab?.(hit, sourceId) ?? false;
  }

  beginDrag(sourceId: string, drag: DragHandler): void {
    const s = this.source(sourceId);
    s.drag?.end();
    s.drag = drag;
  }

  /** Squeeze released (or the source went away): ends its drag. */
  release(sourceId: string): void {
    const s = this.sources.get(sourceId);
    if (s?.drag) {
      const d = s.drag;
      s.drag = null;
      d.end();
    }
  }

  /** The source disappeared (controller lost, mouse left the canvas). */
  leave(sourceId: string): void {
    const s = this.sources.get(sourceId);
    if (!s) return;
    this.release(sourceId);
    if (s.hovered) this.items.get(s.hovered)?.onHover?.(null, sourceId);
    s.hovered = null;
    s.pressed = null;
    s.lastHit = null;
  }
}
