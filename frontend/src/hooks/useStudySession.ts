/**
 * useStudySession - Manages study session state with a local queue
 *
 * This hook preloads due cards into a local queue and manages transitions
 * imperatively rather than reactively. This eliminates the cascade of
 * re-renders that happened with the previous useLiveQuery-based approach.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  db,
  LocalCard,
  getDueCards,
  createLocalReviewEvent,
  storePendingRecording,
  incrementNewCardsStudiedToday,
} from '../db/database';
import {
  scheduleCard,
  deckSettingsFromDb,
  DeckSettings,
  DEFAULT_DECK_SETTINGS,
  getIntervalPreview,
} from '../services/anki-scheduler';
import { syncService } from '../services/sync';
import { Rating, CardQueue, CardWithNote, Note, IntervalPreview, QueueCounts, Deck } from '../types';

// Helper: Pick a random element from an array
function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Helper: Weighted random selection for learning cards
function pickWeightedLearningCard(cards: LocalCard[], now: number): LocalCard | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return cards[0];

  const weights = cards.map(card => {
    const overdueMs = Math.max(0, now - (card.due_timestamp || now));
    const overdueMinutes = overdueMs / 60000;
    return 1 + overdueMinutes;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < cards.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return cards[i];
    }
  }

  return cards[cards.length - 1];
}

// Calculate queue counts from a list of cards
function calculateQueueCounts(cards: LocalCard[]): QueueCounts {
  let newCount = 0;
  let learningCount = 0;
  let reviewCount = 0;

  for (const card of cards) {
    switch (card.queue) {
      case CardQueue.NEW:
        newCount++;
        break;
      case CardQueue.LEARNING:
      case CardQueue.RELEARNING:
        learningCount++;
        break;
      case CardQueue.REVIEW:
        reviewCount++;
        break;
    }
  }

  return { new: newCount, learning: learningCount, review: reviewCount };
}

// Get interval preview locally
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

// Synchronously select the next card from a queue (pure function)
function selectNextCardFromQueue(
  queue: LocalCard[],
  recentNoteIds: string[]
): LocalCard | null {
  const now = Date.now();

  if (queue.length === 0) {
    return null;
  }

  // Filter out recently studied notes (except learning cards)
  const availableCards = queue.filter(card => {
    if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      return true;
    }
    return !recentNoteIds.includes(card.note_id);
  });

  const cardsToChooseFrom = availableCards.length > 0 ? availableCards : queue;

  // Priority 1: Learning cards due NOW
  const learningDue = cardsToChooseFrom.filter(c =>
    (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
    c.due_timestamp && c.due_timestamp <= now
  );

  if (learningDue.length > 0) {
    return pickWeightedLearningCard(learningDue, now);
  }

  // Priority 2: Mix new and review cards proportionally
  const newCards = cardsToChooseFrom.filter(c => c.queue === CardQueue.NEW);
  const reviewCards = cardsToChooseFrom.filter(c => c.queue === CardQueue.REVIEW);
  const totalMixable = newCards.length + reviewCards.length;

  if (totalMixable > 0) {
    const newProbability = newCards.length / totalMixable;
    const random = Math.random();

    if (random < newProbability && newCards.length > 0) {
      return pickRandom(newCards);
    } else if (reviewCards.length > 0) {
      return pickRandom(reviewCards);
    } else if (newCards.length > 0) {
      return pickRandom(newCards);
    }
  }

  // Priority 3: Any learning card (even if not due yet)
  const anyLearning = cardsToChooseFrom.filter(c =>
    c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING
  );
  if (anyLearning.length > 0) {
    anyLearning.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
    return anyLearning[0];
  }

  return null;
}

interface UseStudySessionOptions {
  deckId?: string;
  bonusNewCards?: number;
  enabled?: boolean;
}

// Combined state for current card to ensure atomic updates
interface CurrentCardState {
  card: LocalCard | null;
  note: Note | null;
  deck: Deck | null;
}

export function useStudySession(options: UseStudySessionOptions = {}) {
  const { deckId, bonusNewCards = 0, enabled = true } = options;

  // Local queue state
  const [queue, setQueue] = useState<LocalCard[]>([]);
  const [currentCardState, setCurrentCardState] = useState<CurrentCardState>({
    card: null,
    note: null,
    deck: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [recentNoteIds, setRecentNoteIds] = useState<string[]>([]);
  const [hasMoreNewCards, setHasMoreNewCards] = useState(false);

  // Track if we've initialized
  const initializedRef = useRef(false);
  const deckIdRef = useRef(deckId);
  const bonusNewCardsRef = useRef(bonusNewCards);

  // Load initial queue
  const loadQueue = useCallback(async () => {
    if (!enabled) return;

    console.log('[useStudySession] Loading queue', { deckId, bonusNewCards });
    setIsLoading(true);

    try {
      const dueCards = await getDueCards(deckId, bonusNewCards);
      console.log('[useStudySession] Loaded', dueCards.length, 'due cards');
      setQueue(dueCards);

      // Check if there are more new cards beyond the limit
      const allNewCards = await db.cards
        .filter(c => c.queue === CardQueue.NEW && (!deckId || c.deck_id === deckId))
        .count();
      const newInQueue = dueCards.filter(c => c.queue === CardQueue.NEW).length;
      setHasMoreNewCards(allNewCards > newInQueue);

      initializedRef.current = true;
    } catch (error) {
      console.error('[useStudySession] Failed to load queue:', error);
    } finally {
      setIsLoading(false);
    }
  }, [deckId, bonusNewCards, enabled]);

  // Initialize on mount or when deckId/bonusNewCards changes
  useEffect(() => {
    if (!enabled) return;

    // Reload if deckId or bonusNewCards changed
    if (initializedRef.current &&
        (deckIdRef.current !== deckId || bonusNewCardsRef.current !== bonusNewCards)) {
      console.log('[useStudySession] Options changed, reloading queue');
      initializedRef.current = false;
    }

    deckIdRef.current = deckId;
    bonusNewCardsRef.current = bonusNewCards;

    if (!initializedRef.current) {
      loadQueue();
    }
  }, [deckId, bonusNewCards, enabled, loadQueue]);

  // Select the next card from the queue (async version for fallback cases)
  const selectNextCard = useCallback(async () => {
    const now = Date.now();
    console.log('[useStudySession] Selecting next card (async)', {
      queueLength: queue.length,
      recentNoteIds: recentNoteIds.length
    });

    if (queue.length === 0) {
      console.log('[useStudySession] Queue empty, checking for delayed learning cards');

      // Check for learning cards with delays (due today but on cooldown)
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

      if (delayedLearningCards.length > 0) {
        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);
        const dueToday = delayedLearningCards.filter(c =>
          !c.due_timestamp || c.due_timestamp <= endOfToday.getTime()
        );

        if (dueToday.length > 0) {
          // Sort by due_timestamp and pick soonest
          dueToday.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
          const selected = dueToday[0];

          // Load note and deck
          const [note, deck] = await Promise.all([
            db.notes.get(selected.note_id),
            db.decks.get(selected.deck_id),
          ]);

          if (note) {
            console.log('[useStudySession] Selected delayed learning card:', selected.id);
            setCurrentCardState({ card: selected, note, deck: deck || null });
            return;
          }
        }
      }

      console.log('[useStudySession] No cards available');
      setCurrentCardState({ card: null, note: null, deck: null });
      return;
    }

    // Use the pure selection function
    const selected = selectNextCardFromQueue(queue, recentNoteIds);

    if (selected) {
      // Load note and deck
      const [note, deck] = await Promise.all([
        db.notes.get(selected.note_id),
        db.decks.get(selected.deck_id),
      ]);

      if (note) {
        console.log('[useStudySession] Selected card:', selected.id, 'queue:', selected.queue);
        setCurrentCardState({ card: selected, note, deck: deck || null });
        return;
      }
    }

    console.log('[useStudySession] No card selected');
    setCurrentCardState({ card: null, note: null, deck: null });
  }, [queue, recentNoteIds, deckId]);

  // Select first card when queue loads
  useEffect(() => {
    if (!isLoading && queue.length > 0 && !currentCardState.card) {
      selectNextCard();
    }
  }, [isLoading, queue.length, currentCardState.card, selectNextCard]);

  // Submit review mutation
  const reviewMutation = useMutation({
    mutationFn: async ({
      cardId,
      rating,
      timeSpentMs,
      userAnswer,
      sessionId: _sessionId,
      recordingBlob,
    }: {
      cardId: string;
      rating: Rating;
      timeSpentMs?: number;
      userAnswer?: string;
      sessionId?: string;
      recordingBlob?: Blob;
    }) => {
      const card = await db.cards.get(cardId);
      if (!card) throw new Error('Card not found');

      // Increment daily counter for new cards
      if (card.queue === CardQueue.NEW) {
        await incrementNewCardsStudiedToday(card.deck_id);
      }

      // Get deck settings and calculate new state
      const deck = await db.decks.get(card.deck_id);
      const settings = deck ? deckSettingsFromDb(deck) : DEFAULT_DECK_SETTINGS;

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

      // Update card in IndexedDB
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

      // Create review event
      await createLocalReviewEvent({
        id: reviewId,
        card_id: cardId,
        rating,
        time_spent_ms: timeSpentMs || null,
        user_answer: userAnswer || null,
        reviewed_at: reviewedAt,
        _synced: 0,
      });

      // Store recording if present
      if (recordingBlob) {
        await storePendingRecording({
          id: reviewId,
          blob: recordingBlob,
          uploaded: false,
          created_at: reviewedAt,
        });
      }

      // Background sync
      if (navigator.onLine) {
        syncService.syncEvents().catch(console.error);
      }

      return {
        cardId,
        newQueue: result.queue,
        newDueTimestamp: result.due_timestamp,
        interval: result.interval,
      };
    },
  });

  // Rate the current card and transition to next
  const rateCard = useCallback(async (rating: Rating, timeSpentMs: number, userAnswer?: string, recordingBlob?: Blob) => {
    const currentCard = currentCardState.card;
    const currentDeck = currentCardState.deck;

    if (!currentCard) return;

    const cardId = currentCard.id;
    const noteId = currentCard.note_id;

    console.log('[useStudySession] Rating card', { cardId, rating });

    // Get deck settings for calculating new state
    const settings = currentDeck ? deckSettingsFromDb(currentDeck) : DEFAULT_DECK_SETTINGS;

    // Calculate what the new state will be
    const result = scheduleCard(
      rating,
      currentCard.queue,
      currentCard.learning_step,
      currentCard.ease_factor,
      currentCard.interval,
      currentCard.repetitions,
      settings
    );

    // Build the new queue
    let newQueue = queue.filter(c => c.id !== cardId);

    // If card is still in learning, add it back with updated state
    if (result.queue === CardQueue.LEARNING || result.queue === CardQueue.RELEARNING) {
      const updatedCard: LocalCard = {
        ...currentCard,
        queue: result.queue,
        learning_step: result.learning_step,
        ease_factor: result.ease_factor,
        interval: result.interval,
        repetitions: result.repetitions,
        due_timestamp: result.due_timestamp,
      };
      newQueue.push(updatedCard);
    }

    // Update recent notes for variety filtering
    const newRecentNoteIds = [...recentNoteIds.slice(-4), noteId];

    // Select the next card synchronously from the new queue
    const nextCard = selectNextCardFromQueue(newQueue, newRecentNoteIds);

    console.log('[useStudySession] Next card selected:', nextCard?.id, 'from queue of', newQueue.length);

    if (nextCard) {
      // Load note and deck for the next card, then update all state atomically
      const [note, deck] = await Promise.all([
        db.notes.get(nextCard.note_id),
        db.decks.get(nextCard.deck_id),
      ]);

      // Update ALL state at once to prevent intermediate renders
      setQueue(newQueue);
      setRecentNoteIds(newRecentNoteIds);
      setCurrentCardState({ card: nextCard, note: note || null, deck: deck || null });
    } else {
      // No card from queue - need to check IndexedDB for delayed learning cards.
      // But first, we must update IndexedDB with the current card's new state,
      // otherwise the query will find this card still in its old LEARNING state.
      const reviewedAt = new Date().toISOString();
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

      // Now check for delayed learning cards with correct DB state
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

      if (delayedLearningCards.length > 0) {
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        const dueToday = delayedLearningCards.filter(c =>
          !c.due_timestamp || c.due_timestamp <= endOfToday.getTime()
        );

        if (dueToday.length > 0) {
          dueToday.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
          const selected = dueToday[0];

          const [note, deck] = await Promise.all([
            db.notes.get(selected.note_id),
            db.decks.get(selected.deck_id),
          ]);

          if (note) {
            console.log('[useStudySession] Selected delayed learning card:', selected.id);
            setQueue(newQueue);
            setRecentNoteIds(newRecentNoteIds);
            setCurrentCardState({ card: selected, note, deck: deck || null });

            // Submit review event in background (card already updated above)
            createLocalReviewEvent({
              id: crypto.randomUUID(),
              card_id: cardId,
              rating,
              time_spent_ms: timeSpentMs || null,
              user_answer: userAnswer || null,
              reviewed_at: reviewedAt,
              _synced: 0,
            }).then(() => {
              if (recordingBlob) {
                storePendingRecording({
                  id: crypto.randomUUID(),
                  blob: recordingBlob,
                  uploaded: false,
                  created_at: reviewedAt,
                });
              }
              if (navigator.onLine) {
                syncService.syncEvents().catch(console.error);
              }
            });
            return;
          }
        }
      }

      // No delayed learning cards - session is truly done
      console.log('[useStudySession] No cards available - session complete');
      setQueue(newQueue);
      setRecentNoteIds(newRecentNoteIds);
      setCurrentCardState({ card: null, note: null, deck: null });

      // Submit review event (card already updated in DB above)
      createLocalReviewEvent({
        id: crypto.randomUUID(),
        card_id: cardId,
        rating,
        time_spent_ms: timeSpentMs || null,
        user_answer: userAnswer || null,
        reviewed_at: reviewedAt,
        _synced: 0,
      }).then(() => {
        if (recordingBlob) {
          storePendingRecording({
            id: crypto.randomUUID(),
            blob: recordingBlob,
            uploaded: false,
            created_at: reviewedAt,
          });
        }
        if (navigator.onLine) {
          syncService.syncEvents().catch(console.error);
        }
      });
      return;
    }

    // Submit review in background (don't await)
    reviewMutation.mutate({
      cardId,
      rating,
      timeSpentMs,
      userAnswer,
      recordingBlob,
    });
  }, [currentCardState, queue, recentNoteIds, reviewMutation, selectNextCard]);

  // Calculate current state
  const counts = calculateQueueCounts(queue);
  const { card: currentCard, note: currentNote, deck: currentDeck } = currentCardState;

  const intervalPreviews: Record<Rating, IntervalPreview> | null =
    currentCard && currentDeck ? {
      0: getIntervalPreviewLocal(0, currentCard, deckSettingsFromDb(currentDeck)),
      1: getIntervalPreviewLocal(1, currentCard, deckSettingsFromDb(currentDeck)),
      2: getIntervalPreviewLocal(2, currentCard, deckSettingsFromDb(currentDeck)),
      3: getIntervalPreviewLocal(3, currentCard, deckSettingsFromDb(currentDeck)),
    } : currentCard ? {
      0: getIntervalPreviewLocal(0, currentCard, DEFAULT_DECK_SETTINGS),
      1: getIntervalPreviewLocal(1, currentCard, DEFAULT_DECK_SETTINGS),
      2: getIntervalPreviewLocal(2, currentCard, DEFAULT_DECK_SETTINGS),
      3: getIntervalPreviewLocal(3, currentCard, DEFAULT_DECK_SETTINGS),
    } : null;

  const cardWithNote: CardWithNote | null = currentCard && currentNote ? {
    ...currentCard,
    note: currentNote,
  } : null;

  // Reload queue (for "Study More" button)
  const reloadQueue = useCallback(() => {
    initializedRef.current = false;
    setRecentNoteIds([]);
    loadQueue();
  }, [loadQueue]);

  // Update the current note (e.g., after regenerating audio)
  const updateCurrentNote = useCallback((updatedNote: Partial<Note>) => {
    setCurrentCardState(prev => {
      if (!prev.note) return prev;
      return {
        ...prev,
        note: { ...prev.note, ...updatedNote },
      };
    });
  }, []);

  return {
    // State
    isLoading,
    currentCard: cardWithNote,
    counts,
    intervalPreviews,
    hasMoreNewCards,
    isRating: reviewMutation.isPending,

    // Actions
    rateCard,
    reloadQueue,
    selectNextCard,
    updateCurrentNote,
  };
}
