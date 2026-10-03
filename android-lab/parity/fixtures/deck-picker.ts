/**
 * Golden vectors for the add-card deck pickers' order and default (shared/decks/queue.ts:
 * decksInQueueOrder / defaultPickerDeckId). Writes deck-picker.json; checked by
 * core/…/PickerDecksParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decksInQueueOrder, defaultPickerDeckId, type PickerDeck } from '../../../shared/decks/queue';

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
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// Few distinct priorities and dates so ties (and ties of ties) are common.
const DATES = ['2025-12-01 10:00:00', '2026-01-01 10:00:00', '2026-01-01 10:00:01', '2026-03-01 08:00:00','2026-09-30 23:59:59', ''];

const cases: Array<{ decks: PickerDeck[]; preferred: string | null; order: string[]; default: string }> = [];
for (let i = 0; i < 400; i++) {
  const n = i === 0 ? 0 : int(1, 30);
  const decks: PickerDeck[] = [];
  for (let k = 0; k < n; k++) {
    const d: PickerDeck = { id: `d${k}` };
    const p = r();
    if (p < 0.85) d.study_priority = int(-3, 4);
    else if (p < 0.92) d.study_priority = null;
    const c = r();
    if (c < 0.9) d.created_at = DATES[int(0, DATES.length - 1)];
    else if (c < 0.95) d.created_at = null;
    decks.push(d);
  }
  const pr = r();
  const preferred = pr < 0.5 || n === 0 ? null : pr < 0.8 ? `d${int(0, n - 1)}` : pr < 0.9 ? 'gone' : '';
  cases.push({ decks, preferred, order: decksInQueueOrder(decks).map((d) => d.id), default: defaultPickerDeckId(decks, preferred) });
}

writeFileSync(join(OUT, 'deck-picker.json'), JSON.stringify({ cases }));
