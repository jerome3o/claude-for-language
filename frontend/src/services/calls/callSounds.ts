/**
 * The call's sounds (shared/calls/chime.ts): a soft chime when the other person joins, a softer
 * one when they leave, a bell when the timer reaches zero — synthesised with WebAudio from
 * CHIME_TONES (no audio files, nothing to license), and the per-device on / off switch.
 */

import { CALL_SOUNDS_KEY, CHIME_ATTACK_MS, CHIME_TONES, callSoundsOn, type ChimeKind } from '@shared/calls';

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined) as
    | typeof AudioContext
    | undefined;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Play a chime now (a no-op without WebAudio). The call page has had a click (Join), so the context may start. */
export function playChime(kind: ChimeKind, sinkId?: string | null): void {
  const ac = audioContext();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  // The chosen speaker, where the browser lets a context pick one (Chrome 110+).
  const withSink = ac as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
  if (sinkId && withSink.setSinkId && withSink.sinkId !== sinkId) void withSink.setSinkId(sinkId).catch(() => {});
  const t0 = ac.currentTime + 0.02;
  for (const tone of CHIME_TONES[kind]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.freq;
    const start = t0 + tone.at / 1000;
    const peakAt = start + CHIME_ATTACK_MS / 1000;
    const end = start + tone.ms / 1000;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(tone.gain, peakAt);
    // e^-5 over the length, like chimeSample (exponential ramps can't reach 0).
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, tone.gain * Math.exp(-5)), end);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

export function loadCallSounds(): boolean {
  try {
    return callSoundsOn(localStorage.getItem(CALL_SOUNDS_KEY));
  } catch {
    return true;
  }
}

export function saveCallSounds(on: boolean): void {
  try {
    localStorage.setItem(CALL_SOUNDS_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: this page only */
  }
}
