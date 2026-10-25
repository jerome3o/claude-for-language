/**
 * "Shake the phone to send feedback" (docs/FEEDBACK.md): the ONE rule both apps use — the web's
 * DeviceMotionEvent listener and the Lab app's accelerometer listener feed raw samples (m/s²,
 * gravity INCLUDED) into `shakeStep` and open the feedback sheet when it says so. Lab port:
 * core `feedback/Shake.kt`, parity-tested (parity/fixtures/feedback.ts).
 *
 * A jolt = a sample whose magnitude is at least `thresholdMs2` (≈ 2.5 g; walking peaks near 1.5 g,
 * running near 2–2.5 g at ~3 steps a second) and at least `minGapMs` after the previous jolt. A
 * shake = `jolts` jolts within `windowMs` — an angry shake gives 6–10 a second — and at least
 * `cooldownMs` after the last shake, so one shake opens one sheet.
 */
export const SHAKE_RULE = {
  thresholdMs2: 25,
  minGapMs: 90,
  windowMs: 1000,
  jolts: 4,
  cooldownMs: 4000,
} as const;

export interface ShakeState {
  /** Times (ms) of the jolts still inside the window. */
  jolts: number[];
  /** Time of the last shake, or null. */
  lastShake: number | null;
}

export const initialShakeState = (): ShakeState => ({ jolts: [], lastShake: null });

export interface ShakeSample {
  t: number;
  x: number;
  y: number;
  z: number;
}

/** One sample in → the next state and whether this sample completed a shake. Pure. */
export function shakeStep(state: ShakeState, s: ShakeSample, rule: typeof SHAKE_RULE = SHAKE_RULE): { state: ShakeState; shake: boolean } {
  if (![s.t, s.x, s.y, s.z].every(Number.isFinite)) return { state, shake: false };
  const magnitude = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
  const jolts = state.jolts.filter((t) => s.t - t < rule.windowMs && t <= s.t);
  const last = jolts.length ? jolts[jolts.length - 1] : null;
  if (magnitude < rule.thresholdMs2 || (last !== null && s.t - last < rule.minGapMs)) {
    return { state: { jolts, lastShake: state.lastShake }, shake: false };
  }
  jolts.push(s.t);
  const cooled = state.lastShake === null || s.t - state.lastShake >= rule.cooldownMs;
  if (jolts.length >= rule.jolts && cooled) return { state: { jolts: [], lastShake: s.t }, shake: true };
  return { state: { jolts, lastShake: state.lastShake }, shake: false };
}
