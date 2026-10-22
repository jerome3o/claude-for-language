/**
 * Suspend & snooze on the web device (shared/decks/holds.ts): a hold (offline) takes the card out
 * of getStudyQueue AND the Home counts at once, a held NEW card frees its slot for the next new
 * card, Unsuspend brings it back, a sync's list never overrides pending rows, and sibling burying
 * follows the Settings switch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, getStudyQueue, getRawQueueCounts, allocateQueueCounts, sumQueueCounts, createLocalReviewEvent, type LocalCard } from '../db/database';
import { CardQueue } from '../types';
import { holdCards, releaseCards, replaceLocalHolds, flushPendingHolds, loadHeldCardRows, restoreHolds } from './cardHolds';
import { addHoldsApi, clearHoldsApi } from '../api/cardHolds';
import { writeStudyBudget } from './studyBudget';
import { writeBurySiblings } from './burySiblings';

vi.mock('./analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../api/cardHolds', () => ({ addHoldsApi: vi.fn(), clearHoldsApi: vi.fn(), listHoldsApi: vi.fn(), setBurySiblingsApi: vi.fn() }));

const iso = () => new Date().toISOString();

async function seed() {
  await db.decks.put({
    id: 'd1', user_id: 'u1', name: 'HSK 2', description: null, new_cards_per_day: 5, secondary_cards_per_day: 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  } as never);
  for (const [id, hanzi] of [['n-bank', '银行'], ['n-apple', '苹果'], ['n-tea', '茶']]) {
    await db.notes.put({ id, deck_id: 'd1', hanzi, pinyin: 'pīnyīn', english: 'meaning', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  const card = (id: string, noteId: string, type = 'hanzi_to_meaning'): LocalCard => ({
    id, note_id: noteId, deck_id: 'd1', card_type: type, queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  await db.cards.bulkPut([card('c-bank', 'n-bank'), card('c-bank-m', 'n-bank', 'meaning_to_hanzi'), card('c-apple', 'n-apple'), card('c-tea', 'n-tea')]);
}

const totals = async () => sumQueueCounts(allocateQueueCounts(await getRawQueueCounts(), 0).values());

describe('card holds on the device', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.cardHolds.clear()]);
    await seed();
    writeStudyBudget({ new_cards_per_day: 2, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
    writeBurySiblings(false);
    vi.mocked(addHoldsApi).mockReset();
    vi.mocked(clearHoldsApi).mockReset();
  });

  it('a suspended NEW card leaves study and the next new card takes its slot; Unsuspend brings it back', async () => {
    const before = await getStudyQueue();
    expect(before.dueCards.map(c => c.id).sort()).toEqual(['c-apple', 'c-bank']);
    const out = await holdCards(['c-bank'], 'suspend', { scope: 'card', source: 'study' });
    expect(out.message).toMatch(/^Suspended/);
    const q = await getStudyQueue();
    expect(q.dueCards.map(c => c.id).sort()).toEqual(['c-apple', 'c-tea']);
    expect((await totals()).new).toBe(2);
    const rows = await loadHeldCardRows();
    expect(rows.map(r => [r.card_id, r.hanzi, r.deck_name, r.hold.kind])).toEqual([['c-bank', '银行', 'HSK 2', 'suspend']]);
    await releaseCards(['c-bank'], 'held_list');
    expect((await getStudyQueue()).dueCards.map(c => c.id).sort()).toEqual(['c-apple', 'c-bank']);
    // Undo of the release puts the hold back.
    await restoreHolds([{ card_id: 'c-bank', kind: 'suspend', until: null }]);
    expect((await getStudyQueue()).dueCards.map(c => c.id)).not.toContain('c-bank');
  });

  it('a snoozed review card is not due until its date; a sync list never overrides pending rows', async () => {
    await db.cards.update('c-apple', { queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() - 86_400_000).toISOString() });
    expect((await totals()).review).toBe(1);
    await holdCards(['c-apple'], 'snooze', { length: 'week', scope: 'card', source: 'study' });
    expect((await totals()).review).toBe(0);
    // The server's list (without this device's pending hold) does not undo it.
    await replaceLocalHolds([]);
    expect((await totals()).review).toBe(0);
    // Uploaded: the pending flag clears and the server's list then rules.
    vi.mocked(addHoldsApi).mockImplementation(async (items) => ({
      holds: items.map(i => ({ ...i, source: 'app', note_id: 'n-apple', card_type: 'hanzi_to_meaning', hanzi: '苹果', pinyin: '', english: '', deck_id: 'd1', deck_name: 'HSK 2' })),
      added: items.map(i => i.card_id), already: [], not_found: [], invalid: [],
    }));
    await flushPendingHolds();
    expect(vi.mocked(addHoldsApi).mock.calls[0][0][0]).toMatchObject({ card_id: 'c-apple', kind: 'snooze' });
    expect((await db.cardHolds.toArray()).every(h => !h.pending)).toBe(true);
    await replaceLocalHolds([]);
    expect((await totals()).review).toBe(1);
  });

  it('sibling burying: a word reviewed today keeps its other new cards back until tomorrow', async () => {
    writeStudyBudget({ new_cards_per_day: 5, secondary_cards_per_day: 5, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
    await createLocalReviewEvent({ id: 'e1', card_id: 'c-bank', rating: 2, time_spent_ms: null, user_answer: null, reviewed_at: iso(), _synced: 0 });
    await db.cards.update('c-bank', { queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect((await getStudyQueue()).dueCards.map(c => c.id)).toContain('c-bank-m');
    writeBurySiblings(true);
    expect((await getStudyQueue()).dueCards.map(c => c.id)).not.toContain('c-bank-m');
    expect((await totals()).secondaryNew).toBe(0);
  });
});
