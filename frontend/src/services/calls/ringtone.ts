/**
 * The in-app ring for an incoming call: a soft three-note chime every two
 * seconds (Web Audio, nothing to download) plus vibration where the device
 * allows it. Browsers only play sound after the page has been used, so a
 * ring on a page that was never touched is silent — the banner still shows.
 */

import { CALL_RING_DURATION_MS } from '@shared/calls';

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let stopAt = 0;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = ctx ?? new Ctor();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

function chime(ac: AudioContext) {
  const notes = [659.25, 783.99, 1046.5]; // E5 G5 C6
  notes.forEach((freq, i) => {
    const t = ac.currentTime + i * 0.16;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}

function buzz() {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    /* not allowed */
  }
}

export function isRinging(): boolean {
  return timer !== null;
}

/** Start ringing (no-op if already ringing); stops by itself after CALL_RING_DURATION_MS. */
export function startRinging(durationMs = CALL_RING_DURATION_MS): void {
  stopAt = Date.now() + durationMs;
  if (timer) return;
  const tick = () => {
    if (Date.now() > stopAt) {
      stopRinging();
      return;
    }
    const ac = audio();
    if (ac && ac.state === 'running') chime(ac);
    buzz();
  };
  tick();
  timer = setInterval(tick, 2000);
}

export function stopRinging(): void {
  if (timer) clearInterval(timer);
  timer = null;
  try {
    navigator.vibrate?.(0);
  } catch {
    /* ignore */
  }
}
