/**
 * "⚡ Study it today" during a session — the new word's card comes next (shared/decks/bump-next.ts): golden
 * vectors for sessionBumpPlan (where a bump's pocket cards go: next / the ⚡ mix) and pickNextUpCard (the next
 * card among the queue, in the order bumped). Writes bump-next.json; core BumpNextParityTest asserts BumpNext.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pickNextUpCard, sessionBumpPlan } from '../../../shared/decks/bump-next';
import { seededRandom } from '../../../shared/explorer/drill';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: bump-next <out-dir>');
mkdirSync(OUT, { recursive: true });

const rand = seededRandom(20261117);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];

const plans: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const pocket = TYPES.filter(() => rand() < 0.55).map((t, k) => ({ id: `c${i}-${k}`, card_type: t }));
  const started = rand() < 0.3;
  const nearby = rand() < 0.2;
  const byEar = rand() < 0.6;
  const p = sessionBumpPlan(pocket, started, nearby, byEar);
  plans.push({ pocket, started, nearby, byEar, next: p.next?.id ?? null, mixed: p.mixed.map(c => c.id) });
}

const picks: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const queue = Array.from({ length: int(0, 6) }, (_, k) => ({ id: `q${k}` }));
  const none = rand() < 0.1;
  const next = Array.from({ length: int(0, 4) }, () => `q${int(0, 8)}`);
  picks.push({ queue: queue.map(c => c.id), next: none ? null : next, pick: pickNextUpCard(queue, none ? null : next)?.id ?? null });
}

writeFileSync(join(OUT, 'bump-next.json'), JSON.stringify({ plans, picks }));
console.log(`bump-next: ${plans.length} plans, ${picks.length} picks`);
