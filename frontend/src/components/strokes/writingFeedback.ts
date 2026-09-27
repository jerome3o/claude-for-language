/**
 * Tiny, asset-free feedback for the writing pad: a soft pluck when a stroke
 * lands, a low bump on a miss, a little arpeggio when a character is done —
 * plus a haptic tick where the device has one. Sound can be muted (remembered
 * per device); every call is best-effort and silent on failure.
 */

const MUTE_KEY = 'writing-pad-muted';

export function isWritingSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setWritingSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // ignore
  }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (isWritingSoundMuted()) return null;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}

/** Pitch climbs with each stroke of the character, so a run of good strokes sounds like progress. */
export function playStrokeCorrect(strokeIndex: number) {
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
  const f = scale[strokeIndex % scale.length];
  tone(f, 0, 0.18, 0.08, 'triangle');
  tone(f * 2, 0, 0.09, 0.025);
  vibrate(8);
}

export function playStrokeMiss() {
  tone(196, 0, 0.16, 0.06, 'sine');
  vibrate([12, 40, 12]);
}

export function playCharacterDone(perfect: boolean) {
  const notes = perfect ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
  notes.forEach((f, i) => tone(f, i * 0.07, 0.3, 0.07, 'triangle'));
  vibrate(perfect ? [10, 30, 10, 30, 20] : 15);
}
