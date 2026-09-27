/**
 * Golden vectors for the Kotlin port of shared/strokes (android-lab/core/…/Strokes.kt).
 *
 * Runs the web app's own matcher / quiz on real characters from hanzi-writer-data
 * (Make Me a Hanzi, Arphic Public License — see docs/STROKE_ORDER.md) with synthetic
 * "hand-drawn" strokes: the right stroke (shifted, wobbled, scaled), reversed, a later
 * stroke, an earlier one, cut short, scribbles and taps — in both modes and at several
 * leniencies. StrokesParityTest requires the Kotlin to give the same verdicts and the
 * same doubles, bit for bit. Also: whole quiz runs (feedback per stroke, hints, reveals,
 * summaries, grades, writtenFromMemory), geometry primitives and the data helpers.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import {
  brushPath,
  compactStroke,
  createQuiz,
  directionSimilarity,
  frechet,
  hintLevel,
  matchStroke,
  medianLength,
  medianPath,
  meanNearestDistance,
  mistakeMessage,
  normalizeShape,
  parseCharStrokeData,
  pathLength,
  requestHint,
  resample,
  revealStroke,
  shapeDistance,
  strokeDataFile,
  strokeStart,
  submitStroke,
  summarizeCharacter,
  summarizeExercise,
  writableCharacters,
  writtenFromMemory,
  type CharStrokeData,
  type CharacterQuizState,
  type CharacterWritingResult,
  type Point,
  type WritingMode,
} from '../../../shared/strokes';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: strokes <out-dir>');
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
const rand = rng(20260927);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

// ---------------- characters ----------------

// The bundle runs from a temp dir: look for node_modules walking up from the cwd and the output dir.
function findDataDir(): string {
  for (const start of [process.cwd(), OUT]) {
    let dir = resolve(start);
    for (;;) {
      const candidate = join(dir, 'node_modules', 'hanzi-writer-data');
      if (existsSync(join(candidate, 'package.json'))) return candidate;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error('hanzi-writer-data not found — run npm ci at the repo root');
}
const dataDir = findDataDir();
const loadChar = (c: string): CharStrokeData | null => {
  try {
    return parseCharStrokeData(JSON.parse(readFileSync(join(dataDir, `${c}.json`), 'utf8')));
  } catch {
    return null;
  }
};

const FIXED = ['十', '三', '口', '人', '你', '八', '好', '我', '中', '国', '谢', '永', '目', '川', '心', '水', '爱', '学', '字', '书', '一', '乙', '了', '鼻'];
const all = readdirSync(dataDir)
  .filter((f) => f.endsWith('.json') && f !== 'package.json')
  .map((f) => f.replace(/\.json$/, ''))
  .filter((c) => Array.from(c).length === 1)
  .sort();
const chosen = new Set<string>(FIXED.filter((c) => loadChar(c)));
while (chosen.size < 110) chosen.add(all[Math.floor(rand() * all.length)]);
const chars: Record<string, CharStrokeData> = {};
for (const c of chosen) {
  const d = loadChar(c);
  if (d) chars[c] = d; // outlines kept: the Kotlin side parses the paths for rendering tests too
}

// ---------------- synthetic drawings ----------------

const toPts = (m: [number, number][]): Point[] => m.map(([x, y]) => ({ x, y }));

interface DrawOpts {
  dx: number;
  dy: number;
  wobble: number;
  n: number;
  scale: number;
  cx: number;
  cy: number;
  cut: number; // keep this fraction of the points
  reverse: boolean;
}

function draw(median: [number, number][], o: DrawOpts): Point[] {
  let pts = resample(toPts(median), o.n);
  pts = pts.map((p, i) => ({
    x: o.cx + (p.x - o.cx) * o.scale + o.dx + o.wobble * Math.sin(i * 1.7 + o.dx),
    y: o.cy + (p.y - o.cy) * o.scale + o.dy + o.wobble * Math.cos(i * 2.3 + o.dy),
  }));
  if (o.cut < 1) pts = pts.slice(0, Math.max(1, Math.round(pts.length * o.cut)));
  if (o.reverse) pts = pts.reverse();
  return pts;
}

function randomOpts(kind: string): DrawOpts {
  const big = kind === 'sloppy';
  return {
    dx: between(-40, 40) * (big ? 2.5 : 1),
    dy: between(-40, 40) * (big ? 2.5 : 1),
    wobble: between(0, big ? 30 : 12),
    n: int(6, 60),
    scale: kind === 'small' ? between(0.6, 0.85) : big ? between(0.7, 1.3) : between(0.92, 1.08),
    cx: 512,
    cy: 388,
    cut: kind === 'short' ? between(0.25, 0.6) : 1,
    reverse: kind === 'reversed',
  };
}

function scribble(): Point[] {
  const n = int(2, 40);
  let x = between(0, 1024);
  let y = between(-124, 900);
  const out: Point[] = [{ x, y }];
  for (let i = 1; i < n; i++) {
    x += between(-80, 80);
    y += between(-80, 80);
    out.push({ x, y });
  }
  return out;
}

function tap(): Point[] {
  const x = between(100, 900);
  const y = between(0, 800);
  return [{ x, y }, { x: x + between(-5, 5), y: y + between(-5, 5) }, { x: x + 3, y }];
}

const round = (p: Point): [number, number] => [p.x, p.y];

// ---------------- matchStroke cases ----------------

const KINDS = ['right', 'right', 'sloppy', 'small', 'reversed', 'short', 'later', 'earlier', 'scribble', 'tap', 'duplicate'];
const matches: unknown[] = [];
for (const [c, data] of Object.entries(chars)) {
  const n = data.medians.length;
  const perChar = FIXED.includes(c) ? 60 : 24;
  for (let k = 0; k < perChar; k++) {
    const expected = int(0, n - 1);
    const kind = KINDS[int(0, KINDS.length - 1)];
    let points: Point[];
    switch (kind) {
      case 'later': {
        const j = expected + 1 < n ? int(expected + 1, n - 1) : expected;
        points = draw(data.medians[j], randomOpts('right'));
        break;
      }
      case 'earlier': {
        const j = expected > 0 ? int(0, expected - 1) : expected;
        points = draw(data.medians[j], randomOpts('right'));
        break;
      }
      case 'scribble':
        points = scribble();
        break;
      case 'tap':
        points = tap();
        break;
      case 'duplicate': {
        const base = draw(data.medians[expected], randomOpts('right'));
        points = base.flatMap((p) => [p, { ...p }]);
        break;
      }
      default:
        points = draw(data.medians[expected], randomOpts(kind));
    }
    const leniency = [1, 1, 1, 0.8, 1.25, 1.5][int(0, 5)];
    const outlineVisible = rand() < 0.5;
    const options = rand() < 0.15 ? {} : { leniency, outlineVisible };
    const m = matchStroke(points, data, expected, options);
    matches.push({
      char: c,
      expected,
      kind,
      options,
      points: points.map(round),
      verdict: m.verdict,
      matchedIndex: m.matchedIndex ?? null,
      avgDist: m.avgDist ?? null,
    });
  }
}
// out-of-range expected index and degenerate inputs
const 十 = chars['十'];
for (const [expected, points] of [
  [5, draw(十.medians[0], randomOpts('right'))],
  [-1, draw(十.medians[0], randomOpts('right'))],
  [0, [{ x: 10, y: 10 }]],
  [0, []],
] as [number, Point[]][]) {
  const m = matchStroke(points, 十, expected);
  matches.push({ char: '十', expected, kind: 'edge', options: {}, points: points.map(round), verdict: m.verdict, matchedIndex: m.matchedIndex ?? null, avgDist: m.avgDist ?? null });
}

// ---------------- quiz runs ----------------

type Action = { t: 'draw'; kind: string; points: [number, number][] } | { t: 'hint' } | { t: 'reveal' };

function feedbackJson(fb: ReturnType<typeof submitStroke>['feedback']) {
  const o: Record<string, unknown> = { kind: fb.kind };
  if (fb.kind === 'correct' || fb.kind === 'revealed') {
    o.index = fb.index;
    o.complete = fb.complete;
  }
  if (fb.kind === 'mistake') {
    o.verdict = fb.verdict;
    o.index = fb.index;
    o.matchedIndex = fb.matchedIndex ?? null;
    o.misses = fb.misses;
    o.hint = fb.hint;
    o.message = mistakeMessage(fb);
  }
  return o;
}

function resultJson(r: CharacterWritingResult) {
  return r; // plain JSON already (drawn = rounded ints)
}

const runs: unknown[] = [];
const runChars = Object.keys(chars);
for (let r = 0; r < 160; r++) {
  const c = runChars[int(0, runChars.length - 1)];
  const data = chars[c];
  const mode: WritingMode = rand() < 0.5 ? 'trace' : 'recall';
  const custom = rand() < 0.3;
  const options = custom
    ? { mode, leniency: [0.8, 1, 1.3][int(0, 2)], startHintAfter: int(1, 3), strokeHintAfter: int(2, 4), revealAfter: int(3, 6) }
    : { mode };
  let now = 1_790_000_000_000 + int(0, 1_000_000);
  let state: CharacterQuizState = createQuiz(c, data, options, now);
  const actions: unknown[] = [];
  const skill = rand(); // how often this "learner" draws the right stroke
  let guard = 0;
  while (state.current < data.medians.length && guard++ < 200) {
    now += int(80, 4000);
    const roll = rand();
    if (roll < 0.04) {
      state = requestHint(state);
      actions.push({ t: 'hint', now, hint: hintLevel(state), current: state.current });
      continue;
    }
    if (roll < 0.07) {
      state = revealStroke(state, now);
      actions.push({ t: 'reveal', now, current: state.current, finishedAt: state.finishedAt });
      continue;
    }
    let points: Point[];
    const i = state.current;
    let kind: string;
    if (rand() < skill) {
      kind = 'right';
      points = draw(data.medians[i], randomOpts(mode === 'recall' && rand() < 0.3 ? 'small' : 'right'));
    } else {
      const k = int(0, 4);
      kind = ['reversed', 'short', 'later', 'scribble', 'tap'][k];
      if (kind === 'later' && i + 1 < data.medians.length) points = draw(data.medians[int(i + 1, data.medians.length - 1)], randomOpts('right'));
      else if (kind === 'scribble') points = scribble();
      else if (kind === 'tap') points = tap();
      else points = draw(data.medians[i], randomOpts(kind === 'later' ? 'sloppy' : kind));
    }
    const res = submitStroke(state, points, now);
    state = res.state;
    actions.push({
      t: 'draw',
      kind,
      now,
      points: points.map(round),
      feedback: feedbackJson(res.feedback),
      hint: hintLevel(state),
      current: state.current,
      misses: state.pending.misses,
    });
  }
  // sometimes abandon half-way (unfinished characters grade as practice)
  const endNow = now + int(0, 5000);
  const summary = summarizeCharacter(state, endNow);
  runs.push({ char: c, options, startedAt: state.startedAt, actions, summary: resultJson(summary), endNow });
}

// A few abandoned runs: stop after a couple of strokes.
for (let r = 0; r < 12; r++) {
  const c = FIXED[r % FIXED.length];
  const data = chars[c];
  if (!data || data.medians.length < 3) continue;
  let now = 1_790_000_000_000;
  let state = createQuiz(c, data, { mode: 'recall' }, now);
  const actions: unknown[] = [];
  for (let s = 0; s < 2; s++) {
    now += 900;
    const points = draw(data.medians[s], randomOpts('right'));
    const res = submitStroke(state, points, now);
    state = res.state;
    actions.push({ t: 'draw', kind: 'right', now, points: points.map(round), feedback: feedbackJson(res.feedback), hint: hintLevel(state), current: state.current, misses: state.pending.misses });
  }
  runs.push({ char: c, options: { mode: 'recall' }, startedAt: state.startedAt, actions, summary: summarizeCharacter(state, now + 1000), endNow: now + 1000 });
}

// ---------------- exercises (word level) ----------------

const exercises: unknown[] = [];
const summaries = (runs as { summary: CharacterWritingResult }[]).map((r) => r.summary);
for (let e = 0; e < 60; e++) {
  const k = int(0, 4);
  const picked = Array.from({ length: k }, () => summaries[int(0, summaries.length - 1)]);
  const mode: WritingMode = rand() < 0.5 ? 'trace' : 'recall';
  const text = picked.map((p) => p.character).join('') || '';
  const skipped = rand() < 0.2 ? ['〇'] : [];
  const ex = summarizeExercise(text, mode, picked, skipped, 1_790_000_000_000, 1_790_000_060_000);
  exercises.push({ characters: picked.map((p) => runs.indexOf(runs.find((r) => (r as { summary: unknown }).summary === p)!)), mode, text, skipped, grade: ex.grade, writtenFromMemory: writtenFromMemory(ex) });
}

// ---------------- geometry + data helpers ----------------

const geometry: unknown[] = [];
for (let g = 0; g < 200; g++) {
  const a = scribble();
  const b = rand() < 0.5 ? scribble() : a.map((p) => ({ x: p.x + between(-20, 20), y: p.y + between(-20, 20) }));
  const n = int(2, 30);
  geometry.push({
    a: a.map(round),
    b: b.map(round),
    n,
    pathLength: pathLength(a),
    resample: resample(a, n).map(round),
    normalize: normalizeShape(a).map(round),
    frechet: frechet(a, b),
    meanNearest: meanNearestDistance(a, b),
    shape: shapeDistance(a, b),
    direction: directionSimilarity(a, b),
    compact: compactStroke(a),
    compact5: compactStroke(a, 5),
  });
}
const hypots: number[][] = [];
for (let h = 0; h < 400; h++) {
  const x = between(-1200, 1200) * (rand() < 0.1 ? 1e-6 : 1);
  const y = between(-1200, 1200);
  hypots.push([x, y, Math.hypot(x, y)]);
}
hypots.push([0, 0, Math.hypot(0, 0)], [3, 4, Math.hypot(3, 4)], [-0, 5, Math.hypot(-0, 5)]);

const dataHelpers = Object.entries(chars).slice(0, 40).map(([c, d]) => ({
  char: c,
  file: strokeDataFile(c),
  starts: d.medians.map((m) => {
    const s = strokeStart(m);
    return [s.start.x, s.start.y, s.dir.x, s.dir.y];
  }),
  brush: d.medians.map((m) => {
    const b = brushPath(m);
    return [b.d, b.length];
  }),
  medianPath: medianPath(d.medians[0]),
  medianLength: medianLength(d.medians[0]),
}));

const parse = [
  { json: { strokes: ['M 0 0'], medians: [[[1, 2], [3, 4]]] }, ok: true },
  { json: { strokes: ['M 0 0'], medians: [[[1, 2], [3, 4]]], radStrokes: [0, 'x', 2] }, ok: true },
  { json: { strokes: [], medians: [] }, ok: false },
  { json: { strokes: ['a', 'b'], medians: [[[1, 2]]] }, ok: false },
  { json: { strokes: [1], medians: [[[1, 2]]] }, ok: false },
  { json: { strokes: ['a'], medians: [[[1]]] }, ok: false },
  { json: { strokes: ['a'], medians: [[]] }, ok: false },
  { json: { strokes: ['a'], medians: [[['1', 2]]] }, ok: false },
  { json: '<!doctype html>', ok: false },
  { json: null, ok: false },
  { json: [1, 2], ok: false },
].map((p) => {
  const r = parseCharStrokeData(p.json);
  return { json: p.json, ok: r !== null, radStrokes: r?.radStrokes ?? null };
});

const writable = ['你好', 'Hello 世界!', '一、二。三', '〇〆々', '𠀀好', '', 'abc', '中国人', '謝謝', '了吗？'].map((t) => ({ text: t, chars: writableCharacters(t) }));

writeFileSync(
  join(OUT, 'strokes.json'),
  JSON.stringify({ chars, matches, runs, exercises, geometry, hypots, dataHelpers, parse, writable }),
);
