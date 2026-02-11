import {
  db,
  LocalDeck,
  LocalNote,
  LocalCard,
  updateSyncMeta,
  getSyncMeta,
  clearAllData,
  cleanupUploadedRecordings,
  getPendingRecordings,
  markRecordingUploaded,
  resetSyncTimestamps,
} from '../db/database';
import { Deck, Note, Card, CardType } from '../types';
import { initialCardState, DEFAULT_DECK_SETTINGS } from '@shared/scheduler';
import { API_BASE, getAuthHeaders, getAuthToken, uploadRecording } from '../api/client';
import { syncReviewEvents, downloadReviewEvents, fixAllCardStates } from './review-events';

const API_PATH = `${API_BASE}/api`;

// Progress tracking for sync operations
export interface SyncProgress {
  phase: 'starting' | 'events-up' | 'events-down' | 'recordings' | 'decks' | 'notes' | 'cards' | 'cleanup' | 'done';
  message: string;
  current?: number;
  total?: number;
}

// Extended type for deck with notes and cards (from API)
interface NoteWithCards extends Note {
  cards: Card[];
}

interface DeckWithNotesAndCards extends Deck {
  notes: NoteWithCards[];
}

// Card data from sync endpoint - only identity/structure fields, NO scheduling state!
// Scheduling state is computed from review events, not synced from server.
interface SyncCard {
  id: string;
  note_id: string;
  card_type: CardType;
  created_at: string;
  updated_at: string;
}

// API response types for sync endpoint
interface SyncChangesResponse {
  decks: Deck[];
  notes: Note[];
  cards: SyncCard[];  // Note: SyncCard, not Card - no scheduling fields
  deleted: {
    deck_ids: string[];
    note_ids: string[];
    card_ids: string[];
  };
  server_time: string;
}

// Convert API types to local DB types
function deckToLocal(deck: Deck): LocalDeck {
  return {
    ...deck,
    _synced_at: Date.now(),
  };
}

function noteToLocal(note: Note): LocalNote {
  return {
    ...note,
    _synced_at: Date.now(),
  };
}

function cardToLocal(card: Card | SyncCard, deckId: string): LocalCard {
  // Get default NEW scheduling state
  // Card scheduling is computed from review events, not synced from server.
  // New cards start with default state, then fixCardState() recomputes from events.
  const defaultState = initialCardState(DEFAULT_DECK_SETTINGS);

  return {
    id: card.id,
    note_id: card.note_id,
    deck_id: deckId,
    card_type: card.card_type,
    created_at: card.created_at,
    updated_at: card.updated_at,
    _synced_at: Date.now(),
    // FSRS fields
    stability: defaultState.stability,
    difficulty: defaultState.difficulty,
    lapses: defaultState.lapses,
    // Legacy fields (will be recomputed from events if any exist)
    queue: defaultState.queue,
    learning_step: defaultState.learning_step,
    ease_factor: defaultState.ease_factor,
    interval: defaultState.interval,
    repetitions: defaultState.repetitions,
    next_review_at: defaultState.next_review_at,
    due_timestamp: defaultState.due_timestamp,
  };
}

class SyncService {
  private isSyncing = false;
  private pendingFullSync = false;
  private syncPromise: Promise<void> | null = null;
  private syncListeners: Set<(syncing: boolean) => void> = new Set();
  private progressListeners: Set<(progress: SyncProgress | null) => void> = new Set();
  private currentProgress: SyncProgress | null = null;

