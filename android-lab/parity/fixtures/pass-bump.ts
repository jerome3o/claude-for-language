/**
 * The homework pass's "⚡ Study it today" golden vectors (docs/HOMEWORK.md §3c), from the web app's
 * own TypeScript — shared/homework/pass-bump.ts (what one tap bumps: the listening card of an
 * unstarted word, else its lead card, a started word whole; the long-term choice stored with it;
 * labels / hint / a row's kind) and the queue that follows (shared/decks/study-queue.ts with
 * bumps.ts `pocketSiblingIds`: an unstarted note bumped card by card holds its other NEW cards
 * back; once its bumped card is reviewed they are purple cards).
 * Writes pass-bump.json; core PassBumpParityTest asserts PassBump.kt + StudyQueue.kt match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { passBumpHint, passBumpKindOfRow, passBumpLabel, passBumpPlan, type PassBumpKind } from '../../../shared/homework/pass-bump';
import { selectStudyQueue, type QueueCardInput, type QueueDeckInput } from '../../../shared/decks/study-queue';
import type { QueueBump } from '../../../shared/decks/bumps';
import type { LongTermPref } from '../../../shared/decks/long-term';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: pass-bump <out-dir>');
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
const rand = rng(20261112);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const H = 3_600_000;
const DAY = 24 * H;
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const PREFS: LongTermPref[] = [null, 0, 1];

// The plan over every combination of a note's cards.
const plans: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const types = rand() < 0.1 ? [] : TYPES.filter(() => rand() < 0.85);
  const cards = types.map(t => ({ card_type: t, queue: rand() < 0.75 ? 0 : pick([1, 2, 3]) }));
  const started = rand() < 0.2;
  const hasAudio = rand() < 0.7;
  const known = rand() < 0.4;
  const longTermPref = pick(PREFS);
  const deckInReview = rand() < 0.6;
  const p = passBumpPlan({ cards, started, hasAudio, knownCharactersLead: () => known, longTermPref, deckInReview });
  plans.push({ cards, started, hasAudio, known, longTermPref, deckInReview, plan: { ...p, longTerm: p.longTerm === undefined ? 'keep' : p.longTerm } });
}

const copy: unknown[] = [];
for (const kind of ['listening', 'lead', 'whole'] as PassBumpKind[]) {
  copy.push({ kind, off: passBumpLabel(kind, false), on: passBumpLabel(kind, true), hint: passBumpHint(kind) });
}
const rows = [null, [], ['audio_to_hanzi'], ['hanzi_to_meaning'], ['meaning_to_hanzi'], ['meaning_to_hanzi', 'audio_to_hanzi']].map(t => ({ cardTypes: t, kind: passBumpKindOfRow(t) }));

// Queues: several notes, some bumped from the pass (one card), some whole, some started; Up next, long-term.
const queues: unknown[] = [];
for (let i = 0; i < 250; i++) {
  const cutoff = Date.parse('2026-11-12T22:59:59.999Z');
  const now = cutoff - int(2, 14) * H;
  const deckIds = int(1, 2) === 1 ? ['d1'] : ['d1', 'd2'];
  const decks: QueueDeckInput[] = deckIds.map((id, k) => ({ id, priority: k, created_at: `2026-0${k + 1}-01`, cap_primary: pick([0, 3, 3, 5]), cap_secondary: pick([0, 6, 6]) }));
  const cards: QueueCardInput[] = [];
  const bumps: QueueBump[] = [];
  const last = new Map<string, number>();
  const first = new Map<string, number>();
  const longTerm = new Map<string, LongTermPref>();
  const noteCount = int(2, 7);
  const noteIds: string[] = [];
  for (let n = 0; n < noteCount; n++) {
    const note = `n${i}-${n}`;
    noteIds.push(note);
    const deck = pick(deckIds);
    const started = rand() < 0.3;
    for (const t of TYPES) {
      if (rand() < 0.08) continue;
      const queue = started && rand() < 0.5 ? pick([1, 2]) : 0;
      const due = queue === 0 ? null : now + int(-2 * 24, 5 * 24) * H;
      cards.push({ id: `${note}-${t[0]}`, note_id: note, deck_id: deck, card_type: t, queue, due_ms: due });
      if (queue !== 0) {
        const f = now - int(2, 30) * DAY;
        first.set(`${note}-${t[0]}`, f);
        last.set(`${note}-${t[0]}`, f + int(0, 2) * DAY);
      }
    }
    if (rand() < 0.2) longTerm.set(note, pick(PREFS));
    const r = rand();
    if (r < 0.45) {
      const created = now - int(0, 30) * 60_000;
      const listen: QueueBump = { note_id: note, created_ms: created, card_types: [pick(['audio_to_hanzi', 'audio_to_hanzi', 'hanzi_to_meaning'])] };
      bumps.push(listen);
      // Sometimes the bumped card was already reviewed since (the bump is done).
      if (rand() < 0.3) {
        const id = `${note}-${listen.card_types![0][0]}`;
        const c = cards.find(x => x.id === id);
        if (c) {
          c.queue = 1;
          c.due_ms = now + 10 * 60_000;
          last.set(id, created + 60_000);
          if (!first.has(id)) first.set(id, created + 60_000);
        }
      }
    } else if (r < 0.55) {
      bumps.push({ note_id: note, created_ms: now - int(0, 30) * 60_000 });
    }
  }
  const upNext = rand() < 0.3 ? noteIds.filter(() => rand() < 0.4) : null;
  const budget = { new_cards_per_day: pick([0, 1, 3, 5]), secondary_cards_per_day: pick([0, 2, 6]) };
  const introduced = new Map(deckIds.map(id => [id, { primary: int(0, 2), secondary: int(0, 2) }]));
  const qb = { bumps, lastReviewMs: last, firstReviewMs: first };
  const out: unknown[] = [];
  for (const deckId of [null, ...deckIds]) {
    const q = selectStudyQueue(decks, cards, budget, 0, introduced, cutoff, deckId, null, longTerm, qb, upNext);
    out.push({ deckId, due: q.due.map(c => c.id).sort(), newOrder: q.due.filter(c => c.queue === 0).map(c => c.id), bumped: q.bumped.map(c => c.id), upNext: q.upNext.map(c => c.id) });
  }
  queues.push({
    decks, cards, budget, cutoff, upNext,
    introduced: Object.fromEntries(introduced),
    longTerm: Object.fromEntries([...longTerm].filter(([, v]) => v !== null)),
    bumps, last: Object.fromEntries(last), first: Object.fromEntries(first),
    queues: out,
  });
}

writeFileSync(join(OUT, 'pass-bump.json'), JSON.stringify({ plans, copy, rows, queues }));
console.log(`pass-bump: ${plans.length} plans, ${queues.length} queues`);
