/**
 * Video calls round 5: the tutor leads (shared/calls/follow.ts), mic / camera at the start of a call
 * (shared/calls/devices.ts) and the layout's `shown` action (shared/calls/layout.ts).
 * Writes calls-follow.json; checked by core/…/calls/CallsFollowParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoShowBoard,
  canShow,
  canStopShare,
  followStep,
  isShowing,
  nextShown,
  sanitizeShowView,
  shareStoppedNote,
  showingBanner,
  tileForShow,
  SHOW_BUTTON_LABEL,
  SHOWN_BUTTON_LABEL,
  STOP_THEIR_SHARE_LABEL,
  SHOW_KINDS,
  type AppliedShow,
  type ShowView,
  type ShownState,
} from '../../../shared/calls/follow';
import { announceDevice, deviceOnWhenOpened, CAMERA_ON_AT_START } from '../../../shared/calls/devices';
import { ALL_TILES, DEFAULT_LAYOUT, PRESETS, layoutReducer, type CallLayout, type LayoutAction, type TileId } from '../../../shared/calls/layout';

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
const r = rng(20261003);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// ---- sanitizeShowView: hand-picked + random raw values.
const raws: unknown[] = [
  null, undefined, 0, 'text', [], ['text'], {}, { kind: 1 }, { kind: 'board' }, { kind: 'TEXT' },
  { kind: 'text' }, { kind: 'text', page: '' }, { kind: 'text', page: 'p1' }, { kind: 'text', page: 7 },
  { kind: 'text', page: 'x'.repeat(64) }, { kind: 'text', page: 'x'.repeat(65) }, { kind: 'text', page: '页一' },
  { kind: 'draw', page: 'p1' }, { kind: 'material' }, { kind: 'screen', extra: true }, { kind: 'activity' }, { kind: 'remote' }, { kind: 'chat' },
];
for (let i = 0; i < 80; i++) {
  const kind = pick<unknown>([...SHOW_KINDS, 'self', 'remote', 'chat', 3, null]);
  const o: Record<string, unknown> = { kind };
  if (r() < 0.7) o.page = pick<unknown>(['p1', 'p2', '', 'q'.repeat(Math.floor(r() * 80)), 5, null]);
  raws.push(o);
}
const sanitize = raws.map((raw) => ({ raw: raw === undefined ? null : raw, result: sanitizeShowView(raw) }));

// ---- views and shown states used below.
const pages = ['p1', 'p2', 'p3'];
function randomView(): ShowView {
  const kind = pick(SHOW_KINDS);
  if (kind === 'text') return r() < 0.8 ? { kind: 'text', page: pick(pages) } : { kind: 'text' };
  return { kind } as ShowView;
}
const people = [
  { userId: 'tutor', name: 'Minghui' },
  { userId: 'student', name: 'Jerome' },
  { userId: 'tutor', name: '  ' },
];
let idN = 0;
const newId = () => `s${++idN}`;

const tileFor = SHOW_KINDS.map((kind) => ({ kind, tile: tileForShow({ kind } as ShowView) }));

// nextShown: random walks of show messages.
const nexts: unknown[] = [];
for (let s = 0; s < 40; s++) {
  let cur: ShownState | null = null;
  for (let i = 0; i < 8; i++) {
    const view = randomView();
    const by = pick(people);
    const follow = r() < 0.5;
    const now = 1_790_000_000_000 + i * 1000 + s;
    const before = cur;
    const idBefore = idN;
    cur = nextShown(cur, view, by, follow, now, newId);
    nexts.push({ cur: before, view, by: by.userId, name: by.name, follow, now, next_id: `s${idBefore + 1}`, result: cur });
  }
}

const permissions: unknown[] = [];
for (const sender of ['tutor', 'student', '']) for (const tutor of ['tutor', 'student', null, '']) for (const target of ['tutor', 'student', 'other']) {
  permissions.push({ sender, tutor, target, can_show: canShow(sender, tutor), can_stop: canStopShare(sender, tutor, target) });
}

// followStep: random applied / shown / me / available / onTile.
const follows: unknown[] = [];
for (let i = 0; i < 600; i++) {
  const shown: ShownState | null = r() < 0.1 ? null : { id: pick(['a', 'b', 'c']), v: 1 + Math.floor(r() * 4), by: pick(['tutor', 'student', 'me']), name: 'Minghui', view: randomView(), at: 5 };
  const applied: AppliedShow | null = r() < 0.25 ? null : { id: pick(['a', 'b', 'c']), v: 1 + Math.floor(r() * 4) };
  const myId = pick(['me', 'student', 'tutor']);
  const available = r() < 0.7;
  const onTile = r() < 0.6;
  follows.push({ applied, shown, my_id: myId, available, on_tile: onTile, result: followStep(applied, shown, myId, available, onTile) });
}

// Page turns: the same show, a text view, a higher (or not) v.
for (let i = 0; i < 200; i++) {
  const v = 1 + Math.floor(r() * 4);
  const view: ShowView = r() < 0.85 ? { kind: 'text', page: pick(pages) } : r() < 0.5 ? { kind: 'text' } : randomView();
  const shown: ShownState = { id: 'a', v, by: 'tutor', name: 'Minghui', view, at: 9 };
  const applied: AppliedShow = { id: 'a', v: 1 + Math.floor(r() * 4) };
  const myId = r() < 0.9 ? 'student' : 'tutor';
  const available = r() < 0.8;
  const onTile = r() < 0.6;
  follows.push({ applied, shown, my_id: myId, available, on_tile: onTile, result: followStep(applied, shown, myId, available, onTile) });
}

const names = ['Minghui', '  Minghui  ', '', '   ', ' ', '﻿王老师﻿', '王老师', '\tMing\n'];
const banners = names.map((name) => ({ name, banner: showingBanner(name), note: shareStoppedNote(name) }));

const showings: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const shown: ShownState | null = r() < 0.1 ? null : { id: 'x', v: 1, by: pick(['tutor', 'student']), name: 'M', view: randomView(), at: 1 };
  const myId = pick(['tutor', 'student']);
  const view = randomView();
  showings.push({ shown, my_id: myId, view, result: isShowing(shown, myId, view) });
}

const stageTiles: TileId[] = ['remote', 'self', 'text', 'draw', 'chat', 'screen', 'material', 'activity'];
const autos: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const was = stageTiles.filter(() => r() < 0.3);
  const now = stageTiles.filter(() => r() < 0.3);
  autos.push({ was, now, result: autoShowBoard(was, now) });
}

// ---- devices.ts
const devices: unknown[] = [];
for (const device of ['mic', 'cam'] as const) for (const restore of [false, true]) for (const micOff of [false, true]) devices.push({ device, restore, mic_off: micOff, result: deviceOnWhenOpened(device, restore, micOff) });
const phases = ['prejoin', 'joining', 'live', 'left', 'ended', 'error', ''].map((phase) => ({ phase, result: announceDevice(phase) }));

// ---- layout: the `shown` action from random layouts (walks like calls-layout.ts, own RNG).
const corners = ['tl', 'tr', 'bl', 'br'] as const;
function randomAction(): LayoutAction {
  return pick<LayoutAction>([
    { type: 'focus', tile: pick(ALL_TILES) },
    { type: 'preset', preset: pick(PRESETS.map((p) => p.id)) },
    { type: 'split', a: pick(ALL_TILES), b: pick(ALL_TILES) },
    { type: 'close', tile: pick(ALL_TILES) },
    { type: 'open', tile: pick(ALL_TILES) },
    { type: 'remoteFloat', on: r() < 0.5 },
    { type: 'pairCorner', corner: pick(corners) },
    { type: 'shareStarted' },
    { type: 'materialStarted' },
    { type: 'activityStarted' },
    { type: 'shown', tile: pick(ALL_TILES) },
  ]);
}
const shownLayouts: unknown[] = [];
for (let s = 0; s < 60; s++) {
  let l: CallLayout = DEFAULT_LAYOUT;
  const steps: unknown[] = [];
  const n = 2 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a: LayoutAction = r() < 0.4 ? { type: 'shown', tile: pick(['text', 'draw', 'material', 'screen', 'activity'] as TileId[]) } : randomAction();
    l = layoutReducer(l, a);
    steps.push({ action: a, layout: l });
  }
  shownLayouts.push({ steps });
}

writeFileSync(
  join(OUT, 'calls-follow.json'),
  JSON.stringify({
    labels: { show: SHOW_BUTTON_LABEL, shown: SHOWN_BUTTON_LABEL, stop: STOP_THEIR_SHARE_LABEL },
    kinds: SHOW_KINDS,
    sanitize,
    tile_for: tileFor,
    nexts,
    permissions,
    follows,
    banners,
    showings,
    autos,
    devices,
    phases,
    camera_on_at_start: CAMERA_ON_AT_START,
    shown_layouts: shownLayouts,
  }),
);
