/**
 * Picking things up (docs/VR_WORLDS.md "Physics & interaction"). One hold per input source (each
 * controller, the mouse). A press on an object starts PENDING: let go quickly without moving = a click
 * (inspect); keep holding (~¼ s) or move = a grab. Squeeze grabs at once. A held object stays a
 * dynamic body steered towards the hand (grabMath.ts `carryVelocity`), so it bumps into tables and
 * walls; distance grab eases it from where it was to the hand; letting go keeps the hand's velocity —
 * a throw.
 */
import { Quaternion, Ray, Vector3 } from 'three';
import type { RapierRigidBody } from '@react-three/rapier';
import { localBounds } from '@shared/vr-worlds';
import type { WorldEvent } from '@shared/vr-worlds';
import { THROW_SPEED } from '@shared/vr-worlds';
import type { InteractionHub, VrHit } from '../../scene/interaction';
import { carryVelocity, easeTowards, length, releaseVelocity, throwForward, VelocityTracker, type V3 } from '../grabMath';
import type { LiveObjects } from './live';
import type { SoundEngine } from '../sound';

export interface GrabEnv {
  mode(source: string): 'xr' | 'flat';
  /** The source's orientation (a controller's, or the flat camera's yaw). */
  sourceQuat(source: string, out: Quaternion): Quaternion;
  /** The view direction (flat throws). */
  forward(out: Vector3): Vector3;
  onClick(id: string, source: string): void;
  /**
   * The flat preview carries things OVER what the pointer is on (a table, the floor), not at a fixed
   * distance along the ray — placing is then just pointing. The first static or dynamic thing on the
   * ray other than the carried body, else null.
   */
  surfaceUnder?(ray: Ray, exclude: RapierRigidBody): { point: Vector3; normal: Vector3; distance: number } | null;
}

interface Hold {
  id: string;
  source: string;
  phase: 'pending' | 'held';
  t0: number;
  dir0: Vector3;
  ray: Ray;
  dist: number;
  goalDist: number;
  qOffset: Quaternion;
  tracker: VelocityTracker;
  /** Flat preview: how high over the surface it is carried (the wheel lifts it). */
  lift: number;
}

const PENDING_MS = 260;
const MOVE_TO_GRAB = 0.07; // radians of ray movement that turn a press into a grab
const XR_HOLD = 0.12;

const tq = new Quaternion();
const tq2 = new Quaternion();
const tv = new Vector3();
const target = new Vector3();

export class Grabber {
  private holds = new Map<string, Hold>();
  private events: WorldEvent[] = [];

  constructor(private live: LiveObjects, private hub: InteractionHub, private env: GrabEnv, private sound: SoundEngine) {}

  isHolding(source: string): boolean {
    return this.holds.get(source)?.phase === 'held';
  }

  heldId(source: string): string | null {
    const h = this.holds.get(source);
    return h?.phase === 'held' ? h.id : null;
  }

  /** A pending press on something that can't be picked up (furniture): the flat preview turns it into a look-drag. */
  pendingFixed(source: string): boolean {
    const h = this.holds.get(source);
    return !!h && h.phase === 'pending' && (this.live.get(h.id)?.def.mass ?? 0) <= 0;
  }

  /** Trigger / mouse pressed on an object. */
  press(id: string, source: string, hit: VrHit) {
    this.drop(source);
    this.hub.release(source); // ends an older drag of this source (its hold is gone: no click)
    const h: Hold = {
      id, source, phase: 'pending', t0: performance.now(), dir0: hit.ray.direction.clone(), ray: hit.ray.clone(),
      dist: hit.distance, goalDist: hit.distance, qOffset: new Quaternion(), tracker: new VelocityTracker(), lift: 0.05,
    };
    this.holds.set(source, h);
    this.hub.beginDrag(source, {
      move: (ray) => {
        h.ray.copy(ray);
        if (h.phase === 'pending' && ray.direction.angleTo(h.dir0) > MOVE_TO_GRAB) this.promote(h);
      },
      end: () => this.end(source),
    });
  }

  /** Squeeze / grip: grab at once. */
  grabNow(id: string, source: string, hit: VrHit): boolean {
    if ((this.live.get(id)?.def.mass ?? 0) <= 0) return false;
    this.press(id, source, hit);
    const h = this.holds.get(source);
    if (h) this.promote(h);
    return true;
  }

  /** Forget a press without a click (it became a look-drag). */
  cancel(source: string) {
    const h = this.holds.get(source);
    if (h?.phase === 'pending') this.holds.delete(source);
    this.hub.release(source);
  }

  private promote(h: Hold) {
    const o = this.live.get(h.id);
    if (!o || !o.body || o.def.mass <= 0) return;
    // Taken from another hand: that hold ends quietly.
    for (const [src, other] of this.holds) if (src !== h.source && other.id === h.id && other.phase === 'held') this.holds.delete(src);
    const b = o.body;
    b.setGravityScale(0, true);
    b.wakeUp();
    o.heldBy = h.source;
    h.phase = 'held';
    const mode = this.env.mode(h.source);
    h.goalDist = mode === 'xr' ? XR_HOLD : Math.max(0.55, Math.min(1.3, h.dist));
    const r = b.rotation();
    tq.set(r.x, r.y, r.z, r.w);
    this.env.sourceQuat(h.source, tq2);
    h.qOffset.copy(tq2.invert()).multiply(tq);
    h.tracker.reset();
    this.events.push({ type: 'grab', obj: h.id });
    this.sound.play('pickup', this.live.position(h.id, tv), 0.6);
  }

