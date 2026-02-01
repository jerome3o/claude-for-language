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

interface UseStudySessionOptions {
  deckId?: string;
  bonusNewCards?: number;
  enabled?: boolean;
}

export function useStudySession(options: UseStudySessionOptions = {}) {
  const { deckId, bonusNewCards = 0, enabled = true } = options;

  // Local queue state
  const [queue, setQueue] = useState<LocalCard[]>([]);
  const [currentCard, setCurrentCard] = useState<LocalCard | null>(null);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [currentDeck, setCurrentDeck] = useState<Deck | null>(null);
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

  // Select the next card from the queue
  const selectNextCard = useCallback(async () => {
    const now = Date.now();
    console.log('[useStudySession] Selecting next card', {
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
          const note = await db.notes.get(selected.note_id);
          const deck = await db.decks.get(selected.deck_id);

          if (note) {
            console.log('[useStudySession] Selected delayed learning card:', selected.id);
            setCurrentCard(selected);
            setCurrentNote(note);
            setCurrentDeck(deck || null);
            return;
          }
        }
      }

      console.log('[useStudySession] No cards available');
      setCurrentCard(null);
      setCurrentNote(null);
      setCurrentDeck(null);
      return;
    }

    // Filter out recently studied notes (except learning cards)
    const availableCards = queue.filter(card => {
      if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
        return true;
      }
      return !recentNoteIds.includes(card.note_id);
    });

    if (availableCards.length === 0) {
      // All cards are from recent notes, just pick from full queue
      console.log('[useStudySession] All cards from recent notes, using full queue');
    }

    const cardsToChooseFrom = availableCards.length > 0 ? availableCards : queue;

    // Priority 1: Learning cards due NOW
    const learningDue = cardsToChooseFrom.filter(c =>
      (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
      c.due_timestamp && c.due_timestamp <= now
    );

    let selected: LocalCard | null = null;

    if (learningDue.length > 0) {
      selected = pickWeightedLearningCard(learningDue, now);
      console.log('[useStudySession] Selected learning card:', selected?.id);
    } else {
      // Priority 2: Mix new and review cards proportionally
      const newCards = cardsToChooseFrom.filter(c => c.queue === CardQueue.NEW);
      const reviewCards = cardsToChooseFrom.filter(c => c.queue === CardQueue.REVIEW);
      const totalMixable = newCards.length + reviewCards.length;

      if (totalMixable > 0) {
        const newProbability = newCards.length / totalMixable;
        const random = Math.random();

        if (random < newProbability && newCards.length > 0) {
          selected = pickRandom(newCards);
          console.log('[useStudySession] Selected new card:', selected?.id);
        } else if (reviewCards.length > 0) {
          selected = pickRandom(reviewCards);
          console.log('[useStudySession] Selected review card:', selected?.id);
        } else if (newCards.length > 0) {
          selected = pickRandom(newCards);
          console.log('[useStudySession] Fallback to new card:', selected?.id);
        }
      }
    }

    if (!selected) {
      // Priority 3: Any learning card (even if not due yet)
      const anyLearning = cardsToChooseFrom.filter(c =>
        c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING
      );
      if (anyLearning.length > 0) {
        anyLearning.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
        selected = anyLearning[0];
        console.log('[useStudySession] Selected waiting learning card:', selected?.id);
      }
    }

    if (selected) {
      // Load note and deck
      const [note, deck] = await Promise.all([
        db.notes.get(selected.note_id),
        db.decks.get(selected.deck_id),
      ]);

      if (note) {
        setCurrentCard(selected);
        setCurrentNote(note);
        setCurrentDeck(deck || null);
        return;
      }
    }

    console.log('[useStudySession] No card selected');
    setCurrentCard(null);
    setCurrentNote(null);
    setCurrentDeck(null);
  }, [queue, recentNoteIds, deckId]);

  // Select first card when queue loads
  useEffect(() => {
    if (!isLoading && queue.length > 0 && !currentCard) {
      selectNextCard();
    }
  }, [isLoading, queue.length, currentCard, selectNextCard]);

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
    if (!currentCard) return;

    const cardId = currentCard.id;
    const noteId = currentCard.note_id;

    console.log('[useStudySession] Rating card', { cardId, rating });

    // Update recent notes
    setRecentNoteIds(prev => [...prev.slice(-4), noteId]);

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

    // Update local queue immediately (optimistic update)
    setQueue(prevQueue => {
      const newQueue = prevQueue.filter(c => c.id !== cardId);

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

      return newQueue;
    });

    // Clear current card to trigger next selection
    setCurrentCard(null);
    setCurrentNote(null);

    // Submit review in background (don't await)
    reviewMutation.mutate({
      cardId,
      rating,
      timeSpentMs,
      userAnswer,
      recordingBlob,
    });

    // Select next card
    // Small delay to let state update
    setTimeout(() => selectNextCard(), 0);
  }, [currentCard, currentDeck, reviewMutation, selectNextCard]);

  // Calculate current state
  const counts = calculateQueueCounts(queue);

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
  };
}
