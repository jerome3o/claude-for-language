/**
 * "⚡ Study it today" mixed with the reviews (Nov 2026) — golden vectors from the web app's own
 * TypeScript (shared/decks/bumps.ts bumpPickChance / mixBumpedCard): single draws over seeded
 * candidates (queues, bumped sets, recent notes, the random value), and whole sessions — a pocket
 * of bumped cards beside reviews and regular new cards, picked until empty with mulberry32 — so
 * the order of ⚡ and green cards is the same in both apps. Writes bump-mix.json; core
 * BumpMixParityTest asserts the Kotlin port (Bumps.kt) matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bumpPickChance, mixBumpedCard } from '../../../shared/decks/bumps';
import { seededRandom } from '../../../shared/explorer/drill';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: bump-mix <out-dir>');
mkdirSync(OUT, { recursive: true });

type C = { id: string; note_id: string; queue: number };
const rand = seededRandom(4242);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

// The chance.
const chances: unknown[] = [];
for (const [b, o] of [[0, 0], [0, 5], [1, 0], [1, 1], [1, 85], [36, 85], [85, 85], [100, 85], [108, 85], [3, 1], [200, 7]]) {
  chances.push({ bumped: b, others: o, chance: bumpPickChance(b, o) });
}

// Single draws.
const draws: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const notes = Array.from({ length: int(1, 6) }, (_, k) => `n${k}`);
  const candidates: C[] = Array.from({ length: int(0, 9) }, (_, k) => ({ id: `c${i}-${k}`, note_id: notes[int(0, notes.length - 1)], queue: int(0, 3) }));
  const bumped = candidates.filter(() => rand() < 0.4).map(c => c.id);
  const none = rand() < 0.05;
  const recent = Array.from({ length: int(0, 5) }, () => notes[int(0, notes.length - 1)]);
  const r = rand();
  let used = false;
  const got = mixBumpedCard(candidates, none ? null : new Set(bumped), recent, () => { used = true; return r; });
  draws.push({ candidates, bumped: none ? null : bumped, recent, r, used, pick: got?.id ?? null });
}

/**
 * A whole session: each step, mixBumpedCard over the cards not of the last 5 rated notes (all of
 * them when that leaves nothing); when it declines, the first other NEW / REVIEW card there
 * (the pocket's own cards only when nothing else is left). The id order is the vector.
 */
function session(seed: number, bumpedN: number, reviewN: number, newN: number, cardsPerNote: number) {
  const rnd = seededRandom(seed);
  const cards: C[] = [];
  const bumped: string[] = [];
  for (let i = 0; i < bumpedN; i++) {
    const c = { id: `b${i}`, note_id: `nb${Math.floor(i / cardsPerNote)}`, queue: i % 4 === 3 ? 2 : 0 };
    cards.push(c);
    bumped.push(c.id);
  }
  for (let i = 0; i < reviewN; i++) cards.push({ id: `r${i}`, note_id: `nr${i}`, queue: 2 });
  for (let i = 0; i < newN; i++) cards.push({ id: `w${i}`, note_id: `nw${i}`, queue: 0 });
  let queue = [...cards];
  const ids = new Set(bumped);
  const recent: string[] = [];
  const order: string[] = [];
  while (queue.length > 0) {
    const avail = queue.filter(c => !recent.includes(c.note_id));
    const choose = avail.length > 0 ? avail : queue;
    const got = mixBumpedCard(choose, ids, recent, rnd)
      ?? choose.find(c => !ids.has(c.id) && (c.queue === 0 || c.queue === 2))
      ?? choose[0];
    order.push(got.id);
    ids.delete(got.id);
    queue = queue.filter(c => c.id !== got.id);
    recent.push(got.note_id);
    if (recent.length > 5) recent.shift();
  }
  return { seed, bumped_n: bumpedN, review_n: reviewN, new_n: newN, cards_per_note: cardsPerNote, order };
}
const sessions = [
  session(1, 100, 85, 0, 3),
  session(2, 36, 85, 3, 1),
  session(3, 12, 4, 6, 2),
  session(4, 5, 40, 0, 1),
  session(5, 9, 0, 0, 3),
];

writeFileSync(join(OUT, 'bump-mix.json'), JSON.stringify({ chances, draws, sessions }));
console.log(`bump-mix: ${chances.length} chances, ${draws.length} draws, ${sessions.length} sessions`);