  addSyncListener(listener: (syncing: boolean) => void) {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  addProgressListener(listener: (progress: SyncProgress | null) => void) {
    this.progressListeners.add(listener);
    // Immediately notify with current progress
    listener(this.currentProgress);
    return () => this.progressListeners.delete(listener);
  }

  private notifySyncListeners(syncing: boolean) {
    this.isSyncing = syncing;
    this.syncListeners.forEach(listener => listener(syncing));
  }

  private notifyProgress(progress: SyncProgress | null) {
    this.currentProgress = progress;
    this.progressListeners.forEach(listener => listener(progress));
  }

  /**
   * Wait for any in-progress sync to complete
   */
  async waitForSync(): Promise<void> {
    if (this.syncPromise) {
      await this.syncPromise;
    }
  }

  /**
   * Perform a full sync - fetches all data from server
   * Called on first load or when local DB is empty
   * If a sync is already in progress, queues another sync for after it completes
   */
  async fullSync(): Promise<void> {
    if (this.isSyncing) {
      // Queue a full sync to run after current sync completes
      this.pendingFullSync = true;
      await this.waitForSync();
      // After waiting, check if we should still sync (another call might have handled it)
      if (!this.pendingFullSync) {
        return;
      }
      this.pendingFullSync = false;
    }

    this.notifySyncListeners(true);
    this.syncPromise = this._doFullSync();

    try {
      await this.syncPromise;
      this.notifyProgress({ phase: 'done', message: 'Sync complete' });
    } catch (err) {
      console.error('[Sync] Full sync failed:', err);
      this.notifyProgress(null);
      throw err;
    } finally {
      this.syncPromise = null;
      this.notifySyncListeners(false);
      // Check if another sync was requested while we were syncing
      if (this.pendingFullSync) {
        this.pendingFullSync = false;
        this.fullSync(); // Don't await - let it run
      }
    }
  }

  private async _doFullSync(): Promise<void> {
    this.notifyProgress({ phase: 'decks', message: 'Fetching deck list...' });

    // Fetch all decks
    const decksResponse = await fetch(`${API_PATH}/decks`, {
      headers: getAuthHeaders(),
    });

    if (!decksResponse.ok) {
      throw new Error('Failed to fetch decks');
    }

    const decks: Deck[] = await decksResponse.json();
    this.notifyProgress({ phase: 'decks', message: `Loading ${decks.length} decks...`, current: 0, total: decks.length });

    // Fetch full data for each deck (includes notes AND cards)
    const fullDecks: DeckWithNotesAndCards[] = [];
    for (let i = 0; i < decks.length; i++) {
      const deck = decks[i];
      this.notifyProgress({
        phase: 'decks',
        message: `Loading deck: ${deck.name}`,
        current: i + 1,
        total: decks.length
      });

      const deckResponse = await fetch(`${API_PATH}/decks/${deck.id}`, {
        headers: getAuthHeaders(),
      });
      if (!deckResponse.ok) {
        throw new Error(`Failed to fetch deck ${deck.id}`);
      }
      fullDecks.push(await deckResponse.json() as DeckWithNotesAndCards);
    }

    // Extract notes and cards from deck responses
    const allNotes: Note[] = [];
    const allCards: LocalCard[] = [];

    for (const deck of fullDecks) {
      for (const note of deck.notes) {
        const { cards, ...noteWithoutCards } = note;
        allNotes.push(noteWithoutCards);

        if (cards) {
          for (const card of cards) {
            allCards.push(cardToLocal(card, deck.id));
          }
        }
      }
    }

    this.notifyProgress({
      phase: 'notes',
      message: `Saving ${allNotes.length} notes, ${allCards.length} cards...`
    });

    // Sync data while preserving local card scheduling state
    await db.transaction('rw', [db.decks, db.notes, db.cards, db.syncMeta], async () => {
      // Clear and replace decks and notes (their data comes from server)
      await db.decks.clear();
      await db.notes.clear();

      await db.decks.bulkPut(fullDecks.map(d => deckToLocal(d)));
      await db.notes.bulkPut(allNotes.map(n => noteToLocal(n)));

      // For cards: only INSERT new ones, preserve existing card scheduling state
      // Card scheduling is computed from local review events, not synced from server
      const existingCardIds = new Set((await db.cards.toArray()).map(c => c.id));
      const serverCardIds = new Set(allCards.map(c => c.id));

      // Delete cards that no longer exist on server
      const cardsToDelete = [...existingCardIds].filter(id => !serverCardIds.has(id));
      if (cardsToDelete.length > 0) {
        console.log('[Sync] Deleting', cardsToDelete.length, 'cards that no longer exist on server');
        await db.cards.bulkDelete(cardsToDelete);
      }

      // Only insert NEW cards (don't overwrite existing scheduling state)
      const newCards = allCards.filter(c => !existingCardIds.has(c.id));
      if (newCards.length > 0) {
        console.log('[Sync] Inserting', newCards.length, 'new cards (preserving', existingCardIds.size - cardsToDelete.length, 'existing)');
        await db.cards.bulkPut(newCards);
      }

      // Update deck_id on existing cards if notes have moved between decks.
      // This only touches deck_id, not scheduling state.
      const existingCards = allCards.filter(c => existingCardIds.has(c.id));
      for (const serverCard of existingCards) {
        const localCard = await db.cards.get(serverCard.id);
        if (localCard && localCard.deck_id !== serverCard.deck_id) {
          console.log('[Sync] Updating card deck_id:', serverCard.id, 'from', localCard.deck_id, 'to', serverCard.deck_id);
          await db.cards.update(serverCard.id, { deck_id: serverCard.deck_id });
        }
      }

      await updateSyncMeta({
        id: 'sync_state',
        last_full_sync: Date.now(),
        last_incremental_sync: Date.now(),
        user_id: null,
      });
    });
  }

  /**
   * Perform an incremental sync - fetches only changes since last sync
   * If a sync is already in progress, waits for it then syncs again
   */
  async incrementalSync(): Promise<void> {
    if (this.isSyncing) {
      await this.waitForSync();
      if (this.isSyncing) {
        return;
      }
    }

    const syncMeta = await getSyncMeta();
    if (!syncMeta?.last_incremental_sync) {
      // No previous sync, do a full sync instead
      return this.fullSync();
    }

    this.notifySyncListeners(true);
    this.notifyProgress({ phase: 'starting', message: 'Checking for updates...' });
    this.syncPromise = this._doIncrementalSync(syncMeta.last_incremental_sync);

    try {
      await this.syncPromise;
    } catch (err) {
      console.error('[Sync] Incremental sync failed:', err);
      this.notifyProgress(null);
      throw err;
    } finally {
      this.syncPromise = null;
      this.notifySyncListeners(false);
    }
  }

  private async _doIncrementalSync(since: number): Promise<void> {
    this.notifyProgress({ phase: 'decks', message: 'Fetching changes...' });
    const response = await fetch(`${API_PATH}/sync/changes?since=${since}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Endpoint not available, fall back to full sync
        return this.fullSync();
      }
      throw new Error('Failed to fetch sync changes');
    }

    const changes: SyncChangesResponse = await response.json();
    const currentSyncMeta = await getSyncMeta();

    await db.transaction('rw', [db.decks, db.notes, db.cards, db.syncMeta], async () => {
      // Apply deletions first
      if (changes.deleted.deck_ids.length > 0) {
        await db.decks.bulkDelete(changes.deleted.deck_ids);
      }
      if (changes.deleted.note_ids.length > 0) {
        await db.notes.bulkDelete(changes.deleted.note_ids);
      }
      if (changes.deleted.card_ids.length > 0) {
        await db.cards.bulkDelete(changes.deleted.card_ids);
      }

      // Apply updates/inserts
      if (changes.decks.length > 0) {
        await db.decks.bulkPut(changes.decks.map(d => deckToLocal(d)));
      }
      if (changes.notes.length > 0) {
        await db.notes.bulkPut(changes.notes.map(n => noteToLocal(n)));

        // When notes are updated, their deck_id may have changed (e.g., moved between decks).
        // Update deck_id on local cards to match the note's current deck_id.
        // This only touches deck_id, not scheduling state.
        for (const note of changes.notes) {
          const noteLocal = noteToLocal(note);
          const cardsForNote = await db.cards.where('note_id').equals(noteLocal.id).toArray();
          for (const card of cardsForNote) {
            if (card.deck_id !== noteLocal.deck_id) {
              console.log('[Sync] Updating card deck_id:', card.id, 'from', card.deck_id, 'to', noteLocal.deck_id);
              await db.cards.update(card.id, { deck_id: noteLocal.deck_id });
            }
          }
        }
      }
      if (changes.cards.length > 0) {
        // IMPORTANT: Only INSERT new cards, don't update existing ones!
        // Card scheduling state (queue, interval, ease_factor, etc.) is computed from
        // local review events, not synced from server. Overwriting would clobber progress.

        // Get existing card IDs to skip
        const existingCardIds = new Set(
          (await db.cards.where('id').anyOf(changes.cards.map(c => c.id)).toArray()).map(c => c.id)
        );

        // Filter to only new cards
        const newCards = changes.cards.filter(c => !existingCardIds.has(c.id));

        if (newCards.length > 0) {
          // Need to get deck_id for each card from notes
          const cardsByNote = new Map<string, SyncCard[]>();
          for (const card of newCards) {
            const existing = cardsByNote.get(card.note_id) || [];
            existing.push(card);
            cardsByNote.set(card.note_id, existing);
          }

          const noteIds = Array.from(cardsByNote.keys());
          const notes = await db.notes.where('id').anyOf(noteIds).toArray();
          const noteToDeck = new Map(notes.map(n => [n.id, n.deck_id]));

          const localCards: LocalCard[] = [];
          for (const card of newCards) {
            const deckId = noteToDeck.get(card.note_id);
            if (deckId) {
              localCards.push(cardToLocal(card, deckId));
            } else {
              console.warn('[Sync] Could not find deck_id for card:', card.id);
            }
          }

          if (localCards.length > 0) {
            console.log('[Sync] Inserting new cards only:', localCards.length, '(skipped', existingCardIds.size, 'existing)');
            await db.cards.bulkPut(localCards);
          }
        } else {
          console.log('[Sync] All', changes.cards.length, 'cards already exist locally, skipping to preserve scheduling state');
        }
      }

      await updateSyncMeta({
        id: 'sync_state',
        last_incremental_sync: new Date(changes.server_time).getTime(),
        user_id: currentSyncMeta?.user_id || null,
        last_full_sync: currentSyncMeta?.last_full_sync || null,
      });
    });
  }

  /**
   * Check if local database needs a full sync
   */
  async needsFullSync(): Promise<boolean> {
    const syncMeta = await getSyncMeta();
    if (!syncMeta?.last_full_sync) {
      return true;
    }

    // Also check if local DB is empty
    const deckCount = await db.decks.count();
    return deckCount === 0;
  }

  /**
   * Sync review events (event-sourced architecture)
   * Uploads unsynced events and downloads new events from server
   */
  async syncEvents(): Promise<{ uploaded: number; downloaded: number; errors: string[] }> {
    const token = getAuthToken();

    // Upload unsynced events
    this.notifyProgress({ phase: 'events-up', message: 'Uploading reviews...' });
    const uploadResult = await syncReviewEvents(token);
    if (uploadResult.synced > 0) {
      this.notifyProgress({ phase: 'events-up', message: `Uploaded ${uploadResult.synced} reviews` });
    }

    // Download new events from server
    this.notifyProgress({ phase: 'events-down', message: 'Downloading reviews...' });
    const downloadResult = await downloadReviewEvents(token);
    if (downloadResult.downloaded > 0) {
      this.notifyProgress({ phase: 'events-down', message: `Downloaded ${downloadResult.downloaded} reviews` });
    }

    // Upload pending recordings
    const pendingRecordings = await getPendingRecordings();
    if (pendingRecordings.length > 0) {
      this.notifyProgress({ phase: 'recordings', message: `Uploading ${pendingRecordings.length} recording(s)...` });
      for (const recording of pendingRecordings) {
        try {
          // Look up the review event to get the card_id
          const reviewEvent = await db.reviewEvents.get(recording.id);
          if (reviewEvent) {
            await uploadRecording(reviewEvent.card_id, recording.blob);
            await markRecordingUploaded(recording.id);
            console.log('[Sync] Uploaded recording for review:', recording.id);
          } else {
            console.warn('[Sync] No review event found for recording:', recording.id);
            // Mark as uploaded anyway to prevent retrying forever
            await markRecordingUploaded(recording.id);
          }
        } catch (error) {
          console.error('[Sync] Failed to upload recording:', recording.id, error);
          // Don't mark as uploaded — will retry on next sync
        }
      }
    }

    // Clean up old uploaded recordings
    this.notifyProgress({ phase: 'cleanup', message: 'Cleaning up...' });
    await cleanupUploadedRecordings();

    return {
      uploaded: uploadResult.synced,
      downloaded: downloadResult.downloaded,
      errors: [...uploadResult.errors, ...downloadResult.errors],
    };
  }

  /**
   * Sync everything - review events + deck/note/card data
   * Called when coming online or periodically
   */
  async syncInBackground(): Promise<void> {
    if (this.isSyncing) return;

    try {
      if (navigator.onLine) {
        this.notifyProgress({ phase: 'starting', message: 'Starting sync...' });

        // Sync review events (event-sourced architecture)
        await this.syncEvents();

        // Sync deck/note/card data
        await this.incrementalSync();

        this.notifyProgress({ phase: 'done', message: 'Sync complete' });
      }
    } catch (error) {
      console.error('[Sync] Background sync failed:', error);
      this.notifyProgress(null);
    }
  }

  /**
   * Force a fresh sync - clears local data and does full sync
   * WARNING: This deletes all local data including unsynced review events!
   */
  async forceFreshSync(): Promise<void> {
    await clearAllData();
    await this.fullSync();
  }

  /**
   * Force a full resync without losing local data.
   * Resets sync timestamps so the next sync fetches all data from server,
   * but preserves local review events and other data.
   */
  async forceFullResync(): Promise<void> {
    console.log('[SyncService] Forcing full resync (preserving local data)...');
    await resetSyncTimestamps();
    await this.fullSync();
  }

  get isSyncingNow(): boolean {
    return this.isSyncing;
  }

  /**
   * Fix all card states by recomputing from review events.
   * Use this to recover from sync corruption where card scheduling
   * state doesn't match the review event history.
   */
  async fixAllCardStates(): Promise<{ total: number; fixed: number; errors: string[] }> {
    console.log('[SyncService] Starting card state recovery...');
    const result = await fixAllCardStates();
    console.log('[SyncService] Card state recovery complete:', result);
    return result;
  }
}

// Export singleton instance
export const syncService = new SyncService();
