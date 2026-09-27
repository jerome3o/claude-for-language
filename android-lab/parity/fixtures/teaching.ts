/**
 * Golden vectors for package F (teaching): the homework date maths the tutor screens run on
 * the device — shared/homework/due.ts (dueLabel, compareDue, shortDay, addDays, daysBetween,
 * isDateString) and shared/homework/split.ts (splitIntoDays, clampSplitDays, suggestSplitDays).
 * Checked by core/…/TeachingParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, daysBetween, dueLabel, compareDue, shortDay, isDateString } from '../../../shared/homework/due';
import { splitIntoDays, clampSplitDays, suggestSplitDays } from '../../../shared/homework/split';

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
const rand = rng(20260927);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

// Days around month / year ends and leap days, plus random ones.
const anchors = ['2026-09-27', '2026-12-31', '2027-01-01', '2028-02-28', '2028-02-29', '2026-02-28', '2026-03-29', '2026-10-25'];
for (let i = 0; i < 40; i++) anchors.push(addDays('2026-01-01', int(0, 900)));

const dates = anchors.map((today) => {
  const offsets = [-40, -2, -1, 0, 1, 2, 3, 6, 7, 13, 30, 400, int(-60, 60)];
  return {
    today,
    add: offsets.map((n) => ({ n, date: addDays(today, n) })),
    labels: offsets.map((n) => {
      const due = addDays(today, n);
      return { due, between: daysBetween(today, due), label: dueLabel(due, today), short: shortDay(due) };
    }),
  };
});

const odd = ['', '2026-02-30', '2026-13-01', '2026-00-10', '2026-9-27', '26-09-27', '2026-09-27T00:00:00Z', 'tomorrow', '2028-02-29', '2027-02-29', '0000-01-01', '9999-12-31'];
const validity = odd.map((s) => ({ s, valid: isDateString(s), label: dueLabel(s, '2026-09-27'), short: shortDay(s) }));
const nullLabel = dueLabel(null, '2026-09-27');

const comparePairs: Array<[string | null, string | null]> = [
  ['2026-09-27', '2026-09-28'], ['2026-09-28', '2026-09-27'], ['2026-09-27', '2026-09-27'],
  [null, '2026-09-27'], ['2026-09-27', null], [null, null], ['', '2026-01-01'], ['2026-01-01', ''],
];
const compares = comparePairs.map(([a, b]) => ({ a, b, r: Math.sign(compareDue(a, b)) }));

const splits: Array<{ count: number; days: number; first: string; sizes: number[]; dues: string[] }> = [];
for (let i = 0; i < 200; i++) {
  const count = i < 10 ? i : int(0, 80);
  const days = i % 17 === 0 ? int(-3, 30) : int(1, 16);
  const first = addDays('2026-09-27', int(0, 40));
  const parts = splitIntoDays(Array.from({ length: count }, (_, k) => k), days, first);
  splits.push({ count, days, first, sizes: parts.map((p) => p.items.length), dues: parts.map((p) => p.due_date) });
}

const clampInputs: Array<[number | null, number]> = [[1, 10], [0, 10], [-2, 10], [2.5, 10], [3.5, 10], [2.4999, 10], [20, 30], [14, 30], [15, 30], [5, 3], [5, 0], [null, 10], [NaN, 10], [Infinity, 10], [7, 7]];
const clamps = clampInputs.map(([days, count]) => ({ days: days === null || !Number.isFinite(days) ? null : days, count, r: clampSplitDays(days, count) }));

const suggest = Array.from({ length: 200 }, (_, n) => ({ n, per: n % 3 === 0 ? 10 : 7, r: suggestSplitDays(n, n % 3 === 0 ? 10 : 7) }));

writeFileSync(join(OUT, 'teaching.json'), JSON.stringify({ dates, validity, nullLabel, compares, splits, clamps, suggest }));
