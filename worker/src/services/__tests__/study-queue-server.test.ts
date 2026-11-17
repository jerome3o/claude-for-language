/**
 * The server's "due today" = the shared study queue (services/study-queue.ts), against real SQLite
 * with every migration: the same numbers `selectStudyQueue` + `countQueue` give for the same rows
 * (what the learner's Home shows), never "every NEW card".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { computeStudyQueue, loadStudyQueueInputs, perDeckDue, serverStudyQueue } from '../study-queue';
import { getDeckStats, getDueCards, getOverviewStats } from '../../db/queries';
import { countQueue, introducedToday, selectStudyQueue, DEFAULT_STUDY_BUDGET, type QueueCardInput, type QueueDeckInput } from '@shared/decks';
import { studyCutoffMs, studyDayAt } from '../../../../shared/study/studyDay';
import { MASTERED_CARD_SQL } from '@shared/progress/cardSql';
import { CARD_STATE_REPAIR_VERSION } from '../card-state';

const NOW = Date.parse('2026-11-17T12:00:00.000Z'); // London, 12:00 — study day 2026-11-17
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

let db: SqliteD1;

function note(deck: string, id: string) {
  db.raw.run('INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', [id, deck, `字${id}`, 'zì', id]);
  for (const t of TYPES) db.raw.run('INSERT INTO cards (id, note_id, card_type, queue) VALUES (?, ?, ?, 0)', [`${id}-${t}`, id, t]);
}
function card(id: string, queue: number, opts: { next?: number; dueTs?: number; stability?: number } = {}) {
  db.raw.run('UPDATE cards SET queue = ?, next_review_at = ?, due_timestamp = ?, stability = ? WHERE id = ?', [
    queue, opts.next !== undefined ? iso(opts.next) : null, opts.dueTs ?? null, opts.stability ?? null, id,
  ]);
}
function review(id: string, cardId: string, at: number) {
  db.raw.run('INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, 2, ?)', [id, cardId, 'u1', iso(at)]);
}

beforeEach(async () => {
  db = await createSqliteD1();
  // card_state_version: these rows are hand-written queue states (not the replay of the events below),
  // so the one-time replay (services/card-state.ts, tested in card-state-sqlite.test.ts) is marked done.
  db.raw.run("INSERT INTO users (id, email, name, role, time_zone, card_state_version) VALUES ('u1', 'learner@example.com', 'Learner', 'student', 'Europe/London', ?)", [CARD_STATE_REPAIR_VERSION]);
  db.raw.run("INSERT INTO decks (id, user_id, name, new_cards_per_day, secondary_cards_per_day, study_priority, created_at) VALUES ('dA', 'u1', 'A', 3, 6, 2, '2026-10-01T00:00:00Z')");
  db.raw.run("INSERT INTO decks (id, user_id, name, new_cards_per_day, secondary_cards_per_day, study_priority, created_at) VALUES ('dB', 'u1', 'B', 3, 6, 1, '2026-10-02T00:00:00Z')");
  for (const n of ['n1', 'n2', 'n3', 'n4', 'n5']) note('dA', n);
  for (const n of ['n6', 'n7', 'n8', 'n9']) note('dB', n);
  // n1: a mastered review card due yesterday; n2: a learning card first reviewed today, due in 5 min;
  // n6: a review card due in 3 days (not today).
  card('n1-hanzi_to_meaning', 2, { next: NOW - DAY, stability: 30 });
  review('e1', 'n1-hanzi_to_meaning', NOW - 40 * DAY);
  card('n2-hanzi_to_meaning', 1, { dueTs: NOW + 5 * 60_000, next: NOW + 5 * 60_000, stability: 0.5 });
  review('e2', 'n2-hanzi_to_meaning', NOW - 60 * 60_000);
  card('n6-hanzi_to_meaning', 2, { next: NOW + 3 * DAY, stability: 8 });
  review('e3', 'n6-hanzi_to_meaning', NOW - 5 * DAY);
  // n3's lead card suspended; n8 bumped; n7 on Up next.
  db.raw.run("INSERT INTO card_holds (id, user_id, card_id, kind, created_at) VALUES ('h1', 'u1', 'n3-hanzi_to_meaning', 'suspend', '2026-11-01T00:00:00Z')");
  db.raw.run("INSERT INTO study_bumps (id, user_id, note_id, created_at) VALUES ('b1', 'u1', 'n8', '2026-11-17T09:00:00Z')");
  db.raw.run("INSERT INTO up_next (id, user_id, note_id, position, created_at) VALUES ('x1', 'u1', 'n7', 0, '2026-11-16T09:00:00Z')");
});

/** What the device does with the same rows (frontend db/database.ts loadStudyInputs → selectStudyQueue). */
function deviceCounts(deckId?: string) {
  const rows = db.rows<{ id: string; note_id: string; deck_id: string; card_type: string; queue: number; next_review_at: string | null; due_timestamp: number | null; stability: number | null }>(
    'SELECT c.id, c.note_id, n.deck_id, c.card_type, c.queue, c.next_review_at, c.due_timestamp, c.stability FROM cards c JOIN notes n ON n.id = c.note_id',
  );
  const cards: QueueCardInput[] = rows.map((r) => ({
    id: r.id, note_id: r.note_id, deck_id: r.deck_id, card_type: r.card_type, queue: r.queue, stability: r.stability,
    due_ms: r.queue === 2 ? (r.next_review_at ? Date.parse(r.next_review_at) : null) : r.queue === 0 ? null : r.due_timestamp,
  }));
  const decks: QueueDeckInput[] = [
    { id: 'dA', priority: 2, created_at: '2026-10-01T00:00:00Z', cap_primary: 3, cap_secondary: 6 },
    { id: 'dB', priority: 1, created_at: '2026-10-02T00:00:00Z', cap_primary: 3, cap_secondary: 6 },
  ];
  const day = studyDayAt(NOW, 4, 'Europe/London');
  const first = new Map([['n1-hanzi_to_meaning', NOW - 40 * DAY], ['n2-hanzi_to_meaning', NOW - 60 * 60_000], ['n6-hanzi_to_meaning', NOW - 5 * DAY]]);
  const bumps = { bumps: [{ note_id: 'n8', created_ms: Date.parse('2026-11-17T09:00:00Z'), card_types: null }], lastReviewMs: new Map(), firstReviewMs: new Map() };
  const holds = { held: new Set(['n3-hanzi_to_meaning']), reviewedToday: null };
  const q = selectStudyQueue(decks, cards, DEFAULT_STUDY_BUDGET, 0, introducedToday(cards, first, day.startMs), studyCutoffMs(NOW, day), deckId ?? null, null, new Map(), bumps, ['n7'], holds);
  return countQueue(q.due, q.reviewedNoteIds);
}

