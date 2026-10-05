/**
 * Video calls "Same view" (shared/calls/view.ts): the shared stage, the room's record of it, what each
 * device does with it, and the words. Writes calls-view.json; checked by core/…/calls/CallsViewParityTest.kt.
 *
 * Layouts come from random action walks from DEFAULT_LAYOUT (every action type, random ratios), so
 * viewOf / applyView see odd ratios, splits, grids and per-device choices.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyView,
  bringLabel,
  inviteText,
  nextSharedView,
  ownViewHint,
  sameStage,
  sameViewHint,
  sanitizeStageView,
  shouldSendView,
  theyLookAroundText,
  viewChipLabel,
  viewForShow,
  viewOf,
  viewStep,
  OWN_VIEW_LABEL,
  SAME_VIEW_LABEL,
  type SharedView,
  type StageView,
  type ViewMode,
} from '../../../shared/calls/view';
import * as viewNs from '../../../shared/calls/view';
import { SHOW_KINDS, type ShowView } from '../../../shared/calls/follow';
import { ALL_TILES, DEFAULT_LAYOUT, DROP_ZONES, PRESETS, layoutReducer, type CallLayout, type LayoutAction, type TileId } from '../../../shared/calls/layout';

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
const r = rng(20261005);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const corners = ['tl', 'tr', 'bl', 'br'] as const;

function randomAction(): LayoutAction {
  return pick<LayoutAction>([
    { type: 'focus', tile: pick(ALL_TILES) },
    { type: 'preset', preset: pick(PRESETS.map((p) => p.id)) },
    { type: 'split', a: pick(ALL_TILES), b: pick(ALL_TILES) },
    { type: 'swap', from: pick(ALL_TILES), to: pick(ALL_TILES) },
    { type: 'ratio', ratio: r() * 1.2 - 0.1 },
    { type: 'dir', dir: r() < 0.5 ? 'row' : 'column' },
    { type: 'close', tile: pick(ALL_TILES) },
    { type: 'open', tile: pick(ALL_TILES) },
    { type: 'remoteFloat', on: r() < 0.5 },
    { type: 'selfCorner', corner: pick(corners) },
    { type: 'selfScale', scale: 0.5 + r() * 2 },
    { type: 'pip', pip: r() < 0.5 ? 'pair' : 'separate' },
    { type: 'pairCorner', corner: pick(corners) },
    { type: 'pairScale', scale: 0.5 + r() * 2 },
    { type: 'pairTap' },
    { type: 'shareStarted' },
    { type: 'materialStarted' },
    { type: 'activityStarted' },
    { type: 'drop', tile: pick(ALL_TILES), zone: pick(DROP_ZONES) },
  ]);
}

function randomLayout(): CallLayout {
  let l: CallLayout = DEFAULT_LAYOUT;
  const n = Math.floor(r() * 9);
  for (let i = 0; i < n; i++) l = layoutReducer(l, randomAction());
  return l;
}

const pages = [null, '', 'p1', 'p2', 'p3'];
const randomPage = () => pick(pages);

// ---- viewOf / applyView over random layouts.
const views: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const l = randomLayout();
  const page = randomPage();
  views.push({ layout: l, page, result: viewOf(l, page) });
}
const applies: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const mine = randomLayout();
  const view: StageView = r() < 0.8 ? viewOf(randomLayout(), randomPage()) : { ...viewOf(randomLayout(), null), ratio: r() * 1.4 - 0.2, open: ALL_TILES.filter(() => r() < 0.4) };
  applies.push({ layout: mine, view, result: applyView(mine, view) });
}

// ---- sameStage: a view against mutations of itself and against unrelated views.
function mutate(v: StageView): StageView {
  switch (Math.floor(r() * 9)) {
    case 0: return { ...v, mode: pick(['focus', 'split', 'grid'] as const) };
    case 1: return { ...v, main: pick(ALL_TILES) };
    case 2: return { ...v, second: pick(ALL_TILES) };
    case 3: return { ...v, ratio: v.ratio + pick([0.001, -0.004, 0.005, 0.0051, -0.006, 0.2]) };
    case 4: return { ...v, dir: v.dir === 'row' ? 'column' : 'row' };
    case 5: return { ...v, open: ALL_TILES.filter(() => r() < 0.5) };
    case 6: return { ...v, page: randomPage() };
    case 7: return { ...v, open: [...v.open].reverse() };
    default: return { ...v };
  }
}
const sames: unknown[] = [];
for (let i = 0; i < 600; i++) {
  const a = viewOf(randomLayout(), randomPage());
  const b = r() < 0.75 ? mutate(r() < 0.5 ? a : mutate(a)) : viewOf(randomLayout(), randomPage());
  sames.push({ a, b, result: sameStage(a, b) });
}

// ---- sanitizeStageView: hand-picked + random raw values.
const raws: unknown[] = [
  null, 0, 'focus', [], ['focus'], {}, { mode: 'focus' }, { mode: 'focus', main: 'nope' }, { mode: 'wide', main: 'text' },
  { mode: 'focus', main: 'text' }, { mode: 'FOCUS', main: 'text' }, { mode: 'split', main: 'text', second: 'screen', ratio: 5, dir: 'column', open: ['chat', 'bogus'], page: 'p1' },
  { mode: 'grid', main: 'chat', ratio: '0.5' }, { mode: 'grid', main: 'chat', ratio: 0.33333 }, { mode: 'grid', main: 'chat', ratio: 0.1 },
  { mode: 'focus', main: 'text', page: 'x'.repeat(64) }, { mode: 'focus', main: 'text', page: 'x'.repeat(65) }, { mode: 'focus', main: 'text', page: '' },
  { mode: 'focus', main: 'text', page: 7 }, { mode: 'focus', main: 'text', open: 'chat' }, { mode: 'focus', main: 'text', open: [1, null, 'draw', 'draw'] },
  { mode: 'focus', main: 'text', dir: 'COLUMN' }, { mode: 'focus', main: 'text', ratio: null }, { mode: 'focus', main: 'text', ratio: true }, { mode: true, main: 'text' },
  { mode: 'focus', main: 'text', second: 3 }, { mode: 'focus', main: 'text', page: '页一' },
];
for (let i = 0; i < 150; i++) {
  const o: Record<string, unknown> = {};
  if (r() < 0.9) o.mode = pick<unknown>(['focus', 'split', 'grid', 'nope', 1]);
  if (r() < 0.9) o.main = pick<unknown>([...ALL_TILES, 'nope', null]);
  if (r() < 0.7) o.second = pick<unknown>([...ALL_TILES, 'x', 2]);
  if (r() < 0.7) o.ratio = pick<unknown>([r(), r() * 3 - 1, '0.4', null, 0.62]);
  if (r() < 0.6) o.dir = pick<unknown>(['row', 'column', 'col', 0]);
  if (r() < 0.7) o.open = r() < 0.8 ? ALL_TILES.filter(() => r() < 0.4).concat(r() < 0.2 ? ['bogus' as TileId] : []) : pick<unknown>(['text', 5, null]);
  if (r() < 0.6) o.page = pick<unknown>(['p1', '', 'q'.repeat(Math.floor(r() * 80)), 5, null]);
  raws.push(o);
}
const sanitize = raws.map((raw) => ({ raw, result: sanitizeStageView(raw) }));

// ---- nextSharedView: random walks.
const people = [
  { userId: 'tutor', name: 'Minghui' },
  { userId: 'student', name: 'Jerome Swannack' },
];
const nexts: unknown[] = [];
for (let s = 0; s < 40; s++) {
  let cur: SharedView | null = null;
  for (let i = 0; i < 8; i++) {
    const view = viewOf(randomLayout(), r() < 0.5 ? null : randomPage());
    const by = pick(people);
    const cid = r() < 0.1 ? 'c'.repeat(70 + Math.floor(r() * 10)) : `c${s}-${i}`;
    const bring = r() < 0.3;
    const now = 1_790_000_000_000 + i * 1000 + s;
    const before = cur;
    cur = nextSharedView(cur, view, by, cid, bring, now);
    nexts.push({ cur: before, view, by: by.userId, name: by.name, cid, bring, now, result: cur });
  }
}

// ---- viewForShow.
function randomShow(): ShowView {
  const kind = pick(SHOW_KINDS);
  if (kind === 'text') return r() < 0.7 ? { kind: 'text', page: pick(['p1', 'p2', 'p3']) } : { kind: 'text' };
  return { kind } as ShowView;
}
const shows: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const cur = r() < 0.2 ? null : viewOf(randomLayout(), randomPage());
  const show = randomShow();
  shows.push({ cur, show, result: viewForShow(cur, show) });
}

// ---- viewStep / shouldSendView.
const steps: unknown[] = [];
const modes: ViewMode[] = ['same', 'own'];
for (let i = 0; i < 800; i++) {
  const view: SharedView | null = r() < 0.08 ? null : {
    ...viewOf(randomLayout(), randomPage()),
    seq: 1 + Math.floor(r() * 5),
    by: pick(['me', 'them']),
    name: 'Minghui',
    cid: pick(['c1', 'c2', 'c3']),
    at: 5,
    ...(r() < 0.4 ? { bring: true } : {}),
  };
  const myId = pick(['me', 'them']);
  const lastSentCid = pick([null, 'c1', 'c2', 'c3']);
  const mode = pick(modes);
  const appliedSeq = Math.floor(r() * 5);
  steps.push({ view, my_id: myId, last_sent_cid: lastSentCid, mode, applied_seq: appliedSeq, result: viewStep(view, { myId, lastSentCid, mode, appliedSeq }) });
}
const sends: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const mine = viewOf(randomLayout(), randomPage());
  const known = r() < 0.15 ? null : r() < 0.6 ? mutate(mine) : viewOf(randomLayout(), randomPage());
  const mode = pick(modes);
  sends.push({ mode, known, mine, result: shouldSendView(mode, known, mine) });
}

// ---- words.
const names = ['Minghui', 'Jerome Swannack', '  Minghui  Wang ', '', '   ', '﻿王老师﻿', '王老师 老师', '\tMing\nHui', 'A B', 'x　y'];
const words = names.map((name) => ({
  name,
  same_hint: sameViewHint(name),
  own_hint: ownViewHint(name),
  bring: bringLabel(name),
  invite: inviteText(name),
  around: theyLookAroundText(name),
}));

// ---- the 📝 / 💬 guard: a tile they just put on my stage isn't toggled away by my press.
// (Read through the namespace: the guard landed in view.ts after the rest of "Same view".)
type Theirs = { at: number; tiles: TileId[] };
const ns = viewNs as unknown as {
  JUST_SHARED_MS: number;
  keepJustShared: (theirs: Theirs | null, tile: TileId, now: number) => boolean;
  stageTilesOf: (v: StageView) => TileId[];
  theirLastView: (before: StageView, after: StageView, now: number) => Theirs;
};
const tilesOf: unknown[] = [];
const lastViews: unknown[] = [];
const keeps: unknown[] = [];
if (typeof ns.keepJustShared === 'function') {
  for (let i = 0; i < 300; i++) {
    const v = viewOf(randomLayout(), randomPage());
    tilesOf.push({ view: v, result: ns.stageTilesOf(v) });
  }
  for (let i = 0; i < 300; i++) {
    const before = viewOf(randomLayout(), randomPage());
    const after = r() < 0.2 ? { ...before, page: randomPage() } : viewOf(randomLayout(), randomPage());
    const now = 1_790_000_000_000 + Math.floor(r() * 10_000);
    lastViews.push({ before, after, now, result: ns.theirLastView(before, after, now) });
  }
  for (let i = 0; i < 500; i++) {
    const theirs: Theirs | null = r() < 0.1 ? null : { at: 1_790_000_000_000, tiles: ALL_TILES.filter(() => r() < 0.3) };
    const tile = pick(['text', 'draw', 'chat', 'remote'] as TileId[]);
    const now = 1_790_000_000_000 + pick([-5, 0, 1, 2999, 3000, 3001, Math.floor(r() * 6000)]);
    keeps.push({ theirs, tile, now, result: ns.keepJustShared(theirs, tile, now) });
  }
}

writeFileSync(
  join(OUT, 'calls-view.json'),
  JSON.stringify({
    labels: { same: SAME_VIEW_LABEL, own: OWN_VIEW_LABEL, chip_same: viewChipLabel('same'), chip_own: viewChipLabel('own') },
    views,
    applies,
    sames,
    sanitize,
    nexts,
    shows,
    steps,
    sends,
    words,
    just_shared_ms: typeof ns.keepJustShared === 'function' ? ns.JUST_SHARED_MS : null,
    tiles_of: tilesOf,
    last_views: lastViews,
    keeps,
  }),
);
