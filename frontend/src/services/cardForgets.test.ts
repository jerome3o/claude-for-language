/**
 * "Forget this card" on the web device (shared/scheduler forget events): a forget (offline) puts the
 * card back to NEW at once and keeps its reviews, a review after it is a first review again
 * (introduced today), Undo restores the old schedule, a sync's list replays cards whose forgets
 * changed, and pending rows are never overridden.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, createLocalReviewEvent, getStudyQueue, introducedTodayFromEvents, type LocalCard } from '../db/database';
import { CardQueue } from '../types';
import { forgetCards, undoForget, replaceLocalForgets, flushPendingForgets } from './cardForgets';
import { recomputeCardFromEvents } from './review-events';
import { addForgetsApi, undoForgetsApi } from '../api/cardForgets';
import { writeStudyBudget } from './studyBudget';

vi.mock('./analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../api/cardForgets', () => ({ addForgetsApi: vi.fn(), undoForgetsApi: vi.fn(), listForgetsApi: vi.fn() }));

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

async function seed() {
  const iso = new Date().toISOString();
  await db.decks.put({
    id: 'd1', user_id: 'u1', name: 'HSK 2', description: null, new_cards_per_day: 5, secondary_cards_per_day: 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso, updated_at: iso, _synced_at: null,
  } as never);
  await db.notes.put({ id: 'n-bank', deck_id: 'd1', hanzi: '银行', pinyin: 'yínháng', english: 'bank', audio_url: null, fun_facts: null, created_at: iso, updated_at: iso, _synced_at: null } as never);
  const card = (id: string, type: string): LocalCard => ({
    id, note_id: 'n-bank', deck_id: 'd1', card_type: type, queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: iso, updated_at: iso, _synced_at: null,
  } as LocalCard);
  await db.cards.bulkPut([card('c-h', 'hanzi_to_meaning'), card('c-m', 'meaning_to_hanzi')]);
  const ev = (id: string, cardId: string, rating: 0 | 1 | 2 | 3, at: string) =>
    createLocalReviewEvent({ id, card_id: cardId, rating, time_spent_ms: null, user_answer: null, reviewed_at: at, _synced: 1 });
  await ev('e1', 'c-h', 2, ago(30));
  await ev('e2', 'c-h', 2, ago(29.99));
  await ev('e3', 'c-h', 2, ago(25));
  await ev('e4', 'c-m', 2, ago(30));
  await recomputeCardFromEvents('c-h');
  await recomputeCardFromEvents('c-m');
}

describe('card forgets on the device', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.cardForgets.clear(), db.cardHolds.clear()]);
    await seed();
    writeStudyBudget({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
    vi.mocked(addForgetsApi).mockReset();
    vi.mocked(undoForgetsApi).mockReset();
  });

  it('a forgotten card is NEW again, its reviews kept; Undo restores the old schedule', async () => {
    const before = await db.cards.get('c-h');
    expect(before!.queue).not.toBe(CardQueue.NEW);
    const out = await forgetCards(['c-h'], { scope: 'card', source: 'study' });
    expect(out.message).toBe('Card reset to New.');
    const after = await db.cards.get('c-h');
    expect(after).toMatchObject({ queue: CardQueue.NEW, repetitions: 0, lapses: 0, next_review_at: null });
    expect(await db.reviewEvents.where('card_id').equals('c-h').count()).toBe(3);
    // It re-enters the new-card queue (as a secondary card: its sibling is still started).
    const q = await getStudyQueue();
    expect(q.dueCards.map((c) => c.id)).toContain('c-h');
    const msg = await undoForget(out.ids);
    expect(msg).toMatch(/^Forget undone/);
    const back = await db.cards.get('c-h');
    expect(back!.queue).toBe(before!.queue);
    expect(back!.next_review_at).toBe(before!.next_review_at);
    expect(await db.cardForgets.count()).toBe(0);
  });

  it('uploads pending forgets and undos; the server list never overrides pending rows', async () => {
    const out = await forgetCards(['c-h', 'c-m'], { scope: 'note', source: 'study' });
    vi.mocked(addForgetsApi).mockResolvedValue({ forgets: out.ids.map((id, i) => ({ id, card_id: i ? 'c-m' : 'c-h', forgotten_at: new Date().toISOString() })) });
    vi.mocked(undoForgetsApi).mockResolvedValue({ undone: 1, forgets: [] });
    await flushPendingForgets();
    expect(vi.mocked(addForgetsApi).mock.calls[0][0].map((i) => i.card_id).sort()).toEqual(['c-h', 'c-m']);
    expect((await db.cardForgets.toArray()).every((f) => !f.pending)).toBe(true);
    // A sent forget undone → pending 'undo' until the server has it.
    await undoForget([out.ids[0]]);
    expect((await db.cardForgets.get(out.ids[0]))?.pending).toBe('undo');
    // A sync list without it can't bring back the old row, nor drop the pending undo.
    await replaceLocalForgets([{ id: out.ids[0], card_id: 'c-h', forgotten_at: ago(0) }, { id: out.ids[1], card_id: 'c-m', forgotten_at: ago(0) }]);
    expect((await db.cardForgets.get(out.ids[0]))?.pending).toBe('undo');
    expect((await db.cards.get('c-h'))!.queue).not.toBe(CardQueue.NEW);
  });

  it('a review after the forget is a first review again: introduced today (counts against the budget)', async () => {
    await forgetCards(['c-h'], { scope: 'card', source: 'study' });
    await new Promise((r) => setTimeout(r, 5));
    await createLocalReviewEvent({ id: 'e5', card_id: 'c-h', rating: 2, time_spent_ms: null, user_answer: null, reviewed_at: new Date().toISOString(), _synced: 0 });
    const introduced = await introducedTodayFromEvents();
    // Its sibling was started long ago: a secondary (purple) card introduced today.
    expect(introduced.get('d1')).toEqual({ primary: 0, secondary: 1 });
  });

  it("another device's forget arriving in a sync replays the card; its removal restores it", async () => {
    const changed = await replaceLocalForgets([{ id: 'remote-1', card_id: 'c-m', forgotten_at: ago(1) }]);
    expect(changed).toBe(1);
    expect((await db.cards.get('c-m'))!.queue).toBe(CardQueue.NEW);
    await replaceLocalForgets([]);
    expect((await db.cards.get('c-m'))!.queue).not.toBe(CardQueue.NEW);
  });
});
