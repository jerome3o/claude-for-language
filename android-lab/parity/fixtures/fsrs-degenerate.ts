/**
 * FSRS on UNUSABLE stored card states (shared/scheduler/compute-state.ts `computedStateToFsrsCard`):
 * a reviewed card with stability 0 / negative / NaN / ±Infinity, a difficulty outside 1–10 or not a
 * number, a queue that is no FSRS state, a missing or garbage last-review / due date. Such a row made
 * the web show "NaNy" on the rating buttons and throw on a rating, and made the Lab app throw while
 * showing the card (the study screen froze). For each state: getIntervalPreviews, applyReview for
 * every rating, getRetrievability. Non-finite inputs are written as strings ("NaN", "Infinity",
 * "-Infinity") since JSON has no such numbers.
 * Writes fsrs-degenerate.json; core FsrsDegenerateParityTest asserts CardScheduler matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyReview,
  getIntervalPreviews,
  getRetrievability,
  DEFAULT_DECK_SETTINGS,
  type ComputedCardState,
  type Rating,
} from '../../../shared/scheduler/compute-state';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: fsrs-degenerate <out-dir>');
mkdirSync(OUT, { recursive: true });

const enc = (x: number) => (Number.isFinite(x) ? x : String(x));

function stateJson(s: ComputedCardState) {
  return {
    queue: s.queue,
    stability: enc(s.stability),
    difficulty: enc(s.difficulty),
    scheduled_days: s.scheduled_days,
    reps: s.reps,
    lapses: s.lapses,
    next_review_at: s.next_review_at,
    due_timestamp: s.due_timestamp,
    last_reviewed_at: s.last_reviewed_at,
    ease_factor: enc(s.ease_factor),
  };
}

const NOW = new Date('2026-10-11T10:00:00.000Z');
const queues = [0, 1, 2, 3, 7, -1];
const stabilities = [0, -0, -1, -1e-9, NaN, Infinity, -Infinity, 1e-9, 0.0005, 3.5, 50000];
const difficulties = [NaN, Infinity, 0, -3, 5, 12];
const lastReviews = ['2026-10-07T10:00:00.000Z', '2026-10-11T09:00:00.000Z', null, 'garbage', ''];
const dues = ['2026-10-10T10:00:00.000Z', 'not a date'];

const cases = [];
for (const queue of queues) {
  for (const stability of stabilities) {
    for (const difficulty of difficulties) {
      for (const last of lastReviews) {
        for (const due of dues) {
          const state: ComputedCardState = {
            queue,
            stability,
            difficulty,
            scheduled_days: 3,
            reps: 4,
            lapses: 1,
            next_review_at: due,
            due_timestamp: null,
            last_reviewed_at: last,
            ease_factor: 2.5,
            interval: 3,
            repetitions: 4,
            learning_step: 0,
          };
          const previews = getIntervalPreviews(state, DEFAULT_DECK_SETTINGS, NOW).map((p) => ({
            intervalText: p.intervalText,
            intervalDays: p.intervalDays,
            nextState: p.nextState,
          }));
          const applied = ([0, 1, 2, 3] as Rating[]).map((r) => stateJson(applyReview(state, r, DEFAULT_DECK_SETTINGS, NOW.toISOString())));
          for (const p of previews) {
            if (!Number.isFinite(p.intervalDays)) throw new Error(`non-finite preview for ${JSON.stringify(stateJson(state))}`);
          }
          cases.push({
            state: { queue, stability: enc(stability), difficulty: enc(difficulty), next_review_at: due, last_reviewed_at: last },
            previews,
            applied,
            retrievability: enc(getRetrievability(state, DEFAULT_DECK_SETTINGS, NOW)),
          });
        }
      }
    }
  }
}

writeFileSync(join(OUT, 'fsrs-degenerate.json'), JSON.stringify({ now: NOW.getTime(), cases }));
