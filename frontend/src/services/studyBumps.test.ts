/**
 * "⚡ Study it today" on the web device: a bump (offline) puts the note's cards first
 * in getStudyQueue — NEW over a spent budget — and in the Home counts; a review ends
 * it; a sync's list replaces the synced rows but never this device's pending ones.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, getStudyQueue, getRawQueueCounts, allocateQueueCounts, sumQueueCounts, createLocalReviewEvent, type LocalCard } from '../db/database';
import { CardQueue } from '../types';
import { bumpNotes, bumpCardTypes, clearBump, replaceLocalBumps, findExistingNotes, flushPendingBumps } from './studyBumps';
import { addBumpsApi, clearBumpApi } from '../api/bumps';
import { writeStudyBudget } from './studyBudget';

vi.mock('./analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../api/bumps', () => ({ addBumpsApi: vi.fn(), clearBumpApi: vi.fn(), listBumpsApi: vi.fn() }));

const iso = () => new Date().toISOString();

async function seed() {
  await db.decks.put({
    id: 'd1', user_id: 'u1', name: 'HSK 2', description: null, new_cards_per_day: 3, secondary_cards_per_day: 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  } as never);
  for (const [id, hanzi] of [['n-bank', '银行'], ['n-apple', '苹果']]) {
    await db.notes.put({ id, deck_id: 'd1', hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  const card = (id: string, noteId: string): LocalCard => ({
    id, note_id: noteId, deck_id: 'd1', card_type: 'hanzi_to_meaning', queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  await db.cards.bulkPut([card('c-bank', 'n-bank'), card('c-apple', 'n-apple')]);
}

describe('study bumps on the device', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear()]);
    await seed();
    writeStudyBudget({ new_cards_per_day: 0, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
  });

  it('a bumped NEW card comes first over a spent budget, and Home counts it', async () => {
    expect((await getStudyQueue()).dueCards).toEqual([]);
    const out = await bumpNotes(['n-bank'], 'coach');
    // No audio, one card: the lead card, one card (shared/decks/study-today.ts).
    expect(out.message).toBe('⚡ 1 card of 银行 added to today');
    expect((await db.studyBumps.where('note_id').equals('n-bank').first())?.card_types).toEqual(['hanzi_to_meaning']);
    const q = await getStudyQueue();
    expect(q.dueCards.map(c => c.id)).toEqual(['c-bank']);
    expect([...q.bumpedCardIds]).toEqual(['c-bank']);
    const counts = sumQueueCounts(allocateQueueCounts(await getRawQueueCounts(), 0).values());
    expect(counts).toMatchObject({ new: 1, bumped: 1 });
    expect((await bumpNotes(['n-bank'], 'coach')).already).toEqual(['n-bank']);
  });

  it('is done once the card is reviewed since the bump', async () => {
    await bumpNotes(['n-bank'], 'coach');
    await new Promise(r => setTimeout(r, 5));
    await createLocalReviewEvent({ id: 'e1', card_id: 'c-bank', rating: 2, time_spent_ms: null, user_answer: null, reviewed_at: iso(), _synced: 0 });
    await db.cards.update('c-bank', { queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const counts = sumQueueCounts(allocateQueueCounts(await getRawQueueCounts(), 0).values());
    expect(counts.bumped).toBe(0);
    expect((await getStudyQueue()).dueCards).toEqual([]);
  });

  it('clearing hides it at once; a sync list never overrides pending rows', async () => {
    await bumpNotes(['n-bank'], 'deck');
    await replaceLocalBumps([{ id: 's1', note_id: 'n-apple', created_at: '2026-10-04 08:00:00', source: 'mcp', bumped_by: null, bumped_by_name: null, hanzi: '苹果', pinyin: '', english: '', deck_id: 'd1', deck_name: 'HSK 2' }]);
    expect((await db.studyBumps.toArray()).map(b => b.note_id).sort()).toEqual(['n-apple', 'n-bank']);
    await clearBump('n-bank');
    expect(await db.studyBumps.where('note_id').equals('n-bank').count()).toBe(0); // pending add → just dropped
    await clearBump('n-apple');
    expect((await db.studyBumps.where('note_id').equals('n-apple').first())?.pending).toBe('clear');
    await replaceLocalBumps([{ id: 's1', note_id: 'n-apple', created_at: '2026-10-04 08:00:00', source: 'mcp', bumped_by: null, bumped_by_name: null, hanzi: '苹果', pinyin: '', english: '', deck_id: 'd1', deck_name: 'HSK 2' }]);
    expect((await db.studyBumps.where('note_id').equals('n-apple').first())?.pending).toBe('clear');
    expect((await getStudyQueue()).dueCards).toEqual([]);
  });

  it('finds a word I already have, punctuation ignored', async () => {
    const hits = await findExistingNotes(' 银行。');
    expect(hits.map(h => [h.note.id, h.deckName])).toEqual([['n-bank', 'HSK 2']]);
  });

  it('on → off while the add is still being sent: the bump is taken out, not brought back by the answer', async () => {
    // The homework pass's ⚡ toggle tapped twice quickly, online.
    const serverRow = { id: 'x', note_id: 'n-bank', created_at: iso(), source: 'homework_pass', bumped_by: null, bumped_by_name: null, hanzi: '银行', pinyin: '', english: '', deck_id: 'd1', deck_name: 'HSK 2' };
    let answerAdd!: (v: unknown) => void;
    vi.mocked(addBumpsApi).mockReturnValueOnce(new Promise((r) => { answerAdd = r; }) as never);
    vi.mocked(clearBumpApi).mockResolvedValueOnce({ cleared: true, bumps: [] } as never);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await bumpNotes(['n-bank'], 'homework_pass');
    // The flush starts after a few IndexedDB round trips (fake-indexeddb ticks): wait for it rather than
    // one macrotask — under load one tick was not enough (CI, 17 Nov), and the never-answered add then
    // hung the next test's flush.
    await vi.waitFor(() => expect(addBumpsApi).toHaveBeenCalledTimes(1));
    await clearBump('n-bank', 'homework_pass');
    expect((await db.studyBumps.where('note_id').equals('n-bank').first())?.pending).toBe('clear');
    answerAdd({ bumps: [serverRow], added: [], already: [], not_found: [] });
    await flushPendingBumps();
    expect(clearBumpApi).toHaveBeenCalledWith('n-bank');
    expect(await db.studyBumps.where('note_id').equals('n-bank').count()).toBe(0);
    expect((await getStudyQueue()).dueCards).toEqual([]);
  });

  describe('the ONE "Study it today" rule (shared/decks/study-today.ts) from any ⚡', () => {
    const cardOf = (id: string, type: string, queue = CardQueue.NEW, dueMs: number | null = null): LocalCard => ({
      id, note_id: 'n-bank', deck_id: 'd1', card_type: type, queue, stability: queue ? 20 : 0, difficulty: 5, lapses: 0,
      learning_step: 0, ease_factor: 2.5, interval: queue ? 12 : 0, repetitions: queue ? 3 : 0,
      next_review_at: dueMs ? new Date(dueMs).toISOString() : null, due_timestamp: dueMs,
      created_at: iso(), updated_at: iso(), _synced_at: null,
    } as LocalCard);

    beforeEach(async () => {
      await db.notes.update('n-bank', { audio_url: 'generated/n-bank.mp3' });
      await db.cards.bulkPut([cardOf('c-bank-m', 'meaning_to_hanzi'), cardOf('c-bank-a', 'audio_to_hanzi')]);
    });

    it('an unstarted word: ONLY its listening card comes today; its siblings wait', async () => {
      const out = await bumpNotes(['n-bank'], 'explorer');
      expect(out.message).toBe('⚡ Listening card of 银行 added to today');
      expect(out.results).toEqual([{ noteId: 'n-bank', kind: 'listening', cardTypes: ['audio_to_hanzi'], added: true }]);
      expect(await db.studyBumps.where('note_id').equals('n-bank').first()).toMatchObject({ card_types: ['audio_to_hanzi'], planned: true, pending: 'add' });
      expect((await getStudyQueue()).dueCards.map(c => c.id)).toEqual(['c-bank-a']);
      // A second tap: already in today.
      expect((await bumpNotes(['n-bank'], 'deck')).already).toEqual(['n-bank']);
    });

    it('a started word: only its listening card (due → first; not due → its one early review), never the others', async () => {
      const later = Date.now() + 12 * 86_400_000;
      await db.cards.bulkPut([
        cardOf('c-bank', 'hanzi_to_meaning', CardQueue.REVIEW, Date.now() - 3_600_000), // due today
        cardOf('c-bank-m', 'meaning_to_hanzi'),
        cardOf('c-bank-a', 'audio_to_hanzi', CardQueue.REVIEW, later),
      ]);
      const out = await bumpNotes(['n-bank'], 'card_hub');
      expect(out.results[0]).toMatchObject({ kind: 'listening', cardTypes: ['audio_to_hanzi'] });
      expect([...(await getStudyQueue()).bumpedCardIds]).toEqual(['c-bank-a']);
    });

    it('a started word with no audio: the whole note, as before', async () => {
      await db.notes.update('n-bank', { audio_url: null });
      await db.cards.update('c-bank', { queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 9 * 86_400_000).toISOString() });
      const out = await bumpNotes(['n-bank'], 'deck');
      expect(out.results[0]).toMatchObject({ kind: 'whole', cardTypes: null });
      expect(out.message).toBe('⚡ 银行 will come first in today’s study');
      expect((await db.studyBumps.where('note_id').equals('n-bank').first())?.planned).toBe(true);
    });

    it('an unstarted word whose clip is still being made: its listening card with "Start new words by ear" (the default), the lead card with it off', async () => {
      // Regression (Nov 2026): a word added from a sentence breakdown has no clip for a few seconds.
      await db.notes.update('n-bank', { audio_url: null });
      try {
        const out = await bumpNotes(['n-bank'], 'explorer');
        expect(out.results[0]).toMatchObject({ kind: 'listening', cardTypes: ['audio_to_hanzi'] });
        expect((await getStudyQueue()).dueCards.map(c => c.id)).toEqual(['c-bank-a']);
        await clearBump('n-bank');
        localStorage.setItem('newCardOrder', JSON.stringify({ new_words_by_ear: false }));
        const off = await bumpNotes(['n-bank'], 'explorer');
        expect(off.results[0]).toMatchObject({ kind: 'lead', cardTypes: ['hanzi_to_meaning'] });
      } finally {
        localStorage.removeItem('newCardOrder');
      }
    });

    it('a word "+ Add as card" just made, not synced down yet: planned here as an unstarted word — its listening card', async () => {
      const out = await bumpNotes(['n-new'], 'explorer', new Map([['n-new', '右侧']]), { justCreated: new Set(['n-new']) });
      expect(out.results[0]).toMatchObject({ kind: 'listening', cardTypes: ['audio_to_hanzi'], added: true });
      expect(out.message).toBe('⚡ Listening card of 右侧 added to today');
      expect(await db.studyBumps.where('note_id').equals('n-new').first()).toMatchObject({ card_types: ['audio_to_hanzi'], planned: true, pending: 'add' });
    });

    it('a note not on this device goes up without a plan (the server applies the rule)', async () => {
      const out = await bumpNotes(['n-elsewhere'], 'mcp', new Map([['n-elsewhere', '想到']]));
      expect(out.added).toEqual(['n-elsewhere']);
      const row = await db.studyBumps.where('note_id').equals('n-elsewhere').first();
      expect(row?.planned).toBeUndefined();
      expect(row?.card_types).toBeUndefined();
    });
  });

  describe('card-level bumps ("Practise this word other ways…")', () => {
    const sibling = (id: string, type: string, queue = CardQueue.NEW, dueMs: number | null = null): LocalCard => ({
      id, note_id: 'n-bank', deck_id: 'd1', card_type: type, queue, stability: queue ? 20 : 0, difficulty: 5, lapses: 0,
      learning_step: 0, ease_factor: 2.5, interval: queue ? 12 : 0, repetitions: queue ? 3 : 0,
      next_review_at: dueMs ? new Date(dueMs).toISOString() : null, due_timestamp: dueMs,
      created_at: iso(), updated_at: iso(), _synced_at: null,
    } as LocalCard);

    beforeEach(async () => {
      await db.cards.bulkPut([
        sibling('c-bank-m', 'meaning_to_hanzi'),
        sibling('c-bank-a', 'audio_to_hanzi', CardQueue.REVIEW, Date.now() + 12 * 86_400_000),
      ]);
    });

    it('only the chosen card enters the queue — first, over a spent budget — and leaves once reviewed', async () => {
      const out = await bumpCardTypes('n-bank', ['meaning_to_hanzi']);
      expect(out).toEqual({ added: true, cardTypes: ['meaning_to_hanzi'] });
      const row = await db.studyBumps.where('note_id').equals('n-bank').first();
      expect(row).toMatchObject({ card_types: ['meaning_to_hanzi'], pending: 'add', source: 'study_card' });
      const q = await getStudyQueue();
      expect(q.dueCards.map(c => c.id)).toEqual(['c-bank-m']);
      expect([...q.bumpedCardIds]).toEqual(['c-bank-m']);
      expect((await bumpCardTypes('n-bank', ['meaning_to_hanzi'])).added).toBe(false);
      await new Promise(r => setTimeout(r, 5));
      await createLocalReviewEvent({ id: 'e-m', card_id: 'c-bank-m', rating: 2, time_spent_ms: null, user_answer: null, reviewed_at: iso(), _synced: 0 });
      await db.cards.update('c-bank-m', { queue: CardQueue.LEARNING, due_timestamp: Date.now() + 600_000 });
      expect((await getStudyQueue()).bumpedCardIds.size).toBe(0);
    });

    it('a started sibling not due yet is reviewed early; adding a second type keeps the open one', async () => {
      await bumpCardTypes('n-bank', ['meaning_to_hanzi']);
      const firstId = (await db.studyBumps.where('note_id').equals('n-bank').first())!.id;
      const out = await bumpCardTypes('n-bank', ['audio_to_hanzi']);
      expect(out).toEqual({ added: true, cardTypes: ['meaning_to_hanzi', 'audio_to_hanzi'] });
      const row = (await db.studyBumps.where('note_id').equals('n-bank').first())!;
      expect(row.id).not.toBe(firstId); // a new client id: an upload on its way never marks it sent
      expect([...(await getStudyQueue()).bumpedCardIds].sort()).toEqual(['c-bank-a', 'c-bank-m']);
    });

    it('uploads card_types; a whole-note bump replaces a card-level one; the sync keeps card_types', async () => {
      await bumpCardTypes('n-bank', ['meaning_to_hanzi']);
      vi.mocked(addBumpsApi).mockResolvedValueOnce({ bumps: [], added: [], already: [], not_found: [] } as never);
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      await flushPendingBumps();
      expect(vi.mocked(addBumpsApi).mock.calls.at(-1)![0][0]).toMatchObject({ note_id: 'n-bank', card_types: ['meaning_to_hanzi'], source: 'study_card' });
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      await replaceLocalBumps([{ id: 's2', note_id: 'n-bank', created_at: iso(), source: 'study_card', bumped_by: null, bumped_by_name: null, card_types: ['audio_to_hanzi'], hanzi: '银行', pinyin: '', english: '', deck_id: 'd1', deck_name: 'HSK 2' }]);
      expect((await db.studyBumps.get('s2'))?.card_types).toEqual(['audio_to_hanzi']);
      const whole = await bumpNotes(['n-bank'], 'coach');
      expect(whole.added).toEqual(['n-bank']);
      expect((await db.studyBumps.where('note_id').equals('n-bank').first())?.card_types ?? null).toBeNull();
      // Now the whole word is in: a card-level request is already covered.
      expect((await bumpCardTypes('n-bank', ['audio_to_hanzi'])).added).toBe(false);
    });
  });
});
