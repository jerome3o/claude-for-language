/**
 * The feel of Hard mode's moments on the web (shared/study/hardMode.ts `StudyFeel`; docs/STUDY_SESSION.md
 * "Hard mode"): a firm vibration (navigator.vibrate — Android Chrome / the installed PWA; nothing on
 * iOS / desktop) and a short synthesised chime (WebAudio, no asset). Jerome: "when I get it right on the
 * very first page there's no satisfying haptics — I find myself quite dependent on it".
 *
 * Before this the web study card had NO haptics at all on that path. The Lab app composes its own
 * primitives (fx/Haptics.success / celebrate). Per device: Settings → Study → "Haptics and sounds on
 * right answers" (on by default); every call is best-effort and silent on failure.
 */
import { useEffect, useState } from 'react';
import { STUDY_FEEL_VIBRATION, type StudyFeel } from '@shared/study/hardMode';

const KEY = 'study-feel-v1';
const EVENT = 'study-feel-change';

export function readStudyFeelOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeStudyFeelOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: the default stays */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
  } catch {
    /* no window (tests) */
  }
}

/** The setting, live (Settings changes it). */
export function useStudyFeelOn(): boolean {
  const [on, setOn] = useState(readStudyFeelOn);
  useEffect(() => {
    const update = () => setOn(readStudyFeelOn());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return on;
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
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

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'triangle') {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function chime(feel: StudyFeel) {
  switch (feel) {
    case 'success':
      tone(659.25, 0, 0.16, 0.16);
      tone(987.77, 0.09, 0.26, 0.15);
      break;
    case 'round_right':
      tone(783.99, 0, 0.14, 0.13);
      tone(1046.5, 0.08, 0.22, 0.12);
      break;
    case 'round_done':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, i === 3 ? 0.45 : 0.18, 0.14));
      break;
    case 'nearly':
      tone(659.25, 0, 0.14, 0.09);
      break;
    case 'miss':
      tone(220, 0, 0.16, 0.08, 'sine');
      tone(185, 0.1, 0.2, 0.07, 'sine');
      break;
  }
}

/** Play a moment's feel (no-op when the setting is off or the feel is null). */
export function studyFeel(feel: StudyFeel | null | undefined): void {
  if (!feel || !readStudyFeelOn()) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate([...STUDY_FEEL_VIBRATION[feel]]);
  } catch {
    /* no haptics */
  }
  try {
    chime(feel);
  } catch {
    /* no sound */
  }
}
