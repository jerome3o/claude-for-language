/**
 * Leaving Study doesn't end anything (docs/STUDY_SESSION.md "Today is the session"): the card
 * on screen when Study was left comes back first, with its resume point (revealed, answer),
 * while it is still due today; the undo survives the visit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db, type LocalCard, type LocalDeck, type LocalNote } from '../db/database';
import { useStudySession } from './useStudySession';
import { getLocalDateString } from '../api/client';
import { _resetStudyResume, loadResumePoint, saveResumePoint } from '../services/studyResume';

vi.mock('../services/sentence-sets', () => ({ ensureSentenceSetForNote: vi.fn(async () => {}) }));
vi.mock('../services/sync', () => ({ syncService: { syncEvents: vi.fn(async () => {}), syncInBackground: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DUE = Date.now() - 3_600_000;

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
    id, note_id: noteId, deck_id: 'deck-1', card_type: 'meaning_to_hanzi', queue: 2, stability: 10, difficulty: 5,
    lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 10, repetitions: 3, next_review_at: new Date(DUE).toISOString(),
    due_timestamp: DUE, last_reviewed_at: new Date(DUE - 10 * 86_400_000).toISOString(),
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', _synced_at: Date.now(),
  } as LocalCard;
}

let latest: ReturnType<typeof useStudySession>;
function Harness() {
  latest = useStudySession({ deckId: 'deck-1' });
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement;
async function mount() {
  container = document.createElement('div');
  const client = new QueryClient();
  await act(async () => {
    root = createRoot(container);
    root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  });
  await vi.waitFor(() => expect(latest.isLoading).toBe(false));
  await vi.waitFor(() => expect(latest.currentCard).not.toBeNull());
}
async function unmount() {
  await act(async () => root?.unmount());
  root = null;
}

describe('resuming study', () => {
  beforeEach(async () => {
    _resetStudyResume();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await db.decks.put(deck());
    const ids = ['a', 'b', 'c', 'd', 'e'];
    await db.notes.bulkPut(ids.map((n, i) => note(`n-${n}`, '一二三四五'[i])));
    await db.cards.bulkPut(ids.map((n) => reviewCard(`c-${n}`, `n-${n}`)));
  });
  afterEach(async () => {
    await unmount();
    vi.unstubAllGlobals();
  });

  it('shows the card that was on screen first, revealed with its answer', async () => {
    saveResumePoint({ day: getLocalDateString(), scope: 'deck-1', card_id: 'c-d', revealed: true, answer: '四', elapsed_ms: 9_000 });
    await mount();
    expect(latest.currentCard?.id).toBe('c-d');
    expect(latest.resume).toMatchObject({ card_id: 'c-d', revealed: true, answer: '四' });
  });

  it('ignores a point from another day, another deck, or for a card no longer due', async () => {
    saveResumePoint({ day: '2020-01-01', scope: 'deck-1', card_id: 'c-d', revealed: true, answer: '四', elapsed_ms: 0 });
    await mount();
    expect(latest.resume).toBeNull();
    await unmount();

    saveResumePoint({ day: getLocalDateString(), scope: 'all', card_id: 'c-d', revealed: true, answer: '四', elapsed_ms: 0 });
    await mount();
    expect(latest.resume).toBeNull();
    await unmount();

    const later = Date.now() + 30 * 86_400_000;
    await db.cards.update('c-d', { due_timestamp: later, next_review_at: new Date(later).toISOString() });
    saveResumePoint({ day: getLocalDateString(), scope: 'deck-1', card_id: 'c-d', revealed: true, answer: '四', elapsed_ms: 0 });
    await mount();
    expect(latest.resume).toBeNull();
    expect(latest.currentCard?.id).not.toBe('c-d');
  });

  it('rating the resumed card clears the point; the undo survives leaving and coming back', async () => {
    saveResumePoint({ day: getLocalDateString(), scope: 'deck-1', card_id: 'c-b', revealed: true, answer: '二', elapsed_ms: 1_000 });
    await mount();
    expect(latest.currentCard?.id).toBe('c-b');
    await act(async () => { await latest.rateCard(2, 4_000, '二'); });
    await act(async () => { await latest.flushWrites(); });
    expect(loadResumePoint()).toBeNull();
    expect(latest.resume).toBeNull();
    expect(latest.canUndo).toBe(true);
    expect(await db.reviewEvents.count()).toBe(1);

    await unmount(); // ✕ — nothing ends
    await mount();
    expect(latest.canUndo).toBe(true);
    await act(async () => { await latest.undoLastReview(); });
    await vi.waitFor(() => expect(latest.currentCard?.id).toBe('c-b'));
    expect(await db.reviewEvents.count()).toBe(0);
    expect(latest.canUndo).toBe(false);
  });
});
