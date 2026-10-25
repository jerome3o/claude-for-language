/**
 * In-app feedback golden vectors (shared/feedback, docs/FEEDBACK.md):
 *   - `shake`: sample sequences through shakeStep (which samples complete a shake),
 *   - `routes`: routePattern, `lines`: feedbackContextLine, `copy`: FEEDBACK_COPY.
 * Writes feedback.json; core FeedbackParityTest asserts Feedback.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FEEDBACK_COPY, feedbackContextLine, routePattern, type FeedbackContext } from '../../../shared/feedback/feedback';
import { initialShakeState, shakeStep } from '../../../shared/feedback/shake';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: feedback <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const shake: Array<{ samples: number[][]; shakes: number[] }> = [];
for (let seed = 1; seed <= 120; seed++) {
  const r = rng(seed);
  const samples: number[][] = [];
  let t = r() * 50;
  const hard = r() < 0.5;
  const n = 40 + Math.floor(r() * 200);
  for (let i = 0; i < n; i++) {
    t += 5 + r() * 60;
    const big = r() < (hard ? 0.35 : 0.08);
    const m = big ? 20 + r() * 25 : 5 + r() * 12;
    const ang = r() * Math.PI * 2;
    samples.push([Number(t.toFixed(3)), Number((m * Math.cos(ang)).toFixed(4)), Number((m * Math.sin(ang)).toFixed(4)), Number((r() * 4 - 2).toFixed(4))]);
  }
  if (seed % 17 === 0) samples.push([t + 10, NaN, 30, 0]);
  let state = initialShakeState();
  const shakes: number[] = [];
  samples.forEach(([st, x, y, z], i) => {
    const out = shakeStep(state, { t: st, x, y, z });
    state = out.state;
    if (out.shake) shakes.push(i);
  });
  shake.push({ samples: samples.map((s) => s.map((v) => (Number.isFinite(v) ? v : 'NaN'))) as unknown as number[][], shakes });
}

const routeInputs = ['/decks/abc123', '/idioms/画蛇添足?x=1', '/connections/r1/homework-library', '/study', '', 'https://x.example/a', '/decks/:id', '/a/b/c/d/e/f/g/h/i/j', '/Settings', '/homework/hw-12#top', '/x'];
const routes = routeInputs.map((input) => ({ input, out: routePattern(input) }));

const ctxs: FeedbackContext[] = [
  { platform: 'lab', app_version: '0.142', screen: '/study', device: 'Pixel 10 Pro Fold', online: false, via: 'shake' },
  { platform: 'vr', screen: '/vr' },
  { app_version: 'b1', os: 'Chrome 141 Android', online: true, via: 'menu' },
  { platform: 'web', os: 'Firefox 140 Linux', device: 'Laptop' },
  {},
];
const lines = ctxs.map((c) => ({ ctx: c, out: feedbackContextLine(c) }));

writeFileSync(join(OUT, 'feedback.json'), JSON.stringify({ shake, routes, lines, copy: FEEDBACK_COPY }));
