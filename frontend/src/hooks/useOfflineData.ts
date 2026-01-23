import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  LocalCard,
  getDueCards,
  getQueueCounts,
  getSyncMeta,
  hasMoreNewCards as checkHasMoreNewCards,
  createLocalReviewEvent,
  storePendingRecording,
  incrementNewCardsStudiedToday,
} from '../db/database';
import { scheduleCard, deckSettingsFromDb, DeckSettings, DEFAULT_DECK_SETTINGS, getIntervalPreview } from '../services/anki-scheduler';
import { syncService } from '../services/sync';
import { Rating, CardQueue, CardWithNote, Note, IntervalPreview } from '../types';

// Hook to get all decks from IndexedDB with background sync
// Pass apiDecks to detect mismatches and auto-fix via full sync
export function useOfflineDecks(apiDecks?: { id: string }[]) {
  // Use Dexie live query for reactive updates
  const decks = useLiveQuery(async () => {
    const result = await db.decks.toArray();
    return result;
  }, []);

  // Detect mismatch: API has decks that aren't in IndexedDB
  const localDeckIds = new Set((decks || []).map(d => d.id));
  const missingDecks = apiDecks?.filter(d => !localDeckIds.has(d.id)) || [];
  const hasMismatch = missingDecks.length > 0;

  // Auto-trigger full sync when mismatch detected
  const [isAutoSyncing, setIsAutoSyncing] = React.useState(false);
  React.useEffect(() => {
    if (hasMismatch && navigator.onLine && !isAutoSyncing && !syncService.isSyncingNow) {
      console.log('[useOfflineDecks] Mismatch detected! API has decks not in IndexedDB:', missingDecks.map(d => d.id));
      console.log('[useOfflineDecks] Triggering full sync to fix...');
      setIsAutoSyncing(true);
      syncService.fullSync()
        .then(() => console.log('[useOfflineDecks] Auto full sync complete'))
        .catch(err => console.error('[useOfflineDecks] Auto full sync failed:', err))
        .finally(() => setIsAutoSyncing(false));
    }
  }, [hasMismatch, missingDecks, isAutoSyncing]);

  // Trigger background sync when online
  const triggerSync = async () => {
    if (navigator.onLine) {
      const needsSync = await syncService.needsFullSync();
      if (needsSync) {
        await syncService.fullSync();
      } else {
        await syncService.syncInBackground();
      }
    }
  };

  // Force a full sync (clear and re-download)
  const forceFullSync = async () => {
    if (navigator.onLine) {
      await syncService.forceFreshSync();
    }
  };

  return {
    decks: decks || [],
    isLoading: decks === undefined,
    isSyncing: isAutoSyncing || syncService.isSyncingNow,
    triggerSync,
    forceFullSync,
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
export function useOfflineQueueCounts(deckId?: string, bonusNewCards = 0) {
  const counts = useLiveQuery(
    async () => {
      console.log(`[useOfflineQueueCounts] Querying counts for deckId: ${deckId}, bonusNewCards: ${bonusNewCards}`);
      const result = await getQueueCounts(deckId, bonusNewCards);
      console.log(`[useOfflineQueueCounts] Result for deckId ${deckId}:`, result);
      return result;
    },
    [deckId, bonusNewCards]
  );

  return {
    counts: counts || { new: 0, learning: 0, review: 0 },
    isLoading: counts === undefined,
  };
}

// Hook to get pending (unsynced) review events count
export function usePendingReviewsCount() {
  const count = useLiveQuery(
    async () => {
      // Count unsynced review events (new event-sourced architecture)
      return db.reviewEvents.where('_synced').equals(0).count();
    },
    []
  );

  return count || 0;
}

// Hook to check if there are more new cards beyond the daily limit (+ current bonus)
export function useHasMoreNewCards(deckId?: string, currentBonus = 0) {
  const result = useLiveQuery(
    async () => {
      const hasMore = await checkHasMoreNewCards(deckId, currentBonus);
      console.log(`[useHasMoreNewCards] deckId: ${deckId}, currentBonus: ${currentBonus}, hasMore: ${hasMore}`);
      return hasMore;
    },
    [deckId, currentBonus]
  );

  return result ?? false;
}

// Track the currently selected card to prevent flickering from random re-selection
let currentSelectedCardId: string | null = null;

// Clear the cached card ID (call this after submitting a review)
export function clearCurrentSelectedCard(): void {
  currentSelectedCardId = null;
}

// Hook to get the next card to study (offline-first)
export function useOfflineNextCard(deckId?: string, excludeNoteIds: string[] = [], bonusNewCards = 0) {
  const queryClient = useQueryClient();

  // Get all due cards
  const allDueCards = useLiveQuery(
    () => getDueCards(deckId, bonusNewCards),
    [deckId, bonusNewCards]
  );

  // Get queue counts
  const counts = useLiveQuery(
    () => getQueueCounts(deckId, bonusNewCards),
    [deckId, bonusNewCards]
  );

  // Filter out excluded notes and pick the next card
  // Priority: Learning due NOW > Current card (if still valid) > Mix(New, Review) proportionally > Learning with delay
  const nextCard = useLiveQuery(async () => {
    const now = Date.now();
    console.log('[useOfflineNextCard] Card selection running', {
      allDueCardsLength: allDueCards?.length,
      excludeNoteIdsLength: excludeNoteIds.length,
      currentSelectedCardId,
      deckId,
      timestamp: new Date().toISOString(),
    });

    if (allDueCards && allDueCards.length > 0) {
      // Filter out cards from excluded notes, BUT always include LEARNING/RELEARNING cards
      // because they need to be shown when due (that's the whole point of the learning loop)
      const availableCards = allDueCards.filter(card => {
        // Learning cards should always be shown when due - don't exclude them
        if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
          return true;
        }
        // For NEW/REVIEW cards, exclude recently-studied notes for variety
        return !excludeNoteIds.includes(card.note_id);
      });
      console.log('[useOfflineNextCard] Available cards after filtering:', availableCards.length);

      if (availableCards.length > 0) {
        // 1. Learning/relearning cards due NOW always have priority (they have timers)
        const learningDue = availableCards.filter(c =>
          (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
          c.due_timestamp && c.due_timestamp <= now
        );
        if (learningDue.length > 0) {
          learningDue.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
          currentSelectedCardId = learningDue[0].id;
          console.log('[useOfflineNextCard] Selected LEARNING card (due now):', {
            cardId: learningDue[0].id,
            queue: learningDue[0].queue,
            noteId: learningDue[0].note_id,
          });
          return learningDue[0];
        }

        // 2. If we have a currently selected card and it's still available, keep it
        // This prevents flickering from random re-selection on each render
        if (currentSelectedCardId) {
          const currentCard = availableCards.find(c => c.id === currentSelectedCardId);
          if (currentCard) {
            console.log('[useOfflineNextCard] Keeping current card:', {
              cardId: currentCard.id,
              noteId: currentCard.note_id,
            });
            return currentCard;
          }
          // Current card no longer available, clear it
          console.log('[useOfflineNextCard] Current card no longer available, will select new');
          currentSelectedCardId = null;
        }

        // 3. Mix new and review cards proportionally (Anki "Mix with reviews" mode)
        const newCards = availableCards.filter(c => c.queue === CardQueue.NEW);
        const reviewCards = availableCards.filter(c => c.queue === CardQueue.REVIEW);
        const totalMixable = newCards.length + reviewCards.length;

        if (totalMixable > 0) {
          // Proportional selection: probability based on queue sizes
          const newProbability = newCards.length / totalMixable;
          const random = Math.random();
          console.log('[useOfflineNextCard] Proportional selection:', {
            newCards: newCards.length,
            reviewCards: reviewCards.length,
            newProbability,
            random,
            willSelectNew: random < newProbability,
          });

          let selectedCard: LocalCard | null = null;
          if (random < newProbability && newCards.length > 0) {
            selectedCard = newCards[0];
            console.log('[useOfflineNextCard] Selected NEW card:', {
              cardId: selectedCard.id,
              noteId: selectedCard.note_id,
            });
          } else if (reviewCards.length > 0) {
            selectedCard = reviewCards[0];
            console.log('[useOfflineNextCard] Selected REVIEW card:', {
              cardId: selectedCard.id,
              noteId: selectedCard.note_id,
            });
          } else if (newCards.length > 0) {
            selectedCard = newCards[0];
            console.log('[useOfflineNextCard] Fallback to NEW card:', {
              cardId: selectedCard.id,
              noteId: selectedCard.note_id,
            });
          }

          if (selectedCard) {
            currentSelectedCardId = selectedCard.id;
            return selectedCard;
          }
        }
      }
    }

    // 4. If nothing immediately due, check for learning cards with delays.
    // Serve them immediately so the user doesn't have to wait.
    console.log('[useOfflineNextCard] Checking for delayed learning cards...');
    let delayedLearningCards: LocalCard[];
    if (deckId) {
      delayedLearningCards = await db.cards
        .where('deck_id').equals(deckId)
        .filter(c => c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING)
        .toArray();
    } else {
      delayedLearningCards = await db.cards
        .filter(c => c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING)
        .toArray();
    }

    // Note: We intentionally do NOT filter delayed learning cards by excludeNoteIds.
    // Learning cards must be shown when due - that's the core of spaced repetition.
    // The excludeNoteIds filter is only for NEW/REVIEW cards to provide variety.

    if (delayedLearningCards.length > 0) {
      // Return the one with the shortest delay
      delayedLearningCards.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
      currentSelectedCardId = delayedLearningCards[0].id;
      console.log('[useOfflineNextCard] Selected DELAYED LEARNING card:', {
        cardId: delayedLearningCards[0].id,
        noteId: delayedLearningCards[0].note_id,
        dueTimestamp: delayedLearningCards[0].due_timestamp,
      });
      return delayedLearningCards[0];
    }

    console.log('[useOfflineNextCard] No card selected');
    currentSelectedCardId = null;
    return null;
  }, [allDueCards, excludeNoteIds, deckId]);

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
  // Only return when data is consistent (card.note_id matches note.id)
  // This prevents returning stale note data when card changes
  const dataIsConsistent = nextCard && note && nextCard.note_id === note.id;
  const cardWithNote: CardWithNote | null = dataIsConsistent ? {
    ...nextCard,
    note: note as Note,
  } : null;

  // Consider "loading" if:
  // 1. Due cards haven't loaded yet (initial load)
  // 2. We have a card selected but note hasn't loaded yet (transitioning between cards)
  // This prevents the "All Done!" screen from flashing during card transitions
  const isTransitioning = nextCard !== null && !dataIsConsistent;
  const isLoading = allDueCards === undefined || isTransitioning;

  if (isTransitioning) {
    console.log('[useOfflineNextCard] Transitioning - card selected but note not ready', {
      nextCardId: nextCard?.id,
      nextCardNoteId: nextCard?.note_id,
      noteId: note?.id,
      dataIsConsistent,
    });
  }

  return {
    card: cardWithNote,
    counts: counts || { new: 0, learning: 0, review: 0 },
    intervalPreviews,
    isLoading,
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
      sessionId: _sessionId, // Kept for API compatibility, no longer used in event-sourced architecture
      recordingBlob,
    }: {
      cardId: string;
      rating: Rating;
      timeSpentMs?: number;
      userAnswer?: string;
      sessionId?: string;
      recordingBlob?: Blob;
    }) => {
      // Get the card
      const card = await db.cards.get(cardId);
      if (!card) {
        throw new Error('Card not found');
      }

      // If this card was NEW, increment the daily counter BEFORE updating the card
      // This ensures the counter stays in sync with actual new cards studied
      const wasNewCard = card.queue === CardQueue.NEW;
      if (wasNewCard) {
        await incrementNewCardsStudiedToday(card.deck_id);
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

      // Update card with new state - this is the critical path for UI responsiveness
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

      // Clear the cached card selection to force picking a new card
      // This prevents the same card from being shown again before Dexie's live query updates
      currentSelectedCardId = null;

      // Create review event for event-sourced architecture
      await createLocalReviewEvent({
        id: reviewId,
        card_id: cardId,
        rating,
        time_spent_ms: timeSpentMs || null,
        user_answer: userAnswer || null,
        reviewed_at: reviewedAt,
        _synced: 0,
      });

      // Store recording blob separately (will be uploaded during sync)
      if (recordingBlob) {
        await storePendingRecording({
          id: reviewId,
          blob: recordingBlob,
          uploaded: false,
          created_at: reviewedAt,
        });
      }

      // Trigger background sync if online
      if (navigator.onLine) {
        syncService.syncEvents().catch(console.error);
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
