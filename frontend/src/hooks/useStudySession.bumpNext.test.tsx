/**
 * "⚡ Study it today" DURING a session (shared/decks/bump-next.ts): a NEW word bumped while a card is on
 * screen — the sentence breakdown → explorer → "+ Add as card" → ⚡, any ⚡ — never replaces that card, and
 * its lead card (the listening card, "Start new words by ear") is the very next card once it is rated;
 * several words come next in the order bumped. Jerome, Nov 2026: "Don't add the new card to the mix
 * straight away … it would be good if that blue card appeared straight away."
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db, type LocalCard, type LocalDeck, type LocalNote } from '../db/database';
import { useStudySession } from './useStudySession';
import { _resetStudyResume } from '../services/studyResume';
import { bumpNotes } from '../services/studyBumps';
import { writeStudyBudget } from '../services/studyBudget';

vi.mock('../services/sentence-sets', () => ({ ensureSentenceSetForNote: vi.fn(async () => {}) }));
vi.mock('../services/sync', () => ({ syncService: { syncEvents: vi.fn(async () => {}), syncInBackground: vi.fn(), addSyncListener: vi.fn(() => () => true) } }));
vi.mock('../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DUE = Date.now() - 3_600_000;
const NOTES = ['a', 'b', 'c', 'd', 'e', 'f'];

function deck(): LocalDeck {
  return {
    id: 'deck-1', user_id: 'u1', name: 'HSK 3', description: null, new_cards_per_day: 3, secondary_cards_per_day: 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, study_priority: 0,
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
  };
}

function note(id: string, hanzi: string): LocalNote {
  return {
    id, deck_id: 'deck-1', hanzi, pinyin: 'x', english: 'y', audio_url: null, audio_provider: null, fun_facts: 'f',
    context: null, sentence_clue: 's', sentence_clue_pinyin: null, sentence_clue_translation: null,
    sentence_clue_audio_url: null, multiple_choice_options: null, pinyin_only: 0, alternatives: null,
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
  } as LocalNote;
}

function reviewCard(id: string, noteId: string): LocalCard {
  return {
    id, note_id: noteId, deck_id: 'deck-1', card_type: 'hanzi_to_meaning', queue: 2, stability: 10, difficulty: 5,
    lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 10, repetitions: 3, next_review_at: new Date(DUE).toISOString(),
    due_timestamp: DUE, last_reviewed_at: new Date(DUE - 10 * 86_400_000).toISOString(),
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
  } as LocalCard;
}

function newSibling(id: string, noteId: string): LocalCard {
  return {
    id, note_id: noteId, deck_id: 'deck-1', card_type: 'meaning_to_hanzi', queue: 0, stability: 0, difficulty: 0,
    lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
  } as LocalCard;
}

let latest: ReturnType<typeof useStudySession>;
function Harness() {
  latest = useStudySession({ deckId: 'deck-1' });
  return null;
}

let root: Root | null = null;
async function mount() {
  const container = document.createElement('div');
  const client = new QueryClient();
  await act(async () => {
    root = createRoot(container);
    root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  });
  await vi.waitFor(() => expect(latest.isLoading).toBe(false), { timeout: 8000 });
  await vi.waitFor(() => expect(latest.currentCard).not.toBeNull());
}

function freshCard(id: string, noteId: string, type: string): LocalCard {
  return { ...newSibling(id, noteId), card_type: type };
}

describe('⚡ during a session: the new word comes next', () => {
  beforeEach(async () => {
    _resetStudyResume();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear()]);
    // The daily budget is spent: new cards only come in through the ⚡ pocket.
    writeStudyBudget({ new_cards_per_day: 0, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
    await db.decks.put(deck());
    await db.notes.bulkPut(NOTES.map((n, i) => note(`n-${n}`, '一二三四五六'[i])));
    await db.cards.bulkPut(NOTES.map((n) => reviewCard(`c-${n}`, `n-${n}`)));
    // Two words just added (no clip yet): three NEW cards each.
    for (const [id, hanzi] of [['w1', '右侧'], ['w2', '左边']]) {
      await db.notes.put(note(`n-${id}`, hanzi));
      await db.cards.bulkPut([
        freshCard(`${id}-h`, `n-${id}`, 'hanzi_to_meaning'),
        freshCard(`${id}-m`, `n-${id}`, 'meaning_to_hanzi'),
        freshCard(`${id}-a`, `n-${id}`, 'audio_to_hanzi'),
      ]);
    }
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
  });

  it('the bumped word\'s listening card is the very next card — the card on screen stays', async () => {
    await mount();
    const onScreen = latest.currentCard!.id;
    await act(async () => { await bumpNotes(['n-w1'], 'explorer'); });
    await vi.waitFor(() => expect(latest.bumpedCardIds.has('w1-a')).toBe(true));
    expect(latest.currentCard!.id).toBe(onScreen);
    await act(async () => { await latest.rateCard(2, 3_000); });
    expect(latest.currentCard!.id).toBe('w1-a');
    // Its other cards wait (they come later as purple cards).
    await act(async () => { await latest.rateCard(2, 3_000); });
    expect(latest.currentCard!.id.startsWith('w1-')).toBe(false);
    expect(latest.bumpedCardIds.has('w1-a')).toBe(false);
  });

  it('several words bumped on one card come next in the order bumped', async () => {
    await mount();
    await act(async () => { await bumpNotes(['n-w2'], 'explorer'); });
    await new Promise((r) => setTimeout(r, 5));
    await act(async () => { await bumpNotes(['n-w1'], 'ask_claude'); });
    await vi.waitFor(() => expect(latest.bumpedCardIds.has('w1-a') && latest.bumpedCardIds.has('w2-a')).toBe(true));
    await act(async () => { await latest.rateCard(2, 3_000); });
    expect(latest.currentCard!.id).toBe('w2-a');
    await act(async () => { await latest.rateCard(2, 3_000); });
    expect(latest.currentCard!.id).toBe('w1-a');
  });
});
