/**
 * Golden vectors for the retry progress bar (shared/homework/retry-bar.ts, docs/HOMEWORK.md §3c):
 * passRetryBar over random passes with Not yet / Got it / done / undo events, retryBar over raw
 * counts, and the label / badge / note strings. Writes retry-bar.json; checked by
 * core/…/RetryBarParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { passRetryBar, retryBar, retryBarBadge, retryBarLabel, retryBarNote, type PassEvent, type RetryBar } from '../../../shared/homework';

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
const r = rng(20261022);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const EXERCISE = { one: 'exercise', other: 'exercises' };
const shape = (bar: RetryBar) => ({
  bar,
  label: retryBarLabel(bar),
  label_exercises: retryBarLabel(bar, EXERCISE),
  badge: retryBarBadge(bar),
  note: retryBarNote(bar),
});

const passes = Array.from({ length: 300 }, () => {
  const n = int(0, 9);
  const itemIds = Array.from({ length: n }, (_, i) => `n${i}`);
  if (n > 0 && r() < 0.15) itemIds.push(pick(itemIds)); // a duplicate id
  const events: PassEvent[] = [];
  const m = int(0, 24);
  for (let i = 0; i < m; i++) {
    const created_at = `2026-10-22T10:${String(int(0, 40)).padStart(2, '0')}:00.000Z`;
    if (events.length && r() < 0.25) {
      const target = r() < 0.85 ? pick(events).id ?? '' : 'unknown';
      const of = events.find((e) => e.id === target);
      events.push({ id: `u${i}`, item_id: of?.item_id ?? 'n0', result: 'undo', created_at, undoes: target || null });
    } else {
      const item = r() < 0.05 ? 'other' : `n${int(0, Math.max(0, n - 1))}`;
      events.push({ id: r() < 0.05 ? '' : `e${i}`, item_id: item, result: pick(['right', 'wrong', 'wrong', 'wrong', 'done'] as const), created_at });
    }
  }
  return { item_ids: itemIds, events, ...shape(passRetryBar(itemIds, events)) };
});

const counts = Array.from({ length: 150 }, () => {
  const input = { answered: int(-2, 30), fresh: int(-2, 20), retries: int(-2, 10), itemsDone: int(-2, 25), items: int(-2, 20) };
  return { input, ...shape(retryBar(input)) };
});

writeFileSync(join(OUT, 'retry-bar.json'), JSON.stringify({ passes, counts }));