  private end(source: string) {
    const h = this.holds.get(source);
    if (!h) return;
    this.holds.delete(source);
    if (h.phase === 'pending') {
      this.env.onClick(h.id, source);
      return;
    }
    const mode = this.env.mode(source);
    this.release(h, releaseVelocity(h.tracker.velocity(performance.now()), mode, this.env.forward(tv).toArray() as V3));
  }

  /** The flat preview's throw key: straight ahead from where it is held. */
  throwHeld(source: string): boolean {
    const h = this.holds.get(source);
    if (!h || h.phase !== 'held') return false;
    this.holds.delete(source);
    this.hub.release(source);
    this.release(h, throwForward(this.env.forward(tv).toArray() as V3));
    return true;
  }

  /** Mouse wheel while carrying: higher / lower over the surface (and nearer / further in the air). */
  nudgeDistance(source: string, delta: number) {
    const h = this.holds.get(source);
    if (h?.phase !== 'held') return;
    h.goalDist = Math.max(0.35, Math.min(2.2, h.goalDist + delta));
    h.lift = Math.max(0, Math.min(0.8, h.lift + delta));
  }

  private release(h: Hold, vel: V3) {
    const o = this.live.get(h.id);
    if (!o || o.heldBy !== h.source) return;
    o.heldBy = null;
    const b = o.body;
    if (!b) return;
    b.setGravityScale(1, true);
    b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
    const av = b.angvel();
    b.setAngvel({ x: av.x * 0.5, y: av.y * 0.5, z: av.z * 0.5 }, true);
    const speed = length(vel);
    this.events.push({ type: 'release', obj: h.id, speed });
    this.sound.play(speed >= THROW_SPEED ? 'throw' : 'drop', this.live.position(h.id, tv), speed >= THROW_SPEED ? 0.7 : 0.4);
  }

  /** Drop whatever this source holds (a lost controller, leaving the page). */
  drop(source: string) {
    const h = this.holds.get(source);
    if (!h) return;
    this.holds.delete(source);
    if (h.phase === 'held') this.release(h, [0, 0, 0]);
  }

  dropAll() {
    for (const s of [...this.holds.keys()]) this.drop(s);
  }

  /** Every frame: pending presses that waited long enough become grabs; held bodies follow their hand. */
  update(dt: number, frameDt = dt) {
    const now = performance.now();
    for (const h of [...this.holds.values()]) {
      if (h.phase === 'pending') {
        if (now - h.t0 >= PENDING_MS) this.promote(h);
        continue;
      }
      const o = this.live.get(h.id);
      const b = o?.body;
      if (!o || !b || o.heldBy !== h.source) {
        this.holds.delete(h.source);
        continue;
      }
      h.dist = easeTowards(h.dist, h.goalDist, dt);
      target.copy(h.ray.direction).multiplyScalar(h.dist).add(h.ray.origin);
      if (this.env.mode(h.source) === 'flat' && this.env.surfaceUnder) {
        const hit = this.env.surfaceUnder(h.ray, b);
        if (hit && hit.distance < 4.5) {
          const bnd = localBounds(o.def);
          if (hit.normal.y > 0.5) target.copy(hit.point).y += -bnd.min[1] + 0.05 + h.lift;
          else {
            // A wall / the front of a cupboard: hold it in front, at the height it already has (it
            // never slides down a cupboard door on its way to the table).
            const y = b.translation().y;
            target.copy(hit.point).addScaledVector(hit.normal, Math.max(bnd.max[0], bnd.max[2], 0.05) + 0.04);
            target.y = Math.max(target.y, y);
          }
        } else if (hit) target.copy(h.ray.direction).multiplyScalar(Math.min(h.dist, 2)).add(h.ray.origin);
      }
      h.tracker.push(now, [target.x, target.y, target.z]);
      const p = b.translation();
      // Frame-rate safe: the spring never asks for more than ~85 % of the gap in one frame (a slow
      // frame runs several physics steps at this velocity); the hand's own velocity is fed forward
      // only for tracked hands (the flat pointer's target can jump from a table to the floor).
      const gain = Math.min(18, 0.85 / Math.max(frameDt, 1 / 120));
      const handVel: V3 = this.env.mode(h.source) === 'xr' ? h.tracker.velocity(now) : [0, 0, 0];
      const v = carryVelocity([p.x, p.y, p.z], [target.x, target.y, target.z], handVel, gain, 10);
      b.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
      // Turn with the hand: the rotation it had relative to the hand when grabbed.
      this.env.sourceQuat(h.source, tq2).multiply(h.qOffset);
      const r = b.rotation();
      tq.set(r.x, r.y, r.z, r.w);
      const err = tq2.multiply(tq.invert());
      if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w);
      const angle = 2 * Math.acos(Math.min(1, err.w));
      const s = Math.sqrt(Math.max(1e-9, 1 - err.w * err.w));
      const k = Math.min(20, angle * 12) / Math.max(1e-6, angle);
      b.setAngvel(angle < 1e-3 ? { x: 0, y: 0, z: 0 } : { x: (err.x / s) * angle * k, y: (err.y / s) * angle * k, z: (err.z / s) * angle * k }, true);
    }
  }

  takeEvents(): WorldEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Record something the learner did outside a hold (inspect, use). */
  note(event: WorldEvent) {
    this.events.push(event);
  }
}
