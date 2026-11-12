/**
 * The homework pass's ⚡ (shared/homework/pass-bump.ts): an unstarted word with audio puts ONLY its
 * listening card in today's study — the queue gains exactly one card — and goes into long-term
 * review; a second tap takes both back. A word with no audio bumps its lead card (one card).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db, getStudyQueue, type LocalCard, type LocalNote } from '../../db/database';
import { CardQueue } from '../../types';
import { writeStudyBudget } from '../../services/studyBudget';
import { PassBumpButton } from './PassBumpButton';

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../../api/bumps', () => ({ addBumpsApi: vi.fn(), clearBumpApi: vi.fn(), listBumpsApi: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const iso = () => new Date().toISOString();
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

async function seed(audio: string | null, oneOff = true) {
  await db.decks.put({
    id: 'd1', user_id: 'u1', name: '餐厅点菜', description: null, new_cards_per_day: oneOff ? 0 : 3, secondary_cards_per_day: oneOff ? 0 : 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  } as never);
  await db.notes.put({ id: 'n1', deck_id: 'd1', hanzi: '服务员', pinyin: 'fúwùyuán', english: 'waiter', audio_url: audio, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  await db.cards.bulkPut(TYPES.map((t) => ({
    id: `c-${t[0]}`, note_id: 'n1', deck_id: 'd1', card_type: t, queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard)));
}

describe('PassBumpButton', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear(), db.pendingNotePrefs.clear()]);
    writeStudyBudget({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true, set_by: null, set_by_name: null, set_at: null } as never);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function show(deckInReview = false) {
    const note = (await db.notes.get('n1')) as LocalNote;
    const cards = await db.cards.where('note_id').equals('n1').toArray();
    await act(async () => root.render(<PassBumpButton note={note} cards={cards} started={false} deckInReview={deckInReview} />));
  }
  const button = () => host.querySelector('button')!;
  async function waitFor(what: () => boolean) {
    for (let i = 0; i < 100 && !what(); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(what()).toBe(true);
  }

  it('an unstarted word with audio: ⚡ adds exactly ONE card — the listening card — and opts it into long-term', async () => {
    await seed('generated/n1.mp3');
    expect((await getStudyQueue()).dueCards).toEqual([]); // a one-off copy: nothing from the budget
    await show();
    expect(button().textContent).toBe('⚡ Study it today · listening card');
    await act(async () => button().click());
    await waitFor(() => button().textContent === '⚡ Listening card today ✓');
    expect(host.querySelector('[data-testid="pass-bump-hint"]')?.textContent).toMatch(/other cards come later/);
    const row = await db.studyBumps.where('note_id').equals('n1').first();
    expect(row?.source).toBe('homework_pass');
    expect(row?.card_types).toEqual(['audio_to_hanzi']);
    expect((await db.notes.get('n1'))?.long_term).toBe(1);
    const q = await getStudyQueue();
    expect(q.dueCards.map((c) => c.id)).toEqual(['c-a']);

    // A second tap takes it out, and the long-term choice goes back.
    await act(async () => button().click());
    await waitFor(() => button().textContent === '⚡ Study it today · listening card');
    expect(await db.studyBumps.where('note_id').equals('n1').count()).toBe(0);
    await waitFor(() => true);
    expect((await db.notes.get('n1'))?.long_term ?? null).toBeNull();
  });

  it('a word in a deck in daily review: still one card, and its siblings wait (not blue cards today)', async () => {
    await seed('generated/n1.mp3', false);
    expect((await getStudyQueue()).dueCards.map((c) => c.id)).toContain('c-h'); // without ⚡: its blue card(s) from the budget
    await show(true);
    await act(async () => button().click());
    await waitFor(() => button().getAttribute('aria-pressed') === 'true');
    expect((await getStudyQueue()).dueCards.map((c) => c.id)).toEqual(['c-a']);
    expect((await db.notes.get('n1'))?.long_term ?? null).toBeNull(); // already in long-term review
  });

  it('no audio: one card, the lead card', async () => {
    await seed(null);
    await show();
    expect(button().textContent).toBe('⚡ Study it today · 1 card');
    await act(async () => button().click());
    await waitFor(() => button().textContent === '⚡ 1 card today ✓');
    expect((await db.studyBumps.where('note_id').equals('n1').first())?.card_types).toEqual(['hanzi_to_meaning']);
    expect((await getStudyQueue()).dueCards.map((c) => c.id)).toEqual(['c-h']);
  });
});
