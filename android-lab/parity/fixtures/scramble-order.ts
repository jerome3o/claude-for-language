/**
 * Golden vectors for rearranging a word order by hand (shared/lesson/scrambleOrder.ts): wrapped rows and the drop
 * slot over random flowing layouts (left-aligned and centred lines, like the web's flex-wrap and the Lab's FlowRow),
 * the zone, preview / drop of random drags, insert / remove / move / nudge and the a11y words. Writes
 * scramble-order.json; checked by core/…/ScrambleOrderParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  scrambleDrop, scrambleDropSlot, scrambleInsertAt, scrambleMoveTo, scrambleMovedAnnouncement, scrambleNudge, scramblePreview,
  scrambleRemoveAt, scrambleRows, scrambleTileLabel, scrambleZone, type ScrambleDrag, type ScrambleRect, type ScrambleZone,
} from '../../../shared/lesson/scrambleOrder';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: scramble-order <out-dir>');
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
const r = rng(20261117);
const int = (n: number) => Math.floor(r() * n);
const round = (v: number) => Math.round(v * 100) / 100;

/** Tiles of `widths` flowed into lines of `lineWidth` (gap 8, line gap 8), optionally centred per line. */
function flow(widths: number[], lineWidth: number, centred: boolean, height: number): ScrambleRect[] {
  const lines: number[][] = [[]];
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    if (x > 0 && x + w > lineWidth) {
      lines.push([]);
      x = 0;
    }
    lines[lines.length - 1].push(i);
    x += w + 8;
  }
  const out: ScrambleRect[] = new Array(widths.length);
  lines.forEach((line, li) => {
    const used = line.reduce((s, i) => s + widths[i], 0) + 8 * Math.max(0, line.length - 1);
    let left = 12 + (centred ? round((lineWidth - used) / 2) : 0);
    for (const i of line) {
      out[i] = { left, top: 100 + li * (height + 8), width: widths[i], height };
      left = round(left + widths[i] + 8);
    }
  });
  return out;
}

const slots = Array.from({ length: 300 }, () => {
  const n = int(9);
  const widths = Array.from({ length: n }, () => round(40 + r() * 140));
  const rects = flow(widths, round(200 + r() * 260), r() < 0.5, 44 + int(12));
  const x = round(-40 + r() * 560);
  const y = round(40 + r() * 320);
  return { rects, x, y, rows: scrambleRows(rects), slot: scrambleDropSlot(rects, x, y) };
});

const zones = Array.from({ length: 200 }, () => {
  const answer = r() < 0.1 ? null : { left: round(r() * 20), top: round(80 + r() * 40), width: round(300 + r() * 100), height: round(56 + r() * 120) };
  const pool = r() < 0.1 ? null : { left: round(r() * 20), top: round(260 + r() * 60), width: round(300 + r() * 100), height: round(56 + r() * 120) };
  const x = round(-60 + r() * 520);
  const y = round(r() * 520);
  const slack = r() < 0.3 ? round(r() * 40) : null;
  return { answer, pool, x, y, slack, zone: slack === null ? scrambleZone(answer, pool, x, y) : scrambleZone(answer, pool, x, y, slack) };
});

const ZONES: ScrambleZone[] = ['answer', 'pool', 'none'];
const drags = Array.from({ length: 300 }, () => {
  const tiles = 1 + int(8);
  const all = Array.from({ length: tiles }, (_, i) => i).sort(() => r() - 0.5);
  const order = all.slice(0, int(tiles + 1));
  const unplaced = all.filter(t => !order.includes(t));
  const roll = r();
  const drag: ScrambleDrag = order.length > 0 && (roll < 0.55 || unplaced.length === 0)
    ? { from: 'answer', index: roll < 0.03 ? order.length + 1 : int(order.length) }
    : { from: 'pool', tile: unplaced.length > 0 && roll < 0.95 ? unplaced[int(unplaced.length)] : (order[0] ?? 0) };
  const zone = ZONES[int(3)];
  const slot = int(order.length + 3) - 1;
  const valid = drag.from === 'pool' || (drag.index >= 0 && drag.index < order.length);
  return { order, drag, zone, slot, preview: valid ? scramblePreview(order, drag, zone, slot) : null, drop: scrambleDrop(order, drag, zone, slot) };
});

const edits = Array.from({ length: 200 }, () => {
  const order = Array.from({ length: int(7) }, () => int(10));
  const at = int(order.length + 4) - 2;
  const to = int(order.length + 4) - 2;
  const tile = int(10);
  const dir = r() < 0.5 ? -1 : 1;
  return {
    order, at, to, tile, dir,
    insert: scrambleInsertAt(order, tile, at),
    remove: scrambleRemoveAt(order, at),
    move: scrambleMoveTo(order, at, to),
    nudge: scrambleNudge(order, at, dir as -1 | 1),
  };
});

const words = ['他', ' 工作了 ', '十五年', 'a b', ''].flatMap(t => [0, 1, 5].map(i => ({
  text: t, index: i, count: 6, label: scrambleTileLabel(t, i, 6), moved: scrambleMovedAnnouncement(t, i, 6),
})));

writeFileSync(join(OUT, 'scramble-order.json'), JSON.stringify({ slots, zones, drags, edits, words }));
