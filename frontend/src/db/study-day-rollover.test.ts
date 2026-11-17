/**
 * "New day starts at" (4 am) on the web device with the clock pinned — the night of Jerome's
 * screenshot (17 Nov 2026, 00:44 in London: "132 reviews today" beside "104 reviews due today").
 *
 * Every "today" Home shows comes from the same study day: today's reviews (every rating), the cards
 * reviewed today, introduced-today and the review load. Reviews from 18:00 the evening before are
 * today's until 4 am; at 04:01 a new day starts. The review load counts CARDS (each once, the ones
 * already reviewed included, new cards' learning steps left out) — so it can be below the number of
 * reviews, but never below the cards reviewed today that weren't new today.
 */
process.env.TZ = 'Europe/London';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, getRawQueueCounts, getTodayReviewSummary, type LocalCard } from './database';
import { CardQueue } from '../types';
import { writeStudyBudget } from '../services/studyBudget';
import { isInStudyToday, resetDayRolloverCacheForTests, studyDayNow, studyToday, writeDayRolloverHour } from '../services/studyDay';
import { pausedNewCardsLabel } from '@shared/decks';

const T = (iso: string) => Date.parse(iso);

function deck(id: string) {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    id, user_id: 'u1', name: id, description: null, new_cards_per_day: 3, secondary_cards_per_day: 6, study_priority: 0,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: at, updated_at: at, _synced_at: null,
  };
}

function card(id: string, queue: number, nextMs: number | null): LocalCard {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    id, note_id: `n-${id}`, deck_id: 'd', card_type: 'hanzi_to_meaning', queue, stability: queue ? 30 : 0, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: queue ? 3 : 0,
    next_review_at: nextMs === null ? null : new Date(nextMs).toISOString(), due_timestamp: null,
    created_at: at, updated_at: at, _synced_at: null,
  } as LocalCard;
}

/**
 * The evening of 16 Nov (London, GMT): three old cards reviewed twice each from 18:00 to 00:40, one
 * NEW word introduced at 23:00 (three ratings: its learning steps), two cards still due, one card
 * reviewed at 03:59 that morning (the study day before).
 */
async function seedEvening() {
  await db.decks.put(deck('d') as never);
  const cards = [
    card('r1', CardQueue.REVIEW, T('2026-11-21T10:00:00Z')),
    card('r2', CardQueue.REVIEW, T('2026-11-21T10:00:00Z')),
    card('r3', CardQueue.REVIEW, T('2026-11-21T10:00:00Z')),
    card('new1', CardQueue.LEARNING, T('2026-11-17T10:00:00Z')),
    card('due1', CardQueue.REVIEW, T('2026-11-16T09:00:00Z')),
    card('due2', CardQueue.REVIEW, T('2026-11-17T02:00:00Z')),
    card('early', CardQueue.REVIEW, T('2026-11-25T10:00:00Z')),
  ];
  await db.cards.bulkPut(cards);
  for (const c of cards) await db.notes.put({ id: c.note_id, deck_id: 'd', hanzi: `字${c.id}`, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: c.created_at, updated_at: c.updated_at, _synced_at: null } as never);
  const ev = (id: string, cardId: string, iso: string) => ({ id, card_id: cardId, rating: 2, reviewed_at: new Date(T(iso)).toISOString(), _synced: 1 });
  await db.reviewEvents.bulkPut([
    // Long ago: the old cards' first reviews.
    ev('o1', 'r1', '2026-10-01T12:00:00Z'), ev('o2', 'r2', '2026-10-01T12:00:00Z'), ev('o3', 'r3', '2026-10-01T12:00:00Z'),
    ev('o4', 'due1', '2026-10-01T12:00:00Z'), ev('o5', 'due2', '2026-10-01T12:00:00Z'), ev('o6', 'early', '2026-10-01T12:00:00Z'),
    // This study day (16 Nov 04:00 → 17 Nov 04:00).
    ev('t1', 'r1', '2026-11-16T18:00:00Z'), ev('t2', 'r1', '2026-11-16T18:05:00Z'),
    ev('t3', 'r2', '2026-11-16T23:30:00Z'), ev('t4', 'r2', '2026-11-16T23:35:00Z'),
    ev('t5', 'r3', '2026-11-17T00:30:00Z'), ev('t6', 'r3', '2026-11-17T00:40:00Z'),
    ev('n1', 'new1', '2026-11-16T23:00:00Z'), ev('n2', 'new1', '2026-11-16T23:01:00Z'), ev('n3', 'new1', '2026-11-16T23:11:00Z'),
    // 03:59 on the 16th: the study day before.
    ev('y1', 'early', '2026-11-16T03:59:00Z'),
  ] as never);
}

