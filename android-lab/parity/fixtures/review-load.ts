/**
 * "Pause new cards on heavy days" (shared/decks/review-load.ts): reviewLoadToday over seeded
 * card sets, reviewLoadState / budgetForToday at and around the limit, the copy
 * (pausedNewCardsLabel, reviewLoadCapSummary, tutorPausedLabel) and the limit's range
 * (pickReviewLoadCap on whole numbers). Writes review-load.json; checked by
 * core/…/ReviewLoadParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  budgetForToday,
  pausedNewCardsLabel,
  pickReviewLoadCap,
  reviewLoadCapSummary,
  reviewLoadState,
  reviewLoadToday,
  tutorPausedLabel,
  upNextPausedLabel,
  PAUSED_NEW_CARDS_DETAIL,
  REVIEW_LOAD_CAP_MAX,
  REVIEW_LOAD_CAP_MIN,
  REVIEW_LOAD_CAP_SUGGESTED,
  type ReviewLoadCard,
} from '../../../shared/decks/review-load';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// Deterministic PRNG (mulberry32), so the vectors are stable.
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

const H = 3_600_000;
const DAY_START = Date.UTC(2026, 9, 20, 23, 0, 0);
const CUTOFF = DAY_START + 24 * H - 1;

const loads = [];
for (let seed = 1; seed <= 60; seed++) {
  const r = rng(seed);
  const n = Math.floor(r() * 40);
  const cards: ReviewLoadCard[] = [];
  const reviewed: string[] = [];
  const first: Array<[string, number]> = [];
  for (let i = 0; i < n; i++) {
    const id = `c${seed}-${i}`;
    const queue = Math.floor(r() * 4);
    const dueRoll = r();
    const due_ms = dueRoll < 0.1 ? null : Math.round(DAY_START + (r() * 4 - 2) * 24 * H);
    cards.push({ id, queue, due_ms });
    if (r() < 0.35) reviewed.push(id);
    const f = r();
    if (f < 0.25) first.push([id, Math.round(DAY_START + r() * 12 * H)]); // first review today
    else if (f < 0.85) first.push([id, Math.round(DAY_START - r() * 90 * 24 * H)]);
    // else: no known first review
  }
  // Boundaries exactly at the cutoff / day start.
  cards.push({ id: `edge${seed}-cut`, queue: 2, due_ms: CUTOFF });
  cards.push({ id: `edge${seed}-after`, queue: 2, due_ms: CUTOFF + 1 });
  cards.push({ id: `edge${seed}-start`, queue: 1, due_ms: DAY_START + H });
  reviewed.push(`edge${seed}-start`);
  first.push([`edge${seed}-start`, DAY_START]);
  const load = reviewLoadToday(cards, new Set(reviewed), new Map(first), DAY_START, CUTOFF);
  loads.push({ cards, reviewed, first, day_start: DAY_START, cutoff: CUTOFF, load });
}

const thresholds: Array<number | null> = [null, 10, 50, 99, 100, 101, 1000];
const loadValues = [0, 1, 9, 10, 11, 50, 99, 100, 101, 124, 1000, 1001];
const budget = { new_cards_per_day: 3, secondary_cards_per_day: 6 };
const states = thresholds.flatMap((threshold) =>
  loadValues.map((load) => {
    const state = reviewLoadState(load, threshold);
    return {
      load,
      threshold,
      state,
      budget: budgetForToday(budget, state),
      label: pausedNewCardsLabel(state),
      tutor: tutorPausedLabel(state),
      up_next: upNextPausedLabel(state),
    };
  }),
);
const summaries = thresholds.map((threshold) => ({ threshold, summary: reviewLoadCapSummary(threshold) }));
const caps = [-1, 0, 1, 9, 10, 11, 99, 100, 500, 999, 1000, 1001, 5000].map((v) => ({ value: v, valid: !pickReviewLoadCap(v).problem }));

writeFileSync(
  join(OUT, 'review-load.json'),
  JSON.stringify({
    loads,
    states,
    summaries,
    caps,
    constants: { min: REVIEW_LOAD_CAP_MIN, max: REVIEW_LOAD_CAP_MAX, suggested: REVIEW_LOAD_CAP_SUGGESTED, detail: PAUSED_NEW_CARDS_DETAIL },
  }),
);
