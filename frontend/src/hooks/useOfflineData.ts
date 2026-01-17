import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, LocalCard, PendingReview, getDueCards, getQueueCounts, getSyncMeta } from '../db/database';
import { scheduleCard, deckSettingsFromDb, DeckSettings, DEFAULT_DECK_SETTINGS, getIntervalPreview } from '../services/anki-scheduler';
import { syncService } from '../services/sync';
import { Rating, CardQueue, CardWithNote, Note, IntervalPreview } from '../types';

// Hook to get all decks from IndexedDB with background sync
export function useOfflineDecks() {
  // Use Dexie live query for reactive updates
  const decks = useLiveQuery(() => db.decks.toArray(), []);

  // Trigger background sync when online
  const triggerSync = async () => {
    if (navigator.onLine) {
      const needsSync = await syncService.needsFullSync();
      if (needsSync) {
        await syncService.fullSync();
      } else {
        syncService.syncInBackground();
      }
    }
  };

  return {
    decks: decks || [],
    isLoading: decks === undefined,
    triggerSync,
  };
}

// Hook to get a single deck with its notes
export function useOfflineDeck(deckId: string | undefined) {
  const deck = useLiveQuery(
    () => deckId ? db.decks.get(deckId) : undefined,
    [deckId]
  );

  const notes = useLiveQuery(
    () => deckId ? db.notes.where('deck_id').equals(deckId).toArray() : [],
    [deckId]
  );

  return {
    deck,
    notes: notes || [],
    isLoading: deck === undefined && deckId !== undefined,
  };
}

// Hook to get due cards from IndexedDB
export function useOfflineDueCards(deckId?: string) {
  const dueCards = useLiveQuery(
    () => getDueCards(deckId),
    [deckId]
  );

  return {
    cards: dueCards || [],
    isLoading: dueCards === undefined,
  };
}

// Hook to get queue counts
export function useOfflineQueueCounts(deckId?: string) {
  const counts = useLiveQuery(
    () => getQueueCounts(deckId),
    [deckId]
  );

  return {
    counts: counts || { new: 0, learning: 0, review: 0 },
    isLoading: counts === undefined,
  };
}

// Hook to get pending reviews count
export function usePendingReviewsCount() {
  const count = useLiveQuery(
    () => db.pendingReviews.where('_pending').equals(1).count(),
    []
  );

  return count || 0;
}

