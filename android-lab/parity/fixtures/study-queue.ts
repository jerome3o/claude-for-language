/**
 * Study queue golden vectors (the due-count parity fix, 27 Sep 2026), from the
 * web app's own TypeScript — shared/decks/study-queue.ts, which the web's
 * getStudyQueue, Home and deck counts all go through:
 *   - introducedToday(cards, firstReviewAt, dayStart)   (new cards introduced today, primary / secondary)
 *   - selectStudyQueue(...)                             (the cards a session gets: learning / review due
 *                                                         by the cutoff + the budget's new cards)
 *   - countQueue(...)                                   (the four numbers Home shows)
 * Writes study-queue.json; core StudyQueueParityTest asserts StudyQueue.kt reproduces them.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  introducedToday,
  selectStudyQueue,
  countQueue,
  type QueueCardInput,
  type QueueDeckInput,
} from '../../../shared/decks/study-queue';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: study-queue <out-dir>');
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
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const H = 3_600_000;
const DAY = 24 * H;
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

const cases: unknown[] = [];
for (let i = 0; i < 250; i++) {
  const dayStart = Date.parse('2026-09-26T23:00:00.000Z') + int(-3, 3) * DAY;
  const now = dayStart + int(0, 23) * H + int(0, 59) * 60_000;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);

  const deckCount = int(1, 5);
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < deckCount; d++) {
    decks.push({
      id: `d${i}-${d}`,
      priority: pick([0, 0, 1, 2, 5, -1]),
      created_at: `2026-0${int(1, 9)}-${String(int(10, 28))}T${String(int(10, 23))}:00:00.000Z`,
      cap_primary: pick([0, 1, 3, 5, 20]),
      cap_secondary: pick([0, 2, 6, 10]),
    });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const noteCount = int(0, 14);
  for (let n = 0; n < noteCount; n++) {
    // A few cards belong to a deck the device doesn't know (dropped / ghost deck).
    const deckId = rand() < 0.05 ? `gone-${i}` : pick(decks).id;
    const types = TYPES.slice(0, int(1, 3));
    for (const t of types) {
      const id = `c${i}-${n}-${t[0]}`;
      const queue = pick([0, 0, 0, 1, 2, 2, 2, 3]);
      let due: number | null = null;
      if (queue !== 0) {
        due = rand() < 0.05 ? null : now + int(-4 * 24, 4 * 24) * H + int(-30, 30) * 60_000;
        // first review: often today, sometimes earlier
        firstReviewAt[id] = rand() < 0.4 ? dayStart + int(0, 20) * H : dayStart - int(1, 40) * DAY;
        if (rand() < 0.05) firstReviewAt[id] = dayStart; // exactly at the day start
      }
      cards.push({ id, note_id: `n${i}-${n}`, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  const budget = { new_cards_per_day: pick([0, 3, 5, 10]), secondary_cards_per_day: pick([0, 6, 10]) };
  const bonus = pick([0, 0, 0, 10, 20]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const scopes: Array<string | null> = [null, pick(decks).id];
  const queues = scopes.map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId);
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
    };
  });
  cases.push({
    now,
    dayStart,
    cutoff,
    decks,
    cards,
    firstReviewAt,
    budget,
    bonus,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues,
  });
}
writeFileSync(join(OUT, 'study-queue.json'), JSON.stringify({ cases }));
console.log(`study-queue: ${cases.length} scenarios`);
