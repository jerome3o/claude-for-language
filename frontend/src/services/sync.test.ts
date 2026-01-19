import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncService } from './sync';
import { db, getSyncMeta, updateSyncMeta, LocalDeck, LocalNote } from '../db/database';
import { CardQueue } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create mock deck data
function createMockDeck(id: string, name: string): any {
  return {
    id,
    user_id: 'user-1',
    name,
    description: null,
    new_cards_per_day: 30,
    learning_steps: '1 10',
    graduating_interval: 1,
    easy_interval: 4,
    relearning_steps: '10',
    starting_ease: 2.5,
    minimum_ease: 1.3,
    maximum_ease: 3.0,
    interval_modifier: 1.0,
    hard_multiplier: 1.2,
    easy_bonus: 1.3,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function createMockNote(id: string, deckId: string, hanzi: string): any {
  return {
    id,
    deck_id: deckId,
    hanzi,
    pinyin: 'pīnyīn',
    english: 'english',
    audio_url: null,
    fun_facts: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function createMockCard(id: string, noteId: string, cardType: string): any {
  return {
    id,
    note_id: noteId,
    card_type: cardType,
    queue: CardQueue.NEW,
    learning_step: 0,
    ease_factor: 2.5,
    interval: 0,
    repetitions: 0,
    next_review_at: null,
    due_timestamp: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('SyncService', () => {
  beforeEach(async () => {
    // Wait for any pending syncs from previous test
    if ((syncService as any).syncPromise) {
      try {
        await (syncService as any).syncPromise;
      } catch {
        // Ignore errors from previous test
      }
    }

    mockFetch.mockReset();
    // Reset sync service state
    (syncService as any).isSyncing = false;
    (syncService as any).pendingFullSync = false;
    (syncService as any).syncPromise = null;

    // Default mock to return empty results
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/decks')) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes('/api/sync/changes')) {
        return {
          ok: true,
          json: async () => ({
            decks: [],
            notes: [],
            cards: [],
            deleted: { deck_ids: [], note_ids: [], card_ids: [] },
            server_time: new Date().toISOString(),
          }),
        };
      }
      return { ok: false, status: 404, text: async () => 'Not mocked' };
    });
  });

  afterEach(async () => {
    // Clear pending flags first to prevent new syncs from starting
    (syncService as any).pendingFullSync = false;

    // Wait for any in-progress syncs to complete
    let maxWaits = 5;
    while ((syncService as any).syncPromise && maxWaits > 0) {
      try {
        await (syncService as any).syncPromise;
      } catch {
        // Ignore errors
      }
      maxWaits--;
      // Small delay to let any finally blocks run
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  });

  describe('fullSync', () => {
    it('should download all decks and store them in IndexedDB', async () => {
      const mockDeck = createMockDeck('deck-1', 'Test Deck');
      const mockNote = createMockNote('note-1', 'deck-1', '你好');
      const mockCard = createMockCard('card-1', 'note-1', 'hanzi_to_meaning');

      // Mock /api/decks - list all decks
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockDeck],
      });

      // Mock /api/decks/:id - get deck with notes and cards
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockDeck,
          notes: [{
            ...mockNote,
            cards: [mockCard],
          }],
        }),
      });

      await syncService.fullSync();

      // Verify data was stored
      const decks = await db.decks.toArray();
      expect(decks).toHaveLength(1);
      expect(decks[0].name).toBe('Test Deck');

      const notes = await db.notes.toArray();
      expect(notes).toHaveLength(1);
      expect(notes[0].hanzi).toBe('你好');

      const cards = await db.cards.toArray();
      expect(cards).toHaveLength(1);
      expect(cards[0].deck_id).toBe('deck-1');
    });

    it('should update sync meta after successful sync', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await syncService.fullSync();

      const syncMeta = await getSyncMeta();
      expect(syncMeta?.last_full_sync).toBeDefined();
      expect(syncMeta?.last_incremental_sync).toBeDefined();
    });

    it('should clear existing data before inserting new data', async () => {
      // Pre-populate with old data
      await db.decks.put({
        id: 'old-deck',
        name: 'Old Deck',
        user_id: 'user-1',
        description: null,
        new_cards_per_day: 30,
        learning_steps: '1 10',
        graduating_interval: 1,
        easy_interval: 4,
        relearning_steps: '10',
        starting_ease: 2.5,
        minimum_ease: 1.3,
        maximum_ease: 3.0,
        interval_modifier: 1.0,
        hard_multiplier: 1.2,
        easy_bonus: 1.3,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        _synced_at: Date.now(),
      } as LocalDeck);

      const mockDeck = createMockDeck('new-deck', 'New Deck');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockDeck],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockDeck, notes: [] }),
      });

      await syncService.fullSync();

      const decks = await db.decks.toArray();
      expect(decks).toHaveLength(1);
      expect(decks[0].id).toBe('new-deck');
      expect(decks[0].name).toBe('New Deck');
    });

    it('should set isSyncing flag while syncing', async () => {
      // Use a controlled mock
      let resolveFetch: (value: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      mockFetch.mockImplementationOnce(async () => {
        await fetchPromise;
        return { ok: true, json: async () => [] };
      });

      // Start sync
      const syncPromise = syncService.fullSync();

      // Should be syncing now
      expect(syncService.isSyncingNow).toBe(true);

      // Complete the fetch
      resolveFetch!(null);
      await syncPromise;

      // Should no longer be syncing
      expect(syncService.isSyncingNow).toBe(false);
    });
  });

  describe('incrementalSync', () => {
    it('should fall back to full sync if no previous sync exists', async () => {
      const mockDeck = createMockDeck('deck-1', 'Test Deck');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockDeck],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockDeck, notes: [] }),
      });

      await syncService.incrementalSync();

      // Should have called /api/decks (full sync), not /api/sync/changes
      expect(mockFetch.mock.calls[0][0]).toContain('/api/decks');
    });

    it('should fetch only changes since last sync', async () => {
      // Set up previous sync
      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: Date.now() - 86400000, // 1 day ago
        last_incremental_sync: Date.now() - 3600000, // 1 hour ago
        user_id: null,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          decks: [],
          notes: [],
          cards: [],
          deleted: { deck_ids: [], note_ids: [], card_ids: [] },
          server_time: new Date().toISOString(),
        }),
      });

      await syncService.incrementalSync();

      // Should have called /api/sync/changes with since parameter
      expect(mockFetch.mock.calls[0][0]).toContain('/api/sync/changes?since=');
    });

    it('should apply new decks from incremental sync', async () => {
      // Set up previous sync
      const lastSync = Date.now() - 3600000;
      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: lastSync,
        last_incremental_sync: lastSync,
        user_id: null,
      });

      const newDeck = createMockDeck('new-deck', 'New Deck');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          decks: [newDeck],
          notes: [],
          cards: [],
          deleted: { deck_ids: [], note_ids: [], card_ids: [] },
          server_time: new Date().toISOString(),
        }),
      });

      await syncService.incrementalSync();

      const decks = await db.decks.toArray();
      expect(decks).toHaveLength(1);
      expect(decks[0].name).toBe('New Deck');
    });

    it('should apply deletions from incremental sync', async () => {
      // Pre-populate data
      await db.decks.put({
        id: 'deck-to-delete',
        name: 'Will Be Deleted',
        user_id: 'user-1',
        description: null,
        new_cards_per_day: 30,
        learning_steps: '1 10',
        graduating_interval: 1,
        easy_interval: 4,
        relearning_steps: '10',
        starting_ease: 2.5,
        minimum_ease: 1.3,
        maximum_ease: 3.0,
        interval_modifier: 1.0,
        hard_multiplier: 1.2,
        easy_bonus: 1.3,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        _synced_at: Date.now(),
      } as LocalDeck);

      // Set up previous sync
      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: Date.now() - 86400000,
        last_incremental_sync: Date.now() - 3600000,
        user_id: null,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          decks: [],
          notes: [],
          cards: [],
          deleted: { deck_ids: ['deck-to-delete'], note_ids: [], card_ids: [] },
          server_time: new Date().toISOString(),
        }),
      });

      await syncService.incrementalSync();

      const decks = await db.decks.toArray();
      expect(decks).toHaveLength(0);
    });

    it('should update sync timestamp after successful incremental sync', async () => {
      const lastSync = Date.now() - 3600000;
      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: lastSync,
        last_incremental_sync: lastSync,
        user_id: null,
      });

      const serverTime = new Date().toISOString();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          decks: [],
          notes: [],
          cards: [],
          deleted: { deck_ids: [], note_ids: [], card_ids: [] },
          server_time: serverTime,
        }),
      });

      await syncService.incrementalSync();

      const syncMeta = await getSyncMeta();
      expect(syncMeta?.last_incremental_sync).toBe(new Date(serverTime).getTime());
    });

    it('should sync cards with correct deck_id from notes', async () => {
      // Pre-populate note
      await db.notes.put({
        id: 'note-1',
        deck_id: 'deck-1',
        hanzi: '你好',
        pinyin: 'nǐ hǎo',
        english: 'hello',
        audio_url: null,
        fun_facts: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        _synced_at: Date.now(),
      } as LocalNote);

      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: Date.now() - 86400000,
        last_incremental_sync: Date.now() - 3600000,
        user_id: null,
      });

      const newCard = createMockCard('card-1', 'note-1', 'hanzi_to_meaning');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          decks: [],
          notes: [],
          cards: [newCard],
          deleted: { deck_ids: [], note_ids: [], card_ids: [] },
          server_time: new Date().toISOString(),
        }),
      });

      await syncService.incrementalSync();

      const cards = await db.cards.toArray();
      expect(cards).toHaveLength(1);
      expect(cards[0].deck_id).toBe('deck-1'); // Should inherit from note
    });
  });

  describe('needsFullSync', () => {
    it('should return true if no previous sync exists', async () => {
      const needs = await syncService.needsFullSync();
      expect(needs).toBe(true);
    });

    it('should return true if local DB is empty', async () => {
      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: Date.now(),
        last_incremental_sync: Date.now(),
        user_id: null,
      });

      const needs = await syncService.needsFullSync();
      expect(needs).toBe(true);
    });

    it('should return false if sync exists and data is present', async () => {
      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: Date.now(),
        last_incremental_sync: Date.now(),
        user_id: null,
      });

      await db.decks.put({
        id: 'deck-1',
        name: 'Test Deck',
        user_id: 'user-1',
        description: null,
        new_cards_per_day: 30,
        learning_steps: '1 10',
        graduating_interval: 1,
        easy_interval: 4,
        relearning_steps: '10',
        starting_ease: 2.5,
        minimum_ease: 1.3,
        maximum_ease: 3.0,
        interval_modifier: 1.0,
        hard_multiplier: 1.2,
        easy_bonus: 1.3,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        _synced_at: Date.now(),
      } as LocalDeck);

      const needs = await syncService.needsFullSync();
      expect(needs).toBe(false);
    });
  });

  describe('forceFreshSync', () => {
    it('should clear all data and perform full sync', async () => {
      // Pre-populate data
      await db.decks.put({
        id: 'old-deck',
        name: 'Old Deck',
        user_id: 'user-1',
        description: null,
        new_cards_per_day: 30,
        learning_steps: '1 10',
        graduating_interval: 1,
        easy_interval: 4,
        relearning_steps: '10',
        starting_ease: 2.5,
        minimum_ease: 1.3,
        maximum_ease: 3.0,
        interval_modifier: 1.0,
        hard_multiplier: 1.2,
        easy_bonus: 1.3,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        _synced_at: Date.now(),
      } as LocalDeck);

      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: Date.now(),
        last_incremental_sync: Date.now(),
        user_id: null,
      });

      const newDeck = createMockDeck('new-deck', 'New Deck');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [newDeck],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...newDeck, notes: [] }),
      });

      await syncService.forceFreshSync();

      const decks = await db.decks.toArray();
      expect(decks).toHaveLength(1);
      expect(decks[0].id).toBe('new-deck');
    });
  });
});