// Hook to get the next card to study (offline-first)
export function useOfflineNextCard(deckId?: string, excludeNoteIds: string[] = []) {
  const queryClient = useQueryClient();

  // Get all due cards
  const allDueCards = useLiveQuery(
    () => getDueCards(deckId),
    [deckId]
  );

  // Get queue counts
  const counts = useLiveQuery(
    () => getQueueCounts(deckId),
    [deckId]
  );

  // Filter out excluded notes and pick the next card
  const nextCard = useLiveQuery(async () => {
    if (!allDueCards || allDueCards.length === 0) return null;

    // Filter out cards from excluded notes
    const availableCards = allDueCards.filter(card => !excludeNoteIds.includes(card.note_id));
    if (availableCards.length === 0) return null;

    // Priority: Learning/Relearning (due now) > Review > New
    const now = Date.now();

    // First, check for learning/relearning cards that are due
    const learningDue = availableCards.filter(c =>
      (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
      c.due_timestamp && c.due_timestamp <= now
    );
    if (learningDue.length > 0) {
      // Return the one due first
      learningDue.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
      return learningDue[0];
    }

    // Next, review cards
    const reviewDue = availableCards.filter(c => c.queue === CardQueue.REVIEW);
    if (reviewDue.length > 0) {
      return reviewDue[0];
    }

    // Finally, new cards
    const newCards = availableCards.filter(c => c.queue === CardQueue.NEW);
    if (newCards.length > 0) {
      return newCards[0];
    }

    return null;
  }, [allDueCards, excludeNoteIds]);

  // Get note for the card
  const note = useLiveQuery(
    () => nextCard ? db.notes.get(nextCard.note_id) : undefined,
    [nextCard?.note_id]
  );

  // Get deck settings for interval previews
  const deck = useLiveQuery(
    () => nextCard ? db.decks.get(nextCard.deck_id) : undefined,
    [nextCard?.deck_id]
  );

  // Calculate interval previews
  let intervalPreviews: Record<Rating, IntervalPreview> | null = null;
  if (nextCard && deck) {
    const settings = deckSettingsFromDb(deck);
    intervalPreviews = {
      0: getIntervalPreviewLocal(0, nextCard, settings),
      1: getIntervalPreviewLocal(1, nextCard, settings),
      2: getIntervalPreviewLocal(2, nextCard, settings),
      3: getIntervalPreviewLocal(3, nextCard, settings),
    };
  }

  // Combine card and note into CardWithNote format
  const cardWithNote: CardWithNote | null = nextCard && note ? {
    ...nextCard,
    note: note as Note,
  } : null;

  return {
    card: cardWithNote,
    counts: counts || { new: 0, learning: 0, review: 0 },
    intervalPreviews,
    isLoading: allDueCards === undefined,
    refetch: () => queryClient.invalidateQueries({ queryKey: ['offlineDueCards'] }),
  };
}

// Helper to get interval preview locally
function getIntervalPreviewLocal(rating: Rating, card: LocalCard, settings: DeckSettings): IntervalPreview {
  return getIntervalPreview(
    rating,
    card.queue,
    card.learning_step,
    card.ease_factor,
    card.interval,
    card.repetitions,
    settings
  );
}

// Hook to submit a review offline
export function useSubmitReviewOffline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      cardId,
      rating,
      timeSpentMs,
      userAnswer,
      sessionId,
    }: {
      cardId: string;
      rating: Rating;
      timeSpentMs?: number;
      userAnswer?: string;
      sessionId?: string;
    }) => {
      // Get the card
      const card = await db.cards.get(cardId);
      if (!card) {
        throw new Error('Card not found');
      }

      // Get deck settings
      const deck = await db.decks.get(card.deck_id);
      const settings = deck ? deckSettingsFromDb(deck) : DEFAULT_DECK_SETTINGS;

      // Calculate new scheduling state
      const result = scheduleCard(
        rating,
        card.queue,
        card.learning_step,
        card.ease_factor,
        card.interval,
        card.repetitions,
        settings
      );

      const reviewId = crypto.randomUUID();
      const reviewedAt = new Date().toISOString();

      await db.transaction('rw', [db.cards, db.pendingReviews], async () => {
        // Update card with new state
        await db.cards.update(cardId, {
          queue: result.queue,
          learning_step: result.learning_step,
          ease_factor: result.ease_factor,
          interval: result.interval,
          repetitions: result.repetitions,
          next_review_at: result.next_review_at?.toISOString() || null,
          due_timestamp: result.due_timestamp,
          updated_at: reviewedAt,
        });

        // Create pending review for sync
        const pendingReview: PendingReview = {
          id: reviewId,
          card_id: cardId,
          session_id: sessionId || null,
          rating,
          time_spent_ms: timeSpentMs || null,
          user_answer: userAnswer || null,
          reviewed_at: reviewedAt,
          new_queue: result.queue,
          new_learning_step: result.learning_step,
          new_ease_factor: result.ease_factor,
          new_interval: result.interval,
          new_repetitions: result.repetitions,
          new_next_review_at: result.next_review_at?.toISOString() || null,
          new_due_timestamp: result.due_timestamp,
          _pending: true,
          _retries: 0,
          _last_error: null,
        };

        await db.pendingReviews.put(pendingReview);
      });

      // Try to sync if online
      if (navigator.onLine) {
        syncService.syncPendingReviews().catch(console.error);
      }

      return {
        queue: result.queue,
        interval: result.interval,
        next_due: result.due_timestamp || result.next_review_at?.toISOString(),
      };
    },
    onSuccess: () => {
      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['offlineDueCards'] });
      queryClient.invalidateQueries({ queryKey: ['offlineQueueCounts'] });
    },
  });
}

// Hook to get sync status
export function useSyncStatus() {
  const syncMeta = useLiveQuery(() => getSyncMeta(), []);
  const pendingCount = usePendingReviewsCount();

  return {
    lastFullSync: syncMeta?.last_full_sync ? new Date(syncMeta.last_full_sync) : null,
    lastIncrementalSync: syncMeta?.last_incremental_sync ? new Date(syncMeta.last_incremental_sync) : null,
    pendingReviewsCount: pendingCount,
    hasPendingChanges: pendingCount > 0,
  };
}

// Initialize offline data - call this on app start
export async function initializeOfflineData(): Promise<void> {
  if (!navigator.onLine) {
    console.log('Offline - using cached data');
    return;
  }

  const needsSync = await syncService.needsFullSync();
  if (needsSync) {
    console.log('Performing initial full sync...');
    await syncService.fullSync();
  } else {
    // Do a background incremental sync
    syncService.syncInBackground();
  }
}
