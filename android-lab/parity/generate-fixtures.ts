/**
 * Golden vectors for the Kotlin port (android-lab/core), produced by running the
 * web app's own TypeScript: shared/scheduler (FSRS via ts-fsrs), shared/decks/budget
 * and frontend/src/utils/numberHanzi. The Kotlin ParityTest must reproduce every
 * value exactly. Regenerate with `android-lab/parity/generate.sh`; CI regenerates
 * and fails if the committed fixtures are stale, so a change to the web logic
 * without the matching Kotlin change turns the Lab build red.
 *
 * Deterministic: a seeded PRNG, fixed timestamps, TZ=UTC.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeCardState,
  applyReview,
  getIntervalPreviews,
  getRetrievability,
  formatInterval,
  initialCardState,
  DEFAULT_DECK_SETTINGS,
  type ReviewEvent,
  type Rating,
  type ComputedCardState,
} from '../../shared/scheduler/compute-state';
import { allocateNewCards, sortDecksForQueue, daysToIntroduce, type DeckNewPool } from '../../shared/decks/budget';
import { normalizeNumbersToHanzi, hanziAnswerKey, stripAnswerPunctuation, intToHanzi } from '../../frontend/src/utils/numberHanzi';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: generate-fixtures <out-dir>');
mkdirSync(OUT, { recursive: true });

// mulberry32
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

const MIN = 60_000;
const DAY = 86_400_000;

function stateJson(s: ComputedCardState) {
  return {
    queue: s.queue,
    stability: s.stability,
    difficulty: s.difficulty,
    scheduled_days: s.scheduled_days,
    reps: s.reps,
    lapses: s.lapses,
    next_review_at: s.next_review_at,
    due_timestamp: s.due_timestamp,
    last_reviewed_at: s.last_reviewed_at,
    ease_factor: s.ease_factor,
    interval: s.interval,
    repetitions: s.repetitions,
    learning_step: s.learning_step,
  };
}

// ---- FSRS sequences ----
// Ratings are skewed like a real learner (mostly Good), and the time of each
// review is drawn around the card's due time: early, on time, late, much later,
// and same-minute repeats (the "show it again right away" flow).
const sequences = [];
for (let seq = 0; seq < 400; seq++) {
  const cardId = `card-${seq}`;
  let t = Date.UTC(2025, 0, 1) + int(0, 600) * DAY + int(0, DAY / MIN) * MIN + int(0, 59_999);
  const n = int(1, 24);
  const events: ReviewEvent[] = [];
  const steps = [];
  let state = initialCardState(DEFAULT_DECK_SETTINGS);
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const due = state.due_timestamp ?? t;
      const mode = rand();
      if (mode < 0.35) t = Math.max(t, due) + int(0, 5 * MIN);
      else if (mode < 0.55) t = t + int(0, 3 * MIN);
      else if (mode < 0.75) t = Math.max(t, due) + int(0, 3) * DAY + int(0, DAY);
      else if (mode < 0.9) t = Math.max(t, due) + int(4, 120) * DAY;
      else t = t + int(1, 20) * 60 * MIN;
    }
    const r = rand();
    const rating = (r < 0.15 ? 0 : r < 0.27 ? 1 : r < 0.9 ? 2 : 3) as Rating;
    const reviewedAt = new Date(t).toISOString();
    events.push({ id: `${cardId}-e${i}`, card_id: cardId, rating, reviewed_at: reviewedAt });
    const applied = applyReview(state, rating, DEFAULT_DECK_SETTINGS, reviewedAt);
    const replayed = computeCardState(events, DEFAULT_DECK_SETTINGS);
    const previewAt = new Date(t + pick([0, MIN, 17 * MIN, DAY, 3 * DAY + 7 * MIN, 40 * DAY]));
    steps.push({
      rating,
      reviewed_at: reviewedAt,
      replayed: stateJson(replayed),
      applied: stateJson(applied),
      preview_at: previewAt.getTime(),
      previews: getIntervalPreviews(replayed, DEFAULT_DECK_SETTINGS, previewAt).map((p) => ({
        rating: p.rating,
        intervalText: p.intervalText,
        intervalDays: p.intervalDays,
        nextState: p.nextState,
      })),
      retrievability: getRetrievability(replayed, DEFAULT_DECK_SETTINGS, previewAt),
    });
    state = replayed;
  }
  sequences.push({ card_id: cardId, steps });
}
writeFileSync(join(OUT, 'fsrs.json'), JSON.stringify({ sequences }));

// ---- formatInterval ----
const intervals = [];
const fixedMinutes = [0, 0.4, 0.5, 1, 9.99, 10, 59.4, 59.5, 60, 89, 90, 1439, 1440, 2160, 10079, 10080, 12000, 20160, 30240, 43200, 50000, 100000, 525600, 600000, 1051200, 1234567];
for (const m of fixedMinutes) intervals.push({ minutes: m, text: formatInterval(m), lessThan: formatInterval(m, true) });
for (let i = 0; i < 400; i++) {
  const m = Math.exp(rand() * Math.log(3_000_000));
  intervals.push({ minutes: m, text: formatInterval(m), lessThan: formatInterval(m, true) });
}
writeFileSync(join(OUT, 'format-interval.json'), JSON.stringify({ intervals }));

// ---- budget ----
const budgetCases = [];
for (let i = 0; i < 300; i++) {
  const decks = int(1, 6);
  const pools: DeckNewPool[] = [];
  for (let d = 0; d < decks; d++) {
    pools.push({
      deckId: `deck-${i}-${d}`,
      priority: pick([0, 0, 0, 1, 2, -1, 5]),
      createdAt: `2026-0${int(1, 9)}-${String(int(10, 28))} ${String(int(10, 23))}:00:00`,
      totalNew: int(0, 40),
      totalSecondaryNew: int(0, 30),
      capPrimary: int(0, 20),
      capSecondary: int(0, 20),
      studiedPrimary: int(0, 6),
      studiedSecondary: int(0, 8),
    });
  }
  const budget = { new_cards_per_day: int(0, 15), secondary_cards_per_day: int(0, 15) };
  const bonus = pick([0, 0, 10, 20]);
  const spentElsewhere = { primary: int(0, 3), secondary: int(0, 4) };
  const alloc = allocateNewCards(pools, budget, bonus, spentElsewhere);
  budgetCases.push({
    pools,
    budget,
    bonus,
    spentElsewhere,
    order: sortDecksForQueue(pools).map((p) => p.deckId),
    allocation: [...alloc.entries()].map(([deckId, a]) => ({ deckId, primary: a.primary, secondary: a.secondary })),
    daysToIntroduce: daysToIntroduce(pools[0].totalNew, budget),
  });
}
writeFileSync(join(OUT, 'budget.json'), JSON.stringify({ cases: budgetCases }));

// ---- typed answers ----
const answerInputs = [
  '你好', ' 你好 ', '你好。', '你好！', '你 好', 'Nǐ hǎo', 'NIHAO', '７个', '7个', '七个', '两个', '二个',
  '3月', '1,000块', '1000', '10000', '10001', '12345', '100000000', '1.5', '50%', '3.25%', 'one book', 'Two个',
  'twenty-one', 'IV', 'Chapter XI', 'XIV章', 'MCM', '0', '105', '110', '1010', '2008年', '他是VIP', '2.0',
  '（你好）', '「好」', '《书》', '你好…', '好-好', '你　好', ' 你好 ', '你好\n', 'hello world',
  '123456789012', '99999999999999999999', '一百零五', '第1课', '1.5.3', 'a1b2', '10%的人', 'ten thousand',
];
const answers = answerInputs.map((s) => ({
  input: s,
  numbers: normalizeNumbersToHanzi(s),
  key: hanziAnswerKey(s),
  stripped: stripAnswerPunctuation(s),
  normalized: s.trim().toLowerCase(),
}));
const ints = [0, 1, 9, 10, 11, 19, 20, 21, 99, 100, 101, 110, 999, 1000, 1001, 1010, 1100, 9999, 10000, 10001, 10100, 99999, 123456, 1000000, 12345678, 99999999, 100000000].map((n) => ({ n, hanzi: intToHanzi(n) }));
writeFileSync(join(OUT, 'answers.json'), JSON.stringify({ answers, ints }));

// ---- JS number semantics the port relies on ----
const numbers = [];
for (let i = 0; i < 2000; i++) {
  const x = pick([
    () => rand() * 10,
    () => rand() * 365000,
    () => (1 + rand() * 9) * (0.001 + rand() * 100),
    () => int(0, 1_000_000),
    () => rand() * 1e-6,
    () => rand() * 1e25,
    () => -rand() * 10,
  ])();
  numbers.push({ x, str: String(x), fixed8: +x.toFixed(8), fixed1: x.toFixed(1), round: Math.round(x) });
}
for (const x of [0.5, 1.5, 2.5, -0.5, 0.49999999999999994, 1e21, 1e-7, 123e-20, 0.1 + 0.2, 2 ** 53 + 2]) {
  numbers.push({ x, str: String(x), fixed8: +x.toFixed(8), fixed1: x.toFixed(1), round: Math.round(x) });
}
writeFileSync(join(OUT, 'js-numbers.json'), JSON.stringify({ numbers }));

console.log(`wrote fixtures to ${OUT}`);