function setLimit(limit: number | null) {
  writeStudyBudget({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true, set_by_id: null, set_by_name: null, set_by_tutor: false, set_at: null, pause_new_when_reviews_over: limit });
}

describe('the study day turns over at 4 am, not midnight (web device)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    resetDayRolloverCacheForTests();
    writeDayRolloverHour(4);
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear()]);
    setLimit(4);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('00:44 is still the previous study day: last evening counts, the load ≥ cards reviewed today', async () => {
    vi.setSystemTime(T('2026-11-17T00:44:00Z'));
    await seedEvening();
    expect(studyToday()).toBe('2026-11-16');
    expect(studyDayNow().startMs).toBe(T('2026-11-16T04:00:00Z'));
    expect(isInStudyToday('2026-11-16T18:00:00Z')).toBe(true);
    expect(isInStudyToday('2026-11-16T03:59:00Z')).toBe(false);

    // Every rating since 04:00 on the 16th: 6 + the new word's 3 (not the 03:59 one).
    expect((await getTodayReviewSummary()).reviews).toBe(9);
    // The load: r1–r3 (reviewed today, not new today) + due1, due2 (due by 03:59:59 tomorrow).
    const raw = await getRawQueueCounts();
    expect(raw.reviewLoad).toEqual({ load: 5, threshold: 4, paused: true });
    // Fewer than the reviews (cards, each once; the new word's steps aren't reviews) — never fewer
    // than the cards reviewed today that weren't new today.
    expect(raw.reviewLoad!.load).toBeGreaterThanOrEqual(3);
    expect(pausedNewCardsLabel(raw.reviewLoad)).toBe('New cards paused — 5 cards reviewed or due today (limit 4)');
  });

  it('03:59 still yesterday, 04:01 a new day: nothing reviewed today, only what is due', async () => {
    vi.setSystemTime(T('2026-11-17T03:59:00Z'));
    await seedEvening();
    expect(studyToday()).toBe('2026-11-16');
    expect((await getTodayReviewSummary()).reviews).toBe(9);

    vi.setSystemTime(T('2026-11-17T04:01:00Z'));
    expect(studyToday()).toBe('2026-11-17');
    expect((await getTodayReviewSummary()).reviews).toBe(0);
    const raw = await getRawQueueCounts();
    // due1 + due2 (and new1, a learning card due today at 10:00) — none of last night's reviews.
    expect(raw.reviewLoad).toEqual({ load: 3, threshold: 4, paused: false });
  });

  it('the fall-back night (25 Oct, Europe/London): a 25-hour study day from 04:00 BST to 04:00 GMT', async () => {
    vi.setSystemTime(T('2026-10-25T01:30:00Z')); // 01:30 GMT, after the clocks went back
    await db.decks.put(deck('d') as never);
    await db.cards.bulkPut([card('a', CardQueue.REVIEW, T('2026-11-01T00:00:00Z')), card('b', CardQueue.REVIEW, T('2026-11-01T00:00:00Z'))]);
    await db.reviewEvents.bulkPut([
      { id: 'a0', card_id: 'a', rating: 2, reviewed_at: '2026-09-01T12:00:00.000Z', _synced: 1 },
      { id: 'b0', card_id: 'b', rating: 2, reviewed_at: '2026-09-01T12:00:00.000Z', _synced: 1 },
      { id: 'a1', card_id: 'a', rating: 2, reviewed_at: '2026-10-24T03:30:00.000Z', _synced: 1 }, // 04:30 BST: in
      { id: 'b1', card_id: 'b', rating: 2, reviewed_at: '2026-10-24T02:59:00.000Z', _synced: 1 }, // 03:59 BST: the day before
      { id: 'a2', card_id: 'a', rating: 3, reviewed_at: '2026-10-25T01:10:00.000Z', _synced: 1 }, // 01:10 GMT: in
    ] as never);
    const day = studyDayNow();
    expect(day.key).toBe('2026-10-24');
    expect(day.startMs).toBe(T('2026-10-24T03:00:00Z'));
    expect(day.endMs).toBe(T('2026-10-25T04:00:00Z'));
    expect((await getTodayReviewSummary()).reviews).toBe(2);
    expect((await getRawQueueCounts()).reviewLoad!.load).toBe(1);
  });

  it('the cached rollover hour is the one used: midnight (0) makes 00:44 a new day', async () => {
    vi.setSystemTime(T('2026-11-17T00:44:00Z'));
    writeDayRolloverHour(0);
    await seedEvening();
    expect(studyToday()).toBe('2026-11-17');
    // Only the 00:30 and 00:40 ratings are on the 17th's calendar day.
    expect((await getTodayReviewSummary()).reviews).toBe(2);
  });
});
