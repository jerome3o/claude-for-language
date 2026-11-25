/**
 * The maths of carrying and throwing (docs/VR_WORLDS.md "Physics & interaction"), pure and unit-tested:
 * a held object is a dynamic body whose velocity is steered towards the hand every frame (so it still
 * bumps into tables and walls), the hand's own velocity is estimated from its recent positions, and
 * letting go keeps that velocity — a throw.
 */
export type V3 = [number, number, number];

/** Recent positions of a hand / pointer → its velocity (m/s) over the last `windowMs`. */
export class VelocityTracker {
  private samples: Array<{ t: number; p: V3 }> = [];

  constructor(private readonly windowMs = 90, private readonly keep = 16) {}

  push(t: number, p: V3) {
    this.samples.push({ t, p: [p[0], p[1], p[2]] });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  reset() {
    this.samples = [];
  }

  /** Least-squares slope over the samples in the window (robust to one jittery frame). */
  velocity(now?: number): V3 {
    const last = this.samples[this.samples.length - 1];
    if (!last) return [0, 0, 0];
    const end = now ?? last.t;
    const win = this.samples.filter((s) => end - s.t <= this.windowMs);
    if (win.length < 2) return [0, 0, 0];
    const tm = win.reduce((a, s) => a + s.t, 0) / win.length;
    let den = 0;
    const num: V3 = [0, 0, 0];
    const pm: V3 = [0, 0, 0];
    for (const s of win) for (let i = 0; i < 3; i++) pm[i] += s.p[i] / win.length;
    for (const s of win) {
      const dt = s.t - tm;
      den += dt * dt;
      for (let i = 0; i < 3; i++) num[i] += dt * (s.p[i] - pm[i]);
    }
    if (den <= 1e-9) return [0, 0, 0];
    return [(num[0] / den) * 1000, (num[1] / den) * 1000, (num[2] / den) * 1000];
  }
}

export function length(v: V3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function clampLength(v: V3, max: number): V3 {
  const l = length(v);
  if (l <= max || l === 0) return v;
  const k = max / l;
  return [v[0] * k, v[1] * k, v[2] * k];
}

/** Steer a held body: the hand's velocity plus a spring towards the hand (gain 1/s), capped. */
export function carryVelocity(pos: V3, target: V3, handVel: V3, gain = 18, max = 14): V3 {
  return clampLength([
    handVel[0] + (target[0] - pos[0]) * gain,
    handVel[1] + (target[1] - pos[1]) * gain,
    handVel[2] + (target[2] - pos[2]) * gain,
  ], max);
}

/** Distance grab: the hold distance eases from where it was grabbed to the goal (exponential, `rate` 1/s). */
export function easeTowards(current: number, goal: number, dt: number, rate = 9): number {
  return goal + (current - goal) * Math.exp(-rate * Math.max(0, dt));
}

export const MAX_THROW_SPEED = 12;

/**
 * Letting go: the velocity it leaves with. XR = the hand's velocity. Flat preview = the pointer's
 * flick, given a push along the view (a flick across the screen should throw forward, not sideways).
 */
export function releaseVelocity(handVel: V3, mode: 'xr' | 'flat', forward: V3): V3 {
  if (mode === 'xr') return clampLength(handVel, MAX_THROW_SPEED);
  const speed = length(handVel);
  if (speed < 0.9) return clampLength(handVel, 1.5);
  const push = Math.min(7, speed * 0.9);
  return clampLength([handVel[0] * 0.6 + forward[0] * push, handVel[1] * 0.6 + forward[1] * push + push * 0.25, handVel[2] * 0.6 + forward[2] * push], MAX_THROW_SPEED);
}

/** The flat preview's "throw" key: straight ahead, a little up. */
export function throwForward(forward: V3, speed = 5.5): V3 {
  return [forward[0] * speed, forward[1] * speed + 1.6, forward[2] * speed];
}
