/**
 * The world's objects while it runs: each spec'd object with its physics body, its pick boxes (what
 * rays and the mouse hit) and who holds it. The task engine's snapshots are read from here.
 */
import { Euler, Quaternion, Vector3, type Mesh } from 'three';
import type { RapierRigidBody } from '@react-three/rapier';
import type { Vec3, WorldSnapshot } from '@shared/vr-worlds';
import type { WorldObjectDef } from '../types';

export interface LiveObject {
  def: WorldObjectDef;
  body: RapierRigidBody | null;
  /** The input source holding it (`mouse`, `xr0`, `xr1`), else null. */
  heldBy: string | null;
  /** Its velocity on the previous frame (impact sounds: the speed things met at). */
  lastVel: Vector3;
}

const tmpQ = new Quaternion();
const tmpE = new Euler();

export class LiveObjects {
  private map = new Map<string, LiveObject>();
  private byProxy = new Map<Mesh, string>();

  constructor(defs: readonly WorldObjectDef[]) {
    for (const def of defs) this.map.set(def.id, { def, body: null, heldBy: null, lastVel: new Vector3() });
  }

  get(id: string): LiveObject | undefined {
    return this.map.get(id);
  }

  all(): LiveObject[] {
    return [...this.map.values()];
  }

  setBody(id: string, body: RapierRigidBody | null) {
    const o = this.map.get(id);
    if (o) o.body = body;
  }

  /** A pick box of an object (one per active collider part: a fridge's inside stays reachable). */
  addProxy(id: string, proxy: Mesh): () => void {
    this.byProxy.set(proxy, id);
    return () => {
      if (this.byProxy.get(proxy) === id) this.byProxy.delete(proxy);
    };
  }

  idOfProxy(mesh: unknown): string | null {
    return this.byProxy.get(mesh as Mesh) ?? null;
  }

  /** Where it is now (its body), else where it started. */
  position(id: string, out = new Vector3()): Vector3 {
    const o = this.map.get(id);
    const b = o?.body;
    if (b) {
      const t = b.translation();
      return out.set(t.x, t.y, t.z);
    }
    return o ? out.set(o.def.at[0], o.def.at[1], o.def.at[2]) : out.set(0, 0, 0);
  }

  /** Every frame: remember velocities (for impact speeds). */
  trackVelocities() {
    for (const o of this.map.values()) {
      const b = o.body;
      if (!b || o.def.mass <= 0) continue;
      const v = b.linvel();
      o.lastVel.set(v.x, v.y, v.z);
    }
  }

  snapshot(t: number, player: Vec3, states: Readonly<Record<string, Record<string, string>>>): WorldSnapshot {
    const objects: WorldSnapshot['objects'] = {};
    for (const o of this.map.values()) {
      const b = o.body;
      let pos: Vec3 = [...o.def.at] as Vec3;
      let yaw = o.def.yaw ?? 0;
      let speed = 0;
      if (b) {
        const p = b.translation();
        pos = [p.x, p.y, p.z];
        const r = b.rotation();
        tmpQ.set(r.x, r.y, r.z, r.w);
        yaw = tmpE.setFromQuaternion(tmpQ, 'YXZ').y;
        if (o.def.mass > 0) {
          const v = b.linvel();
          speed = Math.hypot(v.x, v.y, v.z);
        }
      }
      objects[o.def.id] = { pos, yaw, speed, held: o.heldBy !== null, states: states[o.def.id] ?? {} };
    }
    return { t, player, objects };
  }
}
