/**
 * Study opened before the device has its words (a new device's first sync, Study opened while it
 * runs): the empty session builds its queue again when a sync finishes, instead of staying on
 * "Nothing due right now" until Study is opened again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db, type LocalCard, type LocalDeck, type LocalNote } from '../db/database';
import { useStudySession } from './useStudySession';
import { _resetStudyResume } from '../services/studyResume';

const listeners = new Set<(syncing: boolean) => void>();
vi.mock('../services/sentence-sets', () => ({ ensureSentenceSetForNote: vi.fn(async () => {}) }));
vi.mock('../services/sync', () => ({
  syncService: {
    syncEvents: vi.fn(async () => {}),
    syncInBackground: vi.fn(),
    addSyncListener: (l: (syncing: boolean) => void) => { listeners.add(l); return () => listeners.delete(l); },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DUE = Date.now() - 3_600_000;

const deck: LocalDeck = {
  id: 'deck-1', user_id: 'u1', name: 'HSK 3', description: null, new_cards_per_day: 3, secondary_cards_per_day: 6,
  request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
  relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
  hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, study_priority: 0,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
};

const note = {
  id: 'n-1', deck_id: 'deck-1', hanzi: '辛苦', pinyin: 'xīnkǔ', english: 'tiring', audio_url: null, audio_provider: null, fun_facts: 'f',
  context: null, sentence_clue: 's', sentence_clue_pinyin: null, sentence_clue_translation: null,
  sentence_clue_audio_url: null, multiple_choice_options: null, pinyin_only: 0, alternatives: null,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
} as LocalNote;

const card = {
  id: 'c-1', note_id: 'n-1', deck_id: 'deck-1', card_type: 'meaning_to_hanzi', queue: 2, stability: 10, difficulty: 5,
  lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 10, repetitions: 3, next_review_at: new Date(DUE).toISOString(),
  due_timestamp: DUE, last_reviewed_at: new Date(DUE - 10 * 86_400_000).toISOString(),
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
} as LocalCard;

let latest: ReturnType<typeof useStudySession>;
function Harness() {
  latest = useStudySession({ deckId: 'deck-1' });
  return null;
}

let root: Root | null = null;

describe('a session opened before the words arrived', () => {
  beforeEach(async () => {
    _resetStudyResume();
    localStorage.clear();
    listeners.clear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await db.decks.put(deck);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
  });

  it('builds the queue again when a sync finishes, and shows the card', async () => {
    await act(async () => {
      root = createRoot(document.createElement('div'));
      root.render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>);
    });
    await vi.waitFor(() => expect(latest.isLoading).toBe(false));
    expect(latest.currentCard).toBeNull();

    // The sync brings the word down, then says it's done.
    await db.notes.put(note);
    await db.cards.put(card);
    await act(async () => { listeners.forEach((l) => l(true)); });
    expect(latest.currentCard).toBeNull();
    await act(async () => { listeners.forEach((l) => l(false)); });
    await vi.waitFor(() => expect(latest.currentCard?.id).toBe('c-1'));
  });
});
