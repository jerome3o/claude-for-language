/**
 * 🎬 Instant feedback for a clip's interactive scenes: a short synthesised sound (WebAudio — no
 * files) and a buzz on phones. Silent when the clip is muted.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
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
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export type ClipFeedback = 'right' | 'wrong' | 'close' | 'tap' | 'flip';

export function clipFeedback(kind: ClipFeedback, muted: boolean): void {
  if (kind === 'right') vibrate([10, 30, 18]);
  else if (kind === 'wrong') vibrate([25, 40, 25]);
  else vibrate(8);
  if (muted) return;
  switch (kind) {
    case 'right':
      tone(660, 0, 0.14, 0.18, 'triangle');
      tone(990, 0.09, 0.22, 0.16, 'triangle');
      break;
    case 'close':
      tone(660, 0, 0.16, 0.14, 'triangle');
      tone(740, 0.1, 0.18, 0.12, 'triangle');
      break;
    case 'wrong':
      tone(220, 0, 0.18, 0.14, 'square');
      tone(180, 0.12, 0.22, 0.12, 'square');
      break;
    case 'flip':
      tone(520, 0, 0.08, 0.1, 'sine');
      tone(780, 0.05, 0.12, 0.1, 'sine');
      break;
    default:
      tone(880, 0, 0.05, 0.08, 'sine');
  }
}
