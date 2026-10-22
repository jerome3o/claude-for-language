/**
 * "Forget this card" + leeches golden vectors (shared/scheduler forget events, shared/cards/leech.ts,
 * docs/STUDY_SESSION.md "Forget" / "Leeches"):
 *   - `sequences`: random review histories with forgets mixed in → after every event the replayed
 *     state (computeCardState over withForgetEvents), the timeline, leechInfo, and the reviews that
 *     still count (reviewsSinceForget / lastForgetAt),
 *   - `merge`: withForgetEvents ordering (same-instant ties: forget after the reviews),
 *   - `known`: knownProgress with forget events (a forgotten card is not seen),
 *   - `copy`: every sentence the pill / sheets show.
 * Writes card-forget.json; core CardForgetParityTest asserts CardScheduler / Forgets / Leech / Known match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeCardState,
  computeCardTimeline,
  lastForgetAt,
  reviewsSinceForget,
  withForgetEvents,
  type CardForget,
  type ComputedCardState,
  type Rating,
  type ReviewEvent,
} from '../../../shared/scheduler/compute-state';
import {
  forgetButton,
  forgetMessage,
  forgetTitle,
  forgetWarning,
  leechHeadline,
  leechInfo,
  leechPill,
  memoryHookQuestion,
  ratingTag,
  undoForgetMessage,
  FORGET_HISTORY_LABEL,
  LEECH_EXPLANATION,
} from '../../../shared/cards/leech';
import { knownProgress, type KnownEventInput } from '../../../shared/progress/known';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: card-forget <out-dir>');
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
const rand = rng(20261022);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const MIN = 60_000;
const DAY = 86_400_000;

function stateJson(s: ComputedCardState) {
  return {
    queue: s.queue, stability: s.stability, difficulty: s.difficulty, scheduled_days: s.scheduled_days,
    reps: s.reps, lapses: s.lapses, next_review_at: s.next_review_at, due_timestamp: s.due_timestamp,
    last_reviewed_at: s.last_reviewed_at, ease_factor: s.ease_factor, interval: s.interval,
    repetitions: s.repetitions, learning_step: s.learning_step,
  };
}

// ---- sequences ----
const sequences = [];
for (let seq = 0; seq < 160; seq++) {
  const cardId = `card-${seq}`;
  let t = Date.UTC(2026, 0, 1) + int(0, 300) * DAY + int(0, 1439) * MIN;
  const reviews: ReviewEvent[] = [];
  const forgets: CardForget[] = [];
  const steps = [];
  // Every 4th sequence is a leech-maker: long, Again on most Review cards, rarely forgotten — so
  // leeches (≥ 8 lapses) appear; the rest are ordinary learners.
  const leechy = seq % 4 === 0;
  const n = leechy ? int(50, 80) : int(4, 40);
  const forgetRate = leechy ? 0.015 : 0.08;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const state = computeCardState(withForgetEvents(reviews, forgets));
      const due = state.due_timestamp ?? t;
      const mode = rand();
      if (mode < 0.4) t = Math.max(t, due) + int(0, 5 * MIN);
      else if (mode < 0.6) t = t + int(0, 3 * MIN);
      else if (mode < 0.85) t = Math.max(t, due) + int(0, 3) * DAY + int(0, DAY);
      else t = Math.max(t, due) + int(4, 60) * DAY;
    }
    const at = new Date(t).toISOString();
    const roll = rand();
    if (i > 2 && roll < forgetRate) {
      forgets.push({ id: `${cardId}-f${i}`, card_id: cardId, forgotten_at: at });
    } else {
      const r = rand();
      const inReview = computeCardState(withForgetEvents(reviews, forgets)).queue === 2;
      const againRate = leechy ? (inReview ? 0.7 : 0.05) : 0.15;
      const rating = (r < againRate ? 0 : r < againRate + 0.1 ? 1 : r < 0.92 ? 2 : 3) as Rating;
      reviews.push({ id: `${cardId}-e${i}`, card_id: cardId, rating, reviewed_at: at });
      // Sometimes a forget at exactly the same instant as a review (pressed right after rating).
      if (i > 2 && rand() < 0.04) forgets.push({ id: `${cardId}-g${i}`, card_id: cardId, forgotten_at: at });
    }
    const merged = withForgetEvents(reviews, forgets);
    const last = lastForgetAt(forgets);
    steps.push({
      reviews: reviews.length,
      forgets: forgets.length,
      state: stateJson(computeCardState(merged)),
      leech: leechInfo(merged),
      last_forget_at: last,
      counting: reviewsSinceForget(reviews, last).map(e => e.id),
    });
  }
  const merged = withForgetEvents(reviews, forgets);
  sequences.push({
    card_id: cardId,
    reviews,
    forgets,
    merged: merged.map(e => e.id),
    timeline: computeCardTimeline(merged),
    steps,
  });
}

// ---- merge ties ----
const tie = '2026-03-01T10:00:00.000Z';
const merge = {
  reviews: [
    { id: 'b', card_id: 'c', rating: 2 as Rating, reviewed_at: tie },
    { id: 'a', card_id: 'c', rating: 0 as Rating, reviewed_at: tie },
    { id: 'z', card_id: 'c', rating: 2 as Rating, reviewed_at: '2026-03-01T09:00:00.000Z' },
  ],
  forgets: [
    { id: 'f2', card_id: 'c', forgotten_at: tie },
    { id: 'f1', card_id: 'c', forgotten_at: tie },
    { id: 'f0', card_id: 'c', forgotten_at: '2026-03-01T08:00:00.000Z' },
  ],
  expected: [] as string[],
};
merge.expected = withForgetEvents(merge.reviews, merge.forgets).map(e => e.id);

// ---- known with forgets ----
const T0 = Date.UTC(2026, 0, 1, 9);
const knownCases = [];
for (let k = 0; k < 30; k++) {
  const notes = [
    { id: 'n1', hanzi: '你好' }, { id: 'n2', hanzi: '好吃' }, { id: 'n3', hanzi: '我很好。' }, { id: 'n4', hanzi: '银行' },
  ];
  const cards = notes.flatMap(n => ['a', 'b', 'c'].map(t => ({ id: `${n.id}${t}`, note_id: n.id })));
  const events: KnownEventInput[] = [];
  let seqNo = 0;
  for (const c of cards) {
    if (rand() < 0.3) continue;
    let t = T0 + int(0, 20) * DAY;
    const count = int(1, 6);
    for (let i = 0; i < count; i++) {
      if (i > 0 && rand() < 0.15) {
        events.push({ id: `k${k}-${seqNo++}`, card_id: c.id, rating: 0, reviewed_at: new Date(t).toISOString(), kind: 'forget' });
      } else {
        events.push({ id: `k${k}-${seqNo++}`, card_id: c.id, rating: rand() < 0.5 ? 3 : 2, reviewed_at: new Date(t).toISOString() });
      }
      t += int(0, 6) * DAY + int(0, 600) * MIN;
    }
  }
  const points = [T0 + 5 * DAY, T0 + 15 * DAY, T0 + 30 * DAY, T0 + 60 * DAY];
  knownCases.push({ notes, cards, events, points, expected: knownProgress(notes, cards, events, points) });
}

// ---- copy ----
const copy = {
  pills: [0, 7, 8, 9, 23].map(n => ({ lapses: n, pill: leechPill(n) })),
  headlines: [1, 8, 12].map(n => ({ lapses: n, text: leechHeadline(n) })),
  explanation: LEECH_EXPLANATION,
  hook: memoryHookQuestion('银行', 'bank', 9),
  ratings: [0, 1, 2, 3, 7].map(ratingTag),
  warnings: [1, 3].map(n => ({ count: n, text: forgetWarning(n) })),
  titles: [['card', 1], ['note', 1], ['note', 3]].map(([s, n]) => ({ scope: s, count: n, text: forgetTitle(s as 'card' | 'note', n as number) })),
  buttons: [1, 2].map(n => ({ count: n, text: forgetButton(n) })),
  messages: [1, 3].map(n => ({ count: n, text: forgetMessage(n), undo: undoForgetMessage(n) })),
  history: FORGET_HISTORY_LABEL,
};

writeFileSync(join(OUT, 'card-forget.json'), JSON.stringify({ sequences, merge, known: knownCases, copy }));
console.log(`card-forget: ${sequences.length} sequences, ${knownCases.length} known cases`);
