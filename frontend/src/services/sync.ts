import { db, LocalDeck, LocalNote, LocalCard, updateSyncMeta, getSyncMeta, clearAllData, cleanupSyncedReviews } from '../db/database';
import { Deck, Note, Card } from '../types';
import { API_BASE, getAuthHeaders, uploadRecording } from '../api/client';

const API_PATH = `${API_BASE}/api`;

// Extended type for deck with notes and cards (from API)
interface NoteWithCards extends Note {
  cards: Card[];
}

interface DeckWithNotesAndCards extends Deck {
  notes: NoteWithCards[];
}

// API response types for sync endpoint
interface SyncChangesResponse {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
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

function cardToLocal(card: Card, deckId: string): LocalCard {
  return {
    ...card,
    deck_id: deckId,
    _synced_at: Date.now(),
  };
}

class SyncService {
  private isSyncing = false;
  private pendingFullSync = false;
  private syncPromise: Promise<void> | null = null;
  private syncListeners: Set<(syncing: boolean) => void> = new Set();

  addSyncListener(listener: (syncing: boolean) => void) {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  private notifySyncListeners(syncing: boolean) {
    this.isSyncing = syncing;
    this.syncListeners.forEach(listener => listener(syncing));
  }

  /**
   * Wait for any in-progress sync to complete
   */
  async waitForSync(): Promise<void> {
    if (this.syncPromise) {
      console.log('[SyncService] waitForSync: waiting for in-progress sync...');
      await this.syncPromise;
      console.log('[SyncService] waitForSync: done waiting');
    }
  }

  /**
   * Perform a full sync - fetches all data from server
   * Called on first load or when local DB is empty
   * If a sync is already in progress, queues another sync for after it completes
   */
  async fullSync(): Promise<void> {
    console.log('[SyncService] fullSync called, isSyncing:', this.isSyncing, 'pendingFullSync:', this.pendingFullSync);
    if (this.isSyncing) {
      // Queue a full sync to run after current sync completes
      console.log('[SyncService] fullSync: sync in progress, queueing...');
      this.pendingFullSync = true;
      await this.waitForSync();
      // After waiting, check if we should still sync (another call might have handled it)
      if (!this.pendingFullSync) {
        console.log('[SyncService] fullSync: pendingFullSync was cleared, returning');
        return;
      }
      this.pendingFullSync = false;
    }
    console.log('[SyncService] fullSync: starting sync');
    this.notifySyncListeners(true);

    this.syncPromise = this._doFullSync();
    try {
      await this.syncPromise;
      console.log('[SyncService] fullSync: completed successfully');
    } catch (err) {
      console.error('[SyncService] fullSync: error during sync', err);
      throw err;
    } finally {
      this.syncPromise = null;
      this.notifySyncListeners(false);
      // Check if another sync was requested while we were syncing
      if (this.pendingFullSync) {
        console.log('[SyncService] fullSync: another sync was requested, starting it');
        this.pendingFullSync = false;
        this.fullSync(); // Don't await - let it run
      }
    }
  }

  private async _doFullSync(): Promise<void> {
      // Fetch all decks
      console.log('[fullSync] Fetching deck list from:', `${API_PATH}/decks`);
      const decksResponse = await fetch(`${API_PATH}/decks`, {
        headers: getAuthHeaders(),
      });
      console.log('[fullSync] Deck list response:', decksResponse.status);
      if (!decksResponse.ok) {
        const text = await decksResponse.text();
        console.error('[fullSync] Deck list error response:', text);
        throw new Error('Failed to fetch decks');
      }
      const decks: Deck[] = await decksResponse.json();
      console.log('[fullSync] Got', decks.length, 'decks');

      // Fetch full data for each deck (includes notes AND cards)
      const deckPromises = decks.map(async (deck) => {
        console.log('[fullSync] Fetching deck:', deck.id);
        const deckResponse = await fetch(`${API_PATH}/decks/${deck.id}`, {
          headers: getAuthHeaders(),
        });
        console.log('[fullSync] Deck response:', deck.id, deckResponse.status);
        if (!deckResponse.ok) {
          const text = await deckResponse.text();
          console.error('[fullSync] Deck error response:', text);
          throw new Error(`Failed to fetch deck ${deck.id}`);
        }
        return deckResponse.json() as Promise<DeckWithNotesAndCards>;
      });

      const fullDecks = await Promise.all(deckPromises);

      // Extract notes and cards from deck responses (no need for extra requests!)
      const allNotes: Note[] = [];
      const allCards: LocalCard[] = [];

      for (const deck of fullDecks) {
        for (const note of deck.notes) {
          // Extract cards from note
          const { cards, ...noteWithoutCards } = note;
          allNotes.push(noteWithoutCards);

          // Add cards with deck_id
          if (cards) {
            for (const card of cards) {
              allCards.push(cardToLocal(card, deck.id));
            }
          }
        }
      }

      console.log(`[fullSync] Extracted from API: ${fullDecks.length} decks, ${allNotes.length} notes, ${allCards.length} cards`);

      // Log details about each deck's cards
      for (const deck of fullDecks) {
        const deckCards = allCards.filter(c => c.deck_id === deck.id);
        console.log(`[fullSync] Deck "${deck.name}" (${deck.id}): ${deck.notes.length} notes, ${deckCards.length} cards`);
        // Log card queue distribution
        const queueCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
        for (const card of deckCards) {
          if (card.queue === 0) queueCounts.new++;
          else if (card.queue === 1) queueCounts.learning++;
          else if (card.queue === 2) queueCounts.review++;
          else if (card.queue === 3) queueCounts.relearning++;
        }
        console.log(`[fullSync] Deck "${deck.name}" queue distribution:`, queueCounts);
      }

      // Clear existing data and insert new
      console.log('[fullSync] Clearing IndexedDB and inserting new data...');
      await db.transaction('rw', [db.decks, db.notes, db.cards, db.syncMeta], async () => {
        await db.decks.clear();
        await db.notes.clear();
        await db.cards.clear();

        await db.decks.bulkPut(fullDecks.map(d => deckToLocal(d)));
        await db.notes.bulkPut(allNotes.map(n => noteToLocal(n)));
        await db.cards.bulkPut(allCards);

        await updateSyncMeta({
          id: 'sync_state',
          last_full_sync: Date.now(),
          last_incremental_sync: Date.now(),
          user_id: null,
        });
      });

      // Verify what's in IndexedDB after sync
      const dbDecks = await db.decks.toArray();
      const dbCards = await db.cards.toArray();
      console.log(`[fullSync] After sync - IndexedDB has: ${dbDecks.length} decks, ${dbCards.length} cards`);
      for (const deck of dbDecks) {
        const deckCards = dbCards.filter(c => c.deck_id === deck.id);
        console.log(`[fullSync] IndexedDB Deck "${deck.name}" (${deck.id}): ${deckCards.length} cards`);
      }

      console.log(`[fullSync] Full sync complete!`);
  }

  /**
   * Perform an incremental sync - fetches only changes since last sync
   * If a sync is already in progress, waits for it then syncs again
   */
  async incrementalSync(): Promise<void> {
    console.log('[SyncService] incrementalSync called, isSyncing:', this.isSyncing);
    if (this.isSyncing) {
      console.log('[SyncService] incrementalSync: sync in progress, waiting...');
      // Wait for current sync to complete, then do an incremental sync
      await this.waitForSync();
      // Check if we still need to sync (fullSync might have been queued and run)
      if (this.isSyncing) {
        console.log('[SyncService] incrementalSync: still syncing after wait, returning');
        return;
      }
    }

    const syncMeta = await getSyncMeta();
    console.log('[SyncService] incrementalSync: syncMeta:', syncMeta);
    if (!syncMeta?.last_incremental_sync) {
      // No previous sync, do a full sync instead
      console.log('[SyncService] incrementalSync: no previous sync, doing full sync');
      return this.fullSync();
    }

    console.log('[SyncService] incrementalSync: starting incremental sync since', new Date(syncMeta.last_incremental_sync).toISOString());
    this.notifySyncListeners(true);
    this.syncPromise = this._doIncrementalSync(syncMeta.last_incremental_sync);

    try {
      await this.syncPromise;
      console.log('[SyncService] incrementalSync: completed successfully');
    } catch (err) {
      console.error('[SyncService] incrementalSync: error', err);
      throw err;
    } finally {
      this.syncPromise = null;
      this.notifySyncListeners(false);
    }
  }

  private async _doIncrementalSync(since: number): Promise<void> {
    console.log('[incrementalSync] Fetching changes since:', new Date(since).toISOString());
    const response = await fetch(`${API_PATH}/sync/changes?since=${since}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Endpoint not available, fall back to full sync
        console.log('[incrementalSync] Endpoint not available (404), falling back to full sync');
        return this.fullSync();
      }
      console.error('[incrementalSync] Failed to fetch sync changes:', response.status);
      throw new Error('Failed to fetch sync changes');
    }

    const changes: SyncChangesResponse = await response.json();
    console.log('[incrementalSync] Received changes:', {
      decks: changes.decks.length,
      notes: changes.notes.length,
      cards: changes.cards.length,
      deleted: changes.deleted,
      server_time: changes.server_time,
    });

    // Log details about changed decks
    for (const deck of changes.decks) {
      console.log('[incrementalSync] Changed deck:', deck.id, deck.name);
    }
    for (const note of changes.notes) {
      console.log('[incrementalSync] Changed note:', note.id, note.hanzi, 'deck:', note.deck_id);
    }
    for (const card of changes.cards) {
      console.log('[incrementalSync] Changed card:', card.id, 'note:', card.note_id, 'queue:', card.queue);
    }

    // Get current sync meta for preserving user_id and last_full_sync
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
      }
      if (changes.cards.length > 0) {
        console.log('[incrementalSync] Processing', changes.cards.length, 'cards...');
        // Need to get deck_id for each card
        const cardsByNote = new Map<string, Card[]>();
        for (const card of changes.cards) {
          const existing = cardsByNote.get(card.note_id) || [];
          existing.push(card);
          cardsByNote.set(card.note_id, existing);
        }

        // Get deck_id from notes (includes just-synced notes in this transaction)
        const noteIds = Array.from(cardsByNote.keys());
        console.log('[incrementalSync] Looking up deck_id for note_ids:', noteIds);
        const notes = await db.notes.where('id').anyOf(noteIds).toArray();
        console.log('[incrementalSync] Found', notes.length, 'notes in IndexedDB');
        const noteToDeck = new Map(notes.map(n => [n.id, n.deck_id]));

        const localCards: LocalCard[] = [];
        let missingDeckIdCount = 0;
        for (const card of changes.cards) {
          const deckId = noteToDeck.get(card.note_id);
          if (deckId) {
            localCards.push(cardToLocal(card, deckId));
          } else {
            missingDeckIdCount++;
            console.warn('[incrementalSync] Could not find deck_id for card:', card.id, 'note_id:', card.note_id);
          }
        }

        console.log('[incrementalSync] Cards with deck_id:', localCards.length, 'missing deck_id:', missingDeckIdCount);
        if (localCards.length > 0) {
          await db.cards.bulkPut(localCards);
          console.log('[incrementalSync] Inserted', localCards.length, 'cards to IndexedDB');
        }
      }

      await updateSyncMeta({
        id: 'sync_state',
        last_incremental_sync: new Date(changes.server_time).getTime(),
        user_id: currentSyncMeta?.user_id || null,
        last_full_sync: currentSyncMeta?.last_full_sync || null,
      });
    });

    // Verify what's in IndexedDB after sync
    const dbDecks = await db.decks.toArray();
    const dbCards = await db.cards.toArray();
    console.log(`[incrementalSync] After sync - IndexedDB has: ${dbDecks.length} decks, ${dbCards.length} cards`);
    for (const deck of dbDecks) {
      const deckCards = dbCards.filter(c => c.deck_id === deck.id);
      const queueCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
      for (const card of deckCards) {
        if (card.queue === 0) queueCounts.new++;
        else if (card.queue === 1) queueCounts.learning++;
        else if (card.queue === 2) queueCounts.review++;
        else if (card.queue === 3) queueCounts.relearning++;
      }
      console.log(`[incrementalSync] IndexedDB Deck "${deck.name}" (${deck.id}): ${deckCards.length} cards, queues:`, queueCounts);
    }

    console.log(`[incrementalSync] Incremental sync complete!`);
  }

  /**
   * Sync pending reviews to the server
   */
  async syncPendingReviews(): Promise<{ synced: number; failed: number }> {
    // Clean up old synced reviews (older than 7 days) to prevent table growth
    // Keep recent synced reviews for daily new card count tracking
    await cleanupSyncedReviews();

    // Get only pending reviews (not yet synced)
    const allReviews = await db.pendingReviews.toArray();
    const pendingReviews = allReviews.filter(r => r._pending === true || (r._pending as unknown) === 1);

    if (pendingReviews.length === 0) {
      return { synced: 0, failed: 0 };
    }

    const pending = pendingReviews;

    let synced = 0;
    let failed = 0;

    // Sort by reviewed_at to maintain chronological order
    pending.sort((a, b) => new Date(a.reviewed_at).getTime() - new Date(b.reviewed_at).getTime());

    for (const review of pending) {
      try {
        const response = await fetch(`${API_PATH}/study/review`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            card_id: review.card_id,
            rating: review.rating,
            time_spent_ms: review.time_spent_ms,
            user_answer: review.user_answer,
            session_id: review.session_id,
            reviewed_at: review.reviewed_at, // Actual time of review (for correct date grouping)
            // Include the computed result so server can verify or use it
            offline_result: {
              queue: review.new_queue,
              learning_step: review.new_learning_step,
              ease_factor: review.new_ease_factor,
              interval: review.new_interval,
              repetitions: review.new_repetitions,
              next_review_at: review.new_next_review_at,
              due_timestamp: review.new_due_timestamp,
            },
          }),
        });

        if (response.ok) {
          // Upload recording if present (now that review exists on server)
          if (review.recording_blob) {
            try {
              await uploadRecording(review.card_id, review.recording_blob);
              console.log('[syncPendingReviews] Recording uploaded for card:', review.card_id);
            } catch (uploadErr) {
              console.error('[syncPendingReviews] Failed to upload recording:', uploadErr);
              // Continue anyway - review is synced, just recording failed
            }
          }

          // Mark review as synced instead of deleting
          // This preserves the review for daily new card count tracking
          // Old synced reviews are cleaned up by cleanupSyncedReviews()
          await db.pendingReviews.update(review.id, { _pending: false });
          synced++;
        } else {
          const error = await response.text();
          await db.pendingReviews.update(review.id, {
            _retries: review._retries + 1,
            _last_error: error,
          });
          failed++;
        }
      } catch (error) {
        await db.pendingReviews.update(review.id, {
          _retries: review._retries + 1,
          _last_error: error instanceof Error ? error.message : 'Unknown error',
        });
        failed++;
      }
    }

    return { synced, failed };
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
   * Sync everything - incremental sync + pending reviews
   * Called when coming online or periodically
   */
  async syncInBackground(): Promise<void> {
    if (this.isSyncing) return;

    try {
      // First sync pending reviews
      if (navigator.onLine) {
        const reviewResult = await this.syncPendingReviews();
        if (reviewResult.synced > 0 || reviewResult.failed > 0) {
          console.log(`Review sync: ${reviewResult.synced} synced, ${reviewResult.failed} failed`);
        }

        // Then do incremental sync
        await this.incrementalSync();
      }
    } catch (error) {
      console.error('Background sync failed:', error);
    }
  }

  /**
   * Force a fresh sync - clears local data and does full sync
   */
  async forceFreshSync(): Promise<void> {
    await clearAllData();
    await this.fullSync();
  }

  get isSyncingNow(): boolean {
    return this.isSyncing;
  }
}

// Export singleton instance
export const syncService = new SyncService();
