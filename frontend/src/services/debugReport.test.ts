import { describe, it, expect, vi, afterEach } from 'vitest';
import { db, getStudyQueue, createLocalReviewEvent, type LocalCard } from '../db/database';
import { CardQueue, type CardType } from '../types';
import { buildDebugReport, sendDebugReport } from './debugReport';
import { eventIdHash, validateDebugReport } from '@shared/debug';

const DAY = 24 * 60 * 60 * 1000;

async function deck(id: string, priority = 0) {
  await db.decks.put({
    id, user_id: 'u', name: `Deck ${id}`, description: null, new_cards_per_day: 3, secondary_cards_per_day: 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, study_priority: priority,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', _synced_at: null,
  });
}

async function card(id: string, deckId: string, noteId: string, type: CardType, queue: CardQueue, extra: Partial<LocalCard> = {}) {
  await db.cards.put({
    id, note_id: noteId, deck_id: deckId, card_type: type, queue, stability: 0, difficulty: 0, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: '2026-01-01', updated_at: '2026-01-01', _synced_at: null, ...extra,
  });
}

async function note(id: string, deckId: string) {
  await db.notes.put({
    id, deck_id: deckId, hanzi: '学习', pinyin: 'xuéxí', english: 'to study', audio_url: null, audio_provider: null,
    fun_facts: null, context: null, sentence_clue: null, sentence_clue_pinyin: null, sentence_clue_translation: null,
    sentence_clue_audio_url: null, multiple_choice_options: null, pinyin_only: 0, alternatives: null,
    created_at: '2026-01-01', updated_at: '2026-01-01', _synced_at: null,
  });
}

async function seed() {
  const now = Date.now();
  await deck('d1', 1);
  await deck('d2', 0);
  await note('n1', 'd1');
  await note('n2', 'd1');
  await note('n3', 'd2');
  await card('n1-h', 'd1', 'n1', 'hanzi_to_meaning', CardQueue.REVIEW, { next_review_at: new Date(now - DAY).toISOString(), repetitions: 2 });
  await card('n1-m', 'd1', 'n1', 'meaning_to_hanzi', CardQueue.NEW);
  await card('n2-h', 'd1', 'n2', 'hanzi_to_meaning', CardQueue.NEW);
  // A learning card due in 3 days: counted by the home screen, not in the queue.
  await card('n3-h', 'd2', 'n3', 'hanzi_to_meaning', CardQueue.LEARNING, { due_timestamp: now + 3 * DAY, repetitions: 1 });
  await card('n3-m', 'd2', 'n3', 'meaning_to_hanzi', CardQueue.NEW);
  for (const [id, cardId, at] of [
    ['e1', 'n1-h', now - 10 * DAY],
    ['e2', 'n1-h', now - 5 * DAY],
    ['e3', 'n3-h', now - 2 * DAY],
    ['e4', 'gone-card', now - 3 * DAY],
  ] as const) {
    await createLocalReviewEvent({ id, card_id: cardId, rating: 2, time_spent_ms: 1000, user_answer: null, reviewed_at: new Date(at).toISOString(), _synced: id === 'e3' ? 0 : 1 });
  }
  // One overdue one-off homework pass (the Home screen's Homework card).
  await db.homeworkAssignments.put({
    id: 'hw1', relationship_id: 'r', tutor_id: 't', student_id: 'u', batch_id: null, kind: 'deck', target_id: 'd1',
    source_id: null, title: 'Week 1', mode: 'one_off', due_date: '2020-01-01', item_ids: ['n1', 'n2'], item_count: 2,
    part_index: 0, part_count: 1, status: 'active', done_count: 0, completed_at: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', _synced_at: 0,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildDebugReport', () => {
  it('builds a valid report from IndexedDB with the numbers the home screen and study queue use', async () => {
    await seed();
    const r = await buildDebugReport();
    expect(validateDebugReport(r)).toEqual([]);
    expect(r.client).toBe('web');
    expect(r.totals).toMatchObject({ decks: 2, notes: 3, cards: 5, events: 4, unsynced_events: 1, orphan_events: 1 });
    expect(r.event_hashes).toEqual(['e1', 'e2', 'e3', 'e4'].map(eventIdHash).sort());

    // The queue flags match getStudyQueue exactly.
    const q = await getStudyQueue(undefined, 0);
    const flagged = r.cards.filter(c => c[9] === 1).map(c => c[0]).sort();
    expect(flagged).toEqual(q.dueCards.map(c => c.id).sort());
    expect(r.queue.due_cards).toBe(q.dueCards.length);

    // Home counts every learning card (no cutoff); the queue does not hold the one due in 3 days.
    expect(r.home.counts.learning).toBe(1);
    expect(r.queue.from_due_cards.learning).toBe(0);
    expect(r.home.total).toBe(r.home.counts.new + r.home.counts.secondaryNew + r.home.counts.learning + r.home.counts.review);

    const n1h = r.cards.find(c => c[0] === 'n1-h')!;
    expect(n1h.slice(4, 9)).toEqual([CardQueue.REVIEW, expect.any(Number), 2, 0, 2]);
    expect(n1h[10]).toBeLessThan(Date.now() - 9 * DAY);
    const d1 = r.decks.find(d => d.id === 'd1')!;
    expect(d1).toMatchObject({ priority: 1, note_count: 2, card_count: 3, pools: { totalNew: 1, totalSecondaryNew: 1, review: 1 } });
    expect(r.decks.find(d => d.id === 'd2')!.pools.learning).toBe(1);
    expect(r.homework).toEqual({ todo: 1, overdue: 1, due_today: 0, done: 0 });
  });
});

describe('sendDebugReport', () => {
  it('posts the report (gzip when available) and returns the stored id', async () => {
    await seed();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: { id: 'rep-1' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendDebugReport();
    expect(res).toMatchObject({ id: 'rep-1', cards: 5, events: 4 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/debug/reports');
    expect(init.method).toBe('POST');
  });

  it('surfaces the server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid report' }), { status: 400 })));
    await expect(sendDebugReport()).rejects.toThrow('Invalid report');
  });
});
