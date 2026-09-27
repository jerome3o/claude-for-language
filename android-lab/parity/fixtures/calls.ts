/**
 * Package J golden vectors: the video-call whiteboard ops and transcript helpers
 * (shared/calls/board.ts, shared/calls/transcript.ts). Writes calls.json; checked by
 * core/…/calls/CallsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyBoardOp, lastItemBy, sanitizeBoardOp, BOARD_COLORS, type BoardItem, type BoardOp } from '../../../shared/calls/board';
import { formatOffset, groupTurns, mergeTranscript } from '../../../shared/calls/transcript';

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
const r = rng(20260927);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const num = () => pick([() => r(), () => r() * 3 - 1, () => Math.round(r() * 100) / 7, () => 0, () => 1, () => -0.5, () => 1.00004999, () => 0.123456789])();
const id = () => pick(['a', 'b1', 'x'.repeat(64), 'x'.repeat(65), '', 'stroke-' + Math.floor(r() * 50), 'T' + Math.floor(r() * 9)]);

// ---- sanitize: well-formed, edge and junk inputs
const raws: unknown[] = [
  null, 42, 'stroke', [], {}, { type: 'nope' }, { type: 'clear' }, { type: 'clear', by: 'mallory' },
  { type: 'delete' }, { type: 'delete', id: '' }, { type: 'delete', id: 'abc' }, { type: 'delete', id: 'y'.repeat(65) },
  { type: 'stroke', id: 's', color: '#1f2937', width: 10, points: [] },
  { type: 'stroke', id: 's', color: '#1f2937', width: 0, points: [[0.1, 0.2]] },
  { type: 'stroke', id: 's', color: '#1f2937', width: 81, points: [[0.1, 0.2]] },
  { type: 'stroke', id: 's', color: '#1f2937', width: '12', points: [[0.1, 0.2]] },
  { type: 'stroke', id: 's', color: 'red', width: 10, points: [[0.1, 0.2]] },
  { type: 'stroke', id: 's', color: '#12345G', width: 10, points: [[0.1, 0.2]] },
  { type: 'stroke', id: 's', color: '#ABCDEF', width: 10, points: [[0.1], 'x', [null, 0.5], ['0.25', '0.75'], [2, -3], [0.123456, 0.987654321]] },
  { type: 'stroke', id: 's', color: '#abcdef', width: 10, points: [['a', 1]] },
  { type: 'stroke', id: 's', color: '#abcdef', width: 10, points: Array.from({ length: 4100 }, (_, i) => [i / 4100, 1 - i / 4100]) },
  { type: 'text', id: 't', color: '#dc2626', x: 0.5, y: 0.5, size: 80, text: '  你好  ' },
  { type: 'text', id: 't', color: '#dc2626', x: 0.5, y: 0.5, size: 7, text: '你好' },
  { type: 'text', id: 't', color: '#dc2626', x: 0.5, y: 0.5, size: 201, text: '你好' },
  { type: 'text', id: 't', color: '#dc2626', x: 0.5, y: 0.5, size: 80, text: '   ' },
  { type: 'text', id: 't', color: '#dc2626', x: 'a', y: 0.5, size: 80, text: 'x' },
  { type: 'text', id: 't', color: '#dc2626', x: 1.5, y: -2, size: '40', text: '多'.repeat(600) },
  { type: 'text', id: 't', color: '#dc2626', x: null, y: 0.5, size: 80, text: 'null x is 0' },
  { type: 'text', id: 't', color: '#dc2626', y: 0.5, size: 80, text: 'missing x' },
  { type: 'text', id: 't', color: '#dc2626', x: true, y: 0.5, size: 80, text: 'true x is 1' },
];
for (let i = 0; i < 300; i++) {
  const t = pick(['stroke', 'text', 'delete', 'clear']);
  if (t === 'stroke') raws.push({ type: t, id: id(), color: pick([...BOARD_COLORS, 'nope']), width: pick([1, 10, 80, 0.5, 90, -1]), points: Array.from({ length: Math.floor(r() * 6) }, () => [num(), num()]) });
  else if (t === 'text') raws.push({ type: t, id: id(), color: pick([...BOARD_COLORS, '#fff']), x: num(), y: num(), size: pick([8, 80, 200, 7.5, 12.5]), text: pick(['你好', ' 我是学生 ', '', 'line one\nline two']) });
  else raws.push({ type: t, id: id(), by: 'spoofed' });
}
const sanitize = raws.map((raw) => ({ raw, by: 'u1', result: sanitizeBoardOp(raw, 'u1') }));

// ---- apply sequences (incl. past MAX_BOARD_OPS) + lastItemBy
function randomOp(users: string[]): BoardOp {
  const by = pick(users);
  const t = r();
  if (t < 0.55) return { type: 'stroke', id: 'i' + Math.floor(r() * 40), by, color: pick(BOARD_COLORS), width: 10, points: [[r(), r()]] };
  if (t < 0.8) return { type: 'text', id: 'i' + Math.floor(r() * 40), by, color: pick(BOARD_COLORS), x: r(), y: r(), size: 80, text: '字' };
  if (t < 0.97) return { type: 'delete', id: 'i' + Math.floor(r() * 40), by };
  return { type: 'clear', by };
}
const sequences: unknown[] = [];
for (let s = 0; s < 40; s++) {
  const ops = Array.from({ length: 5 + Math.floor(r() * 60) }, () => randomOp(['u1', 'u2']));
  let items: BoardItem[] = [];
  const steps = ops.map((op) => {
    items = applyBoardOp(items, op);
    return { ids: items.map((x) => x.id), last_u1: lastItemBy(items, 'u1'), last_u2: lastItemBy(items, 'u2') };
  });
  sequences.push({ ops, steps });
}
{
  // 2100 distinct items: the oldest are dropped at MAX_BOARD_OPS.
  const ops: BoardOp[] = Array.from({ length: 2100 }, (_, i) => ({ type: 'text', id: 'n' + i, by: 'u1', color: '#1f2937', x: 0, y: 0, size: 80, text: String(i) }));
  let items: BoardItem[] = [];
  for (const op of ops) items = applyBoardOp(items, op);
  sequences.push({ ops, steps: [{ final: true, ids: items.map((x) => x.id), last_u1: lastItemBy(items, 'u1'), last_u2: lastItemBy(items, 'u2') }] });
}

// ---- transcript
const offsets = [-5000, 0, 999, 1000, 59_999, 60_000, 65_432, 3_599_999, 3_600_000, 3_723_000, 36_000_000 + 61_000, 1.5, 999.9];
const formatted = offsets.map((ms) => ({ ms, text: formatOffset(ms) }));
const alnum = 'abcdefABCDEF0123456789';
const transcripts: unknown[] = [];
for (let s = 0; s < 60; s++) {
  const segs = Array.from({ length: Math.floor(r() * 25) }, () => {
    const start = Math.floor(r() * 40) * 500;
    return {
      id: Array.from({ length: 1 + Math.floor(r() * 3) }, () => alnum[Math.floor(r() * alnum.length)]).join(''),
      user_id: pick(['u1', 'u2']),
      start_ms: start,
      end_ms: start + Math.floor(r() * 8) * 500,
    };
  });
  const merged = mergeTranscript(segs);
  const gap = pick([2500, 0, 1000, 10_000]);
  transcripts.push({ segments: segs, gap, merged: merged.map((x) => x.id + '@' + x.start_ms + '-' + x.end_ms + ':' + x.user_id), turns: groupTurns(merged, gap).map((t) => t.length) });
}

writeFileSync(join(OUT, 'calls.json'), JSON.stringify({ sanitize, sequences, formatted, transcripts }));
