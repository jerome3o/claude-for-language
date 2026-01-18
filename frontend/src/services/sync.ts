import { db, LocalDeck, LocalNote, LocalCard, updateSyncMeta, getSyncMeta, clearAllData } from '../db/database';
import { Deck, Note, Card } from '../types';

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
   * Perform a full sync - fetches all data from server
   * Called on first load or when local DB is empty
   */
  async fullSync(): Promise<void> {
    if (this.isSyncing) return;
    this.notifySyncListeners(true);

    try {
      // Fetch all decks
      console.log('[fullSync] Fetching deck list...');
      const decksResponse = await fetch('/api/decks');
      console.log('[fullSync] Deck list response:', decksResponse.status, decksResponse.statusText);
      if (!decksResponse.ok) {
        const text = await decksResponse.text();
        console.error('[fullSync] Deck list error response:', text);
        throw new Error('Failed to fetch decks');
      }
      const decksText = await decksResponse.text();
      console.log('[fullSync] Deck list body (first 500 chars):', decksText.slice(0, 500));
      const decks: Deck[] = JSON.parse(decksText);
      console.log('[fullSync] Got', decks.length, 'decks');

      // Fetch full data for each deck (includes notes AND cards)
      const deckPromises = decks.map(async (deck) => {
        console.log('[fullSync] Fetching deck:', deck.id);
        const deckResponse = await fetch(`/api/decks/${deck.id}`);
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

      console.log(`[fullSync] Synced ${fullDecks.length} decks, ${allNotes.length} notes, ${allCards.length} cards`);

      // Clear existing data and insert new
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

      console.log(`Full sync complete: ${fullDecks.length} decks, ${allNotes.length} notes, ${allCards.length} cards`);
    } finally {
      this.notifySyncListeners(false);
    }
  }

  /**
   * Perform an incremental sync - fetches only changes since last sync
   */
  async incrementalSync(): Promise<void> {
    if (this.isSyncing) return;

    const syncMeta = await getSyncMeta();
    if (!syncMeta?.last_incremental_sync) {
      // No previous sync, do a full sync instead
      return this.fullSync();
    }

    this.notifySyncListeners(true);

    try {
      const since = syncMeta.last_incremental_sync;
      const response = await fetch(`/api/sync/changes?since=${since}`);

      if (!response.ok) {
        if (response.status === 404) {
          // Endpoint not available, fall back to full sync
          console.log('Incremental sync endpoint not available, falling back to full sync');
          return this.fullSync();
        }
        throw new Error('Failed to fetch sync changes');
      }

      const changes: SyncChangesResponse = await response.json();

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
          // Need to get deck_id for each card
          const cardsByNote = new Map<string, Card[]>();
          for (const card of changes.cards) {
            const existing = cardsByNote.get(card.note_id) || [];
            existing.push(card);
            cardsByNote.set(card.note_id, existing);
          }

          // Get deck_id from notes
          const noteIds = Array.from(cardsByNote.keys());
          const notes = await db.notes.where('id').anyOf(noteIds).toArray();
          const noteToDeck = new Map(notes.map(n => [n.id, n.deck_id]));

          const localCards: LocalCard[] = [];
          for (const card of changes.cards) {
            const deckId = noteToDeck.get(card.note_id);
            if (deckId) {
              localCards.push(cardToLocal(card, deckId));
            }
          }

          if (localCards.length > 0) {
            await db.cards.bulkPut(localCards);
          }
        }

        await updateSyncMeta({
          id: 'sync_state',
          last_incremental_sync: new Date(changes.server_time).getTime(),
          user_id: syncMeta.user_id,
          last_full_sync: syncMeta.last_full_sync,
        });
      });

      console.log(`Incremental sync complete: ${changes.decks.length} decks, ${changes.notes.length} notes, ${changes.cards.length} cards updated`);
    } finally {
      this.notifySyncListeners(false);
    }
  }

  /**
   * Sync pending reviews to the server
   */
  async syncPendingReviews(): Promise<{ synced: number; failed: number }> {
    const pending = await db.pendingReviews.where('_pending').equals(1).toArray();

    if (pending.length === 0) {
      return { synced: 0, failed: 0 };
    }

    let synced = 0;
    let failed = 0;

    // Sort by reviewed_at to maintain chronological order
    pending.sort((a, b) => new Date(a.reviewed_at).getTime() - new Date(b.reviewed_at).getTime());

    for (const review of pending) {
      try {
        const response = await fetch('/api/study/review', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            card_id: review.card_id,
            rating: review.rating,
            time_spent_ms: review.time_spent_ms,
            user_answer: review.user_answer,
            session_id: review.session_id,
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
          // Mark as synced
          await db.pendingReviews.update(review.id, {
            _pending: false,
            _last_error: null,
          });
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
