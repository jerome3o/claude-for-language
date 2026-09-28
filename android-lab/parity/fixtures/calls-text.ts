/**
 * Package J golden vectors: the shared text board CRDT (shared/calls/textDoc.ts).
 * Writes calls-text.json; checked by core/…/calls/CallsTextParityTest.kt.
 *
 * `scripts` are recorded simulations of three people typing at once through a room:
 * every local edit (with the op it produced) and every delivery, in order, plus the
 * text after each step and every replica's snapshot at the end. The Kotlin port
 * replays the same script and must produce the same ops, texts and snapshots.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  TextDoc,
  charToCodeUnitIndex,
  codeUnitToCharIndex,
  diffChars,
  presenceColor,
  sanitizeTextOp,
  type TextOp,
} from '../../../shared/calls/textDoc';

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

type Step =
  | { kind: 'ins'; who: number; index: number; text: string; op: TextOp | null; after: string }
  | { kind: 'del'; who: number; index: number; count: number; op: TextOp | null; after: string }
  | { kind: 'replace'; who: number; next: string; caret: number | null; ops: TextOp[]; after: string }
  | { kind: 'to_room'; from: number; op: TextOp; after: string }
  | { kind: 'to_client'; to: number; op: TextOp; after: string }
  | { kind: 'anchor'; who: number; index: number; anchor: unknown; back: number };

function script(seed: number, steps: number) {
  const r = rng(seed);
  const sites = ['u1:aa', 'u2:bb', 'u3:cc'];
  const docs = sites.map((s) => new TextDoc(s));
  const room = new TextDoc('room');
  const up: TextOp[][] = sites.map(() => []);
  const down: TextOp[][] = sites.map(() => []);
  const origin = new Map<TextOp, number>();
  const out: Step[] = [];
  const alphabet = ['a', 'b', '你', '好', ' ', '\n', '😀', '了'];

  const pump = (n: number) => {
    for (let m = 0; m < n; m++) {
      const k = Math.floor(r() * sites.length);
      if (r() < 0.5 && up[k].length) {
        const op = up[k].shift()!;
        room.apply(op);
        out.push({ kind: 'to_room', from: k, op, after: room.text() });
        sites.forEach((_, j) => j !== origin.get(op) && down[j].push(op));
      } else if (down[k].length) {
        const op = down[k].shift()!;
        docs[k].apply(op);
        out.push({ kind: 'to_client', to: k, op, after: docs[k].text() });
      }
    }
  };
  const queue = (k: number, op: TextOp | null) => {
    if (!op) return;
    origin.set(op, k);
    up[k].push(op);
  };

  for (let s = 0; s < steps; s++) {
    const k = Math.floor(r() * sites.length);
    const d = docs[k];
    const len = d.length;
    const roll = r();
    if (roll < 0.5 || len === 0) {
      const n = 1 + Math.floor(r() * (r() < 0.1 ? 10 : 3));
      const text = Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
      const index = Math.floor(r() * (len + 2));
      const op = d.localInsert(index, text);
      out.push({ kind: 'ins', who: k, index, text, op, after: d.text() });
      queue(k, op);
    } else if (roll < 0.8) {
      const index = Math.floor(r() * len);
      const count = 1 + Math.floor(r() * 4);
      const op = d.localDelete(index, count);
      out.push({ kind: 'del', who: k, index, count, op, after: d.text() });
      queue(k, op);
    } else if (roll < 0.93) {
      const t = Array.from(d.text());
      const at = Math.floor(r() * (t.length + 1));
      t.splice(at, Math.floor(r() * 3), ...Array.from(r() < 0.5 ? '换' : 'aa'));
      const next = t.join('');
      const caret = r() < 0.7 ? charToCodeUnitIndex(next, at + 1) : null;
      const ops = d.replaceText(next, caret ?? undefined);
      out.push({ kind: 'replace', who: k, next, caret, ops, after: d.text() });
      ops.forEach((o) => queue(k, o));
    } else {
      const index = Math.floor(r() * (len + 2)) - 1;
      const anchor = d.anchorAt(index);
      out.push({ kind: 'anchor', who: k, index, anchor, back: d.indexOfAnchor(anchor) });
    }
    pump(Math.floor(r() * 4));
  }
  while (up.some((q) => q.length) || down.some((q) => q.length)) pump(50);
  return { sites, steps: out, snapshots: docs.map((x) => x.snapshot()), room: room.snapshot(), clocks: docs.map((x) => x.clock) };
}

const r = rng(20260930);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// diffChars edge cases (random short strings over a tiny alphabet so repeats are common)
const diffs: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const mk = () => Array.from({ length: Math.floor(r() * 6) }, () => pick(['a', 'b', '你', '😀']));
  const prev = mk();
  const next = r() < 0.5 ? mk() : [...prev.slice(0, 2), ...mk().slice(0, 2), ...prev.slice(2)];
  const caret = r() < 0.6 ? Math.floor(r() * (next.length + 2)) - 1 : null;
  diffs.push({ prev, next, caret, result: diffChars(prev, next, caret ?? undefined) });
}

const sanitize: unknown[] = [
  null, 5, 'x', {}, { t: 'nope' },
  { t: 'ins', id: [3, 's'], after: [2, 's'], text: 'x' },
  { t: 'ins', id: [3, 's'], after: null, text: 'x' },
  { t: 'ins', id: [3, 's'], text: 'x' },
  { t: 'ins', id: [3, 's'], after: [3, 't'], text: 'x' },
  { t: 'ins', id: [0, 's'], after: null, text: 'x' },
  { t: 'ins', id: [1.5, 's'], after: null, text: 'x' },
  { t: 'ins', id: ['1', 's'], after: null, text: 'x' },
  { t: 'ins', id: [1, ''], after: null, text: 'x' },
  { t: 'ins', id: [1, 'x'.repeat(65)], after: null, text: 'x' },
  { t: 'ins', id: [1, 's'], after: null, text: '' },
  { t: 'ins', id: [1, 's'], after: null, text: 'y'.repeat(5001) },
  { t: 'ins', id: [1, 's', 3], after: null, text: 'x' },
  { t: 'del', ids: [[1, 's'], [2, 't']] },
  { t: 'del', ids: [] },
  { t: 'del', ids: [[1, 's'], ['2', 't']] },
  { t: 'del' },
].map((raw) => ({ raw, site: null, result: sanitizeTextOp(raw) }));
for (const site of ['s', 'other']) sanitize.push({ raw: { t: 'ins', id: [5, 's'], after: null, text: '你' }, site, result: sanitizeTextOp({ t: 'ins', id: [5, 's'], after: null, text: '你' }, site) });

const offsets = ['a😀b', '你好', '', '😀😀x'].flatMap((t) => [0, 1, 2, 3, 4, 5].map((o) => ({ text: t, offset: o, char: codeUnitToCharIndex(t, o), back: charToCodeUnitIndex(t, o) })));
const colors = ['user-1', 'b7c0d2c1-3f5d-4d8e-9a1e-7c1a2e3f4b5c', '', '王老师', 'x'.repeat(200)].map((u) => ({ user: u, color: presenceColor(u) }));

writeFileSync(
  join(OUT, 'calls-text.json'),
  JSON.stringify({
    scripts: [1, 2, 3, 2026, 4242].map((seed) => ({ seed, ...script(seed, 250) })),
    diffs,
    sanitize,
    offsets,
    colors,
  }),
);