describe('server study queue = the shared queue', () => {
  it('all decks: the same counts as selectStudyQueue + countQueue on the device', async () => {
    const q = await serverStudyQueue(db, 'u1', { nowMs: NOW });
    const c = deviceCounts();
    expect(q.counts).toEqual({ new: c.new, extra_new: c.secondaryNew, learning: c.learning, review: c.review });
    expect(q.reviews_due).toBe(c.learning + c.review);
    expect(q.due_today).toBe(c.new + c.secondaryNew + c.learning + c.review);
    // Reviews due: n1 (review, yesterday) + n2 (learning, in 5 min); n6 is due in 3 days.
    expect(q.reviews_due).toBe(2);
    // NOT every NEW card (the old `next_review_at IS NULL OR <= now`): 27 cards, 24 of them new.
    const oldDue = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM cards WHERE next_review_at IS NULL OR next_review_at <= ?", [iso(NOW)])[0].n;
    expect(oldDue).toBeGreaterThan(20);
    expect(q.due_today).toBeLessThan(oldDue);
    expect(q.new_cards_paused).toBe(false);
  });

  it('one deck: the deck’s own session', async () => {
    const inputs = await loadStudyQueueInputs(db, 'u1', { nowMs: NOW });
    for (const deckId of ['dA', 'dB']) {
      const q = computeStudyQueue(inputs, deckId);
      const c = deviceCounts(deckId);
      expect(q.due_today).toBe(c.new + c.secondaryNew + c.learning + c.review);
      expect(perDeckDue(inputs).get(deckId)?.due_today).toBe(q.due_today);
    }
  });

  it('pauses new cards on a heavy day', async () => {
    db.raw.run('UPDATE users SET pause_new_when_reviews_over = 0 WHERE id = ?', ['u1']);
    const q = await serverStudyQueue(db, 'u1', { nowMs: NOW });
    expect(q.new_cards_paused).toBe(true);
    expect(q.reviews_due).toBe(2);
    // The budget is 0 + 0; only the ⚡ bump (outside the budget) still brings new cards.
    expect(q.due.filter((c) => c.queue === 0).every((c) => c.note_id === 'n8')).toBe(true);
  });

  it('the API numbers read it: overview, deck stats, due cards', async () => {
    const q = await serverStudyQueue(db, 'u1');
    const overview = await getOverviewStats(db, 'u1');
    expect(overview.due_today).toBe(q.due_today);
    expect(overview.cards_due_today).toBe(q.due_today);
    expect(overview.reviews_due).toBe(q.reviews_due);
    const dA = await getDeckStats(db, 'dA', 'u1');
    expect(dA?.cards_due).toBe((await serverStudyQueue(db, 'u1', { deckId: 'dA' })).due_today);
    expect(dA?.cards_mastered).toBe(1);
    const due = await getDueCards(db, 'u1', undefined, true, 100);
    expect(due.map((c) => c.id)).toEqual(q.due.map((c) => c.id));
    const reviews = await getDueCards(db, 'u1', undefined, false, 100);
    expect(reviews.every((c) => c.queue !== 0)).toBe(true);
  });

  it('mastered = Review with stability > 21 days', () => {
    const n = db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM cards c WHERE ${MASTERED_CARD_SQL}`)[0].n;
    expect(n).toBe(1);
  });
});
