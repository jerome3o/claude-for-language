/**
 * Package J golden vectors: drawing on a shared screen (shared/calls/annotate.ts).
 * Writes calls-annotate.json; checked by core/…/calls/CallsAnnotateParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  denormalizePoint,
  normalizePoint,
  pingProgress,
  sanitizeAnnotStroke,
  sanitizePing,
  simplifyPoints,
  strokeAlpha,
  type AnnotPoint,
} from '../../../shared/calls/annotate';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261001);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const videos = [{ width: 1920, height: 1080 }, { width: 1080, height: 2400 }, { width: 1280, height: 720 }, null, { width: 0, height: 0 }];
const boxes = [{ width: 800, height: 800 }, { width: 412, height: 700 }, { width: 1440, height: 760 }, { width: 96, height: 128 }, { width: 0, height: 10 }];
const normalize: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const video = pick(videos);
  const box = pick(boxes);
  const px = Math.round((r() * 1.2 - 0.1) * box.width * 100) / 100;
  const py = Math.round((r() * 1.2 - 0.1) * box.height * 100) / 100;
  const p = normalizePoint(px, py, box, video);
  normalize.push({ px, py, box, video, p, back: p ? denormalizePoint(p, box, video) : null });
}

const alphas = [null, 0, 1000, 5000].flatMap((doneAt) => [0, 1000, 3999, 4000, 4600, 5200, 5201, 9000, 20000].map((now) => ({ doneAt, now, alpha: strokeAlpha(doneAt, now) })));
const pings = [0, 500].flatMap((at) => [-10, 0, 400, 800, 1599, 1600, 2100, 2500].map((now) => ({ at, now, t: pingProgress(at, now) })));

const raws: unknown[] = [
  null, 5, {}, { id: 's', color: '#f43f5e', width: 0.006, points: [[0.1, 0.2]], done: true },
  { id: 's', color: '#f43f5e', width: '0.01', points: [[0.1, 0.2]], done: 'true' },
  { id: 's', color: '#f43f5e', width: 0.05, points: [[0.1, 0.2]] },
  { id: 's', color: '#f43f5e', width: 0.0501, points: [[0.1, 0.2]] },
  { id: 's', color: '#f43f5e', width: 0, points: [[0.1, 0.2]] },
  { id: 's', color: '#f43f5e', points: [[0.1, 0.2]] },
  { id: 's', color: 'red', width: 0.01, points: [[0.1, 0.2]] },
  { id: '', color: '#f43f5e', width: 0.01, points: [[0.1, 0.2]] },
  { id: 'x'.repeat(65), color: '#f43f5e', width: 0.01, points: [[0.1, 0.2]] },
  { id: 's', color: '#f43f5e', width: 0.01, points: [] },
  { id: 's', color: '#f43f5e', width: 0.01, points: [[0.123456, 1.7], ['0.5', '0.25'], [null, 0.5], [true, false], ['x', 1], [0.3], 'no', [-2, 0.99999]] },
  { id: 's', color: '#f43f5e', width: 0.01, points: Array.from({ length: 700 }, (_, i) => [i / 700, 0.5]) },
];
for (let i = 0; i < 150; i++) {
  raws.push({
    id: pick(['a', 'b1', '', 'id-' + i]),
    color: pick(['#f43f5e', '#FACC15', '#fff', 'blue']),
    width: pick([0.006, 0.02, 0.06, -1, 0.0001]),
    points: Array.from({ length: Math.floor(r() * 5) }, () => [pick([r(), r() * 3 - 1, 0, 1]), pick([r(), 0.5, -0.1])]),
    done: pick([true, false, undefined]),
  });
}
const strokes = raws.map((raw) => ({ raw, result: sanitizeAnnotStroke(raw) }));
const pingRaws = [null, {}, { x: 0.5, y: 0.5 }, { x: 2, y: -1 }, { x: '0.25', y: '0.75' }, { x: 'a', y: 0.5 }, { x: 0.123456, y: null }, { x: true, y: false }, { y: 0.5 }];
const pingSan = pingRaws.map((raw) => ({ raw, result: sanitizePing(raw) }));

const simplify: unknown[] = [];
for (let i = 0; i < 60; i++) {
  let x = r();
  let y = r();
  const pts: AnnotPoint[] = Array.from({ length: Math.floor(r() * 30) }, () => {
    x += (r() - 0.5) * 0.01;
    y += (r() - 0.5) * 0.01;
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  });
  simplify.push({ points: pts, result: simplifyPoints(pts) });
}

writeFileSync(join(OUT, 'calls-annotate.json'), JSON.stringify({ normalize, alphas, pings, strokes, pingSan, simplify }));
