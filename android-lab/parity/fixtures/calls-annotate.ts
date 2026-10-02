/**
 * Package J golden vectors: drawing on a shared screen (shared/calls/annotate.ts).
 * Writes calls-annotate.json; checked by core/…/calls/CallsAnnotateParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultAnnotColor,
  denormalizePoint,
  normalizePoint,
  pingProgress,
  pruneAnnotations,
  sanitizeAnnotStroke,
  sanitizePing,
  simplifyPoints,
  strokeAlpha,
  sanitizeAnnotText,
  moveAnnotText,
  annotPersistOf,
  textAlpha,
  emptyKept,
  keepStroke,
  keepText,
  dropText,
  ANNOT_TEXT_SIZE,
  MAX_ANNOT_TEXT_CHARS,
  MAX_KEPT_STROKES,
  MAX_KEPT_TEXTS,
  DEFAULT_ANNOT_PERSIST,
  type AnnotPoint,
  type AnnotStroke,
  type AnnotText,
  type KeptAnnotations,
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
// Round 2 C: kept drawings ("Keep" = annot_mode) never fade; the per-role default pens.
const alphasKept = [null, 0, 1000, 5000].flatMap((doneAt) => [0, 4600, 5201, 9000, 20000, 600000].map((now) => ({ doneAt, now, alpha: strokeAlpha(doneAt, now, true) })));
const pruneSet = { a: { doneAt: null }, b: { doneAt: 0 }, c: { doneAt: 3000 }, d: { doneAt: 10000 } } as Record<string, { doneAt: number | null }>;
const prune = [0, 4200, 5000, 7200, 15000, 60000].flatMap((now) => [false, true].map((persist) => ({ now, persist, kept: Object.keys(pruneAnnotations(pruneSet, now, persist)) })));
const pens = [true, false].map((sharing) => ({ sharing, color: defaultAnnotColor(sharing) }));
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

// ---- round 4: text boxes on a shared screen, Keep by default, what the room keeps

const textRaws: unknown[] = [
  null, 5, 'x', {}, [],
  { id: 't', color: '#22c55e', x: 1.4, y: -0.2, text: '你好\r\nworld 😀', size: 0.5, done: true },
  { id: 't', color: 'red', x: 0, y: 0, text: 'a' },
  { id: '', color: '#22c55e', x: 0, y: 0, text: 'a' },
  { id: 'x'.repeat(64), color: '#22c55e', x: 0, y: 0, text: 'a' },
  { id: 'x'.repeat(65), color: '#22c55e', x: 0, y: 0, text: 'a' },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: '字'.repeat(300) },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: '😀'.repeat(250) },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a'.repeat(199) + '😀😀' },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'line1\rline2\r\n\nline3\n\r' },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: '' },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 5 },
  { id: 't', color: '#22c55e', x: 0, y: 0 },
  { id: 't', color: '#22c55e', y: 0, text: 'a' },
  { id: 't', color: '#22c55e', x: null, y: true, text: 'a' },
  { id: 't', color: '#22c55e', x: '0.25', y: ' 0.75 ', text: 'a' },
  { id: 't', color: '#22c55e', x: 'abc', y: 0, text: 'a' },
  { id: 't', color: '#22c55e', x: 0.123456, y: 0.987654, text: 'a', size: 0.01 },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', size: 0.12 },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', size: 0.0099 },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', size: 0.1201 },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', size: 0.045678 },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', size: '0.05' },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', size: null },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', done: 'true' },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', done: 1 },
  { id: 't', color: '#22c55e', x: 0, y: 0, text: 'a', done: false },
];
for (let i = 0; i < 150; i++) {
  textRaws.push({
    id: pick(['t', 'b1', '', 'id-' + i]),
    color: pick(['#f43f5e', '#FACC15', '#fff', 'blue', '#38bdf8']),
    x: pick([r(), r() * 3 - 1, 0, 1, '0.5']),
    y: pick([r(), -0.5, 0.5]),
    text: pick(['你好', 'hello\r\nworld', '这个字读什么？', '', '🙂'.repeat(Math.floor(r() * 220)), '中'.repeat(Math.floor(r() * 260))]),
    size: pick([ANNOT_TEXT_SIZE, r() * 0.15, undefined, 0]),
    done: pick([true, false, undefined]),
  });
}
const texts = textRaws.map((raw) => ({ raw, result: sanitizeAnnotText(raw) }));

const moves: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const t = { x: pick([0, 0.5, 0.9, 0.98, 1, r()]), y: pick([0, 0.1, 0.97, r()]) };
  const dx = pick([0, 0.1, -0.2, 0.5, -1, r() - 0.5, (r() - 0.5) * 3]);
  const dy = pick([0, 0.1, -0.2, -0.5, 2, r() - 0.5]);
  moves.push({ t, dx, dy, result: moveAnnotText(t, dx, dy) });
}

const persistOf = [
  { stored: 'absent', result: annotPersistOf(undefined) },
  { stored: null, result: annotPersistOf(null) },
  { stored: true, result: annotPersistOf(true) },
  { stored: false, result: annotPersistOf(false) },
];
const textAlphas = [null, 0, 1000].flatMap((doneAt) => [0, 3999, 4600, 5201, 10000].flatMap((now) => [false, true].map((persist) => ({ doneAt, now, persist, alpha: textAlpha(doneAt, now, persist) }))));

// A random run of keep / drop operations through the room's kept lists (bounded).
const keptOps: unknown[] = [];
let kept: KeptAnnotations = emptyKept();
const keptAfter: unknown[] = [];
for (let i = 0; i < 900; i++) {
  const roll = r();
  const from = pick(['c1', 'c2']);
  const name = from === 'c1' ? '王老师' : 'Jerome';
  if (roll < 0.6) {
    const stroke: AnnotStroke = { id: 's' + Math.floor(r() * 380), color: pick(['#f43f5e', '#38bdf8']), width: 0.006, points: [[Math.round(r() * 1e4) / 1e4, 0.5]], done: r() < 0.85 };
    keptOps.push({ op: 'stroke', from, name, stroke });
    kept = keepStroke(kept, from, name, stroke);
  } else if (roll < 0.93) {
    const text: AnnotText = { id: 't' + Math.floor(r() * 140), color: '#f43f5e', x: Math.round(r() * 1e4) / 1e4, y: 0.25, text: pick(['你好', 'a', '这个字']), size: ANNOT_TEXT_SIZE, done: r() < 0.7 };
    keptOps.push({ op: 'text', from, name, text });
    kept = keepText(kept, from, name, text);
  } else {
    const id = 't' + Math.floor(r() * 140);
    keptOps.push({ op: 'drop', id });
    kept = dropText(kept, id);
  }
  keptAfter.push([kept.strokes.length, kept.texts.length]);
}
const constants = { ANNOT_TEXT_SIZE, MAX_ANNOT_TEXT_CHARS, MAX_KEPT_STROKES, MAX_KEPT_TEXTS, DEFAULT_ANNOT_PERSIST };

writeFileSync(join(OUT, 'calls-annotate.json'), JSON.stringify({
  normalize, alphas, alphasKept, prune, pruneSet, pens, pings, strokes, pingSan, simplify,
  texts, moves, persistOf, textAlphas, keptOps, keptAfter, kept, constants,
}));
