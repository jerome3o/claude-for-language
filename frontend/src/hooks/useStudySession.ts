/**
 * useStudySession - Manages study session state with a local queue
 *
 * This hook preloads due cards into a local queue and manages transitions
 * imperatively rather than reactively. This eliminates the cascade of
 * re-renders that happened with the previous useLiveQuery-based approach.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  db,
  LocalCard,
  getDueCards,
  getQueueCounts,
  getStudyCutoff,
  getReviewedNoteIds,
  ensureDailyStatsInitialized,
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

// Helper: Pick a new card using priority tiers:
//   1. Unreviewed note + hanzi_to_meaning  (user sees hanzi first for a brand-new word)
//   2. Unreviewed note (any type)
//   3. Reviewed note + hanzi_to_meaning
//   4. Any new card (fallback)
function pickPrioritizedNewCard(newCards: LocalCard[], reviewedNoteIds: Set<string>): LocalCard | null {
  if (newCards.length === 0) return null;
  const tier1 = newCards.filter(c => !reviewedNoteIds.has(c.note_id) && c.card_type === 'hanzi_to_meaning');
  if (tier1.length > 0) return pickRandom(tier1);
  const tier2 = newCards.filter(c => !reviewedNoteIds.has(c.note_id));
  if (tier2.length > 0) return pickRandom(tier2);
  const tier3 = newCards.filter(c => c.card_type === 'hanzi_to_meaning');
  if (tier3.length > 0) return pickRandom(tier3);
  return pickRandom(newCards);
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


// Get interval preview locally
function getIntervalPreviewLocal(rating: Rating, card: LocalCard, settings: DeckSettings): IntervalPreview {
  return getIntervalPreview(
    rating,
    card.queue,
    card.learning_step,
    card.ease_factor,
    card.interval,
    card.repetitions,
    settings,
    card.stability,
    card.difficulty,
    card.lapses,
    card.updated_at
  );
}

// Synchronously select the next card from a queue (pure function)
function selectNextCardFromQueue(
  queue: LocalCard[],
  recentNoteIds: string[],
  reviewedNoteIds: Set<string>,
  lastRatedCardId?: string,
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
      return pickPrioritizedNewCard(newCards, reviewedNoteIds);
    } else if (reviewCards.length > 0) {
      return pickRandom(reviewCards);
    } else if (newCards.length > 0) {
      return pickPrioritizedNewCard(newCards, reviewedNoteIds);
    }
  }

  // Priority 3: Learning cards on cooldown but due today — show immediately
  // User preference: drill all cards in one sitting, show same card right away if needed
  const studyCutoff = getStudyCutoff();
  const cooldownCards = cardsToChooseFrom.filter(c =>
    (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
    (!c.due_timestamp || c.due_timestamp <= studyCutoff.ts)
  );
  if (cooldownCards.length > 0) {
    cooldownCards.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
    // Prefer a different card from the one just rated, if alternatives exist
    if (lastRatedCardId && cooldownCards.length > 1) {
      const other = cooldownCards.find(c => c.id !== lastRatedCardId);
      if (other) return other;
    }
    return cooldownCards[0];
  }

  return null;
}

export interface SessionStats {
  totalReviews: number;
  correctCount: number;
  againCount: number;
  bestStreak: number;
  currentStreak: number;
  cardsRatedAgainMultiple: Set<string>;
  timeStarted: number;
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
  // Monotonic counter — incremented every time a new card is shown (even same ID)
  const [cardVersion, setCardVersion] = useState(0);
  const [currentCardState, setCurrentCardState] = useState<CurrentCardState>({
    card: null,
    note: null,
    deck: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [recentNoteIds, setRecentNoteIds] = useState<string[]>([]);
  const [hasMoreNewCards, setHasMoreNewCards] = useState(false);

  // Session stats tracking
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    totalReviews: 0,
    correctCount: 0,
    againCount: 0,
    bestStreak: 0,
    currentStreak: 0,
    cardsRatedAgainMultiple: new Set(),
    timeStarted: Date.now(),
  });
  const againCountByNoteRef = useRef<Map<string, number>>(new Map());

  // Track if we've initialized
  const initializedRef = useRef(false);
  const deckIdRef = useRef(deckId);
  const bonusNewCardsRef = useRef(bonusNewCards);

  // Track pending background DB writes so we can await them before fallback queries
  const pendingWritesRef = useRef<Promise<void>[]>([]);

  // Note IDs with at least one reviewed card — used to prioritize unreviewed notes in new card selection
  const reviewedNoteIdsRef = useRef<Set<string>>(new Set());

  // Load initial queue
  const loadQueue = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    try {
      await ensureDailyStatsInitialized();
      const [dueCards, counts, reviewedIds] = await Promise.all([
        getDueCards(deckId, bonusNewCards),
        getQueueCounts(deckId, bonusNewCards),
        getReviewedNoteIds(deckId),
      ]);
      setQueue(dueCards);
      setHasMoreNewCards(counts.hasMoreNew);
      reviewedNoteIdsRef.current = reviewedIds;
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
        const studyCutoff = getStudyCutoff();
        const dueToday = delayedLearningCards.filter(c =>
          !c.due_timestamp || c.due_timestamp <= studyCutoff.ts
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
    const selected = selectNextCardFromQueue(queue, recentNoteIds, reviewedNoteIdsRef.current);

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
        settings,
        card.stability,
        card.difficulty,
        card.lapses,
        card.updated_at
      );

      const reviewId = crypto.randomUUID();
      const reviewedAt = new Date().toISOString();

      // Update card in IndexedDB (including FSRS fields)
      await db.cards.update(cardId, {
        queue: result.queue,
        learning_step: result.learning_step,
        ease_factor: result.ease_factor,
        interval: result.interval,
        repetitions: result.repetitions,
        next_review_at: result.next_review_at?.toISOString() || null,
        due_timestamp: result.due_timestamp,
        stability: result.stability,
        difficulty: result.difficulty,
        lapses: result.lapses,
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

    // Update session stats
    setSessionStats(prev => {
      const isCorrect = rating === 2 || rating === 3; // Good or Easy
      const isAgain = rating === 0;
      const newCurrentStreak = isCorrect ? prev.currentStreak + 1 : 0;
      const newBestStreak = Math.max(prev.bestStreak, newCurrentStreak);

      // Track again counts per note for leech detection
      const newAgainMultiple = new Set(prev.cardsRatedAgainMultiple);
      if (isAgain) {
        const count = (againCountByNoteRef.current.get(noteId) || 0) + 1;
        againCountByNoteRef.current.set(noteId, count);
        if (count >= 2) {
          newAgainMultiple.add(noteId);
        }
      }

      return {
        ...prev,
        totalReviews: prev.totalReviews + 1,
        correctCount: prev.correctCount + (isCorrect ? 1 : 0),
        againCount: prev.againCount + (isAgain ? 1 : 0),
        currentStreak: newCurrentStreak,
        bestStreak: newBestStreak,
        cardsRatedAgainMultiple: newAgainMultiple,
      };
    });

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
      settings,
      currentCard.stability,
      currentCard.difficulty,
      currentCard.lapses,
      currentCard.updated_at
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
        stability: result.stability,
        difficulty: result.difficulty,
        lapses: result.lapses,
      };
      newQueue.push(updatedCard);
    }

    // Update recent notes for variety filtering
    const newRecentNoteIds = [...recentNoteIds.slice(-4), noteId];

    // Select the next card synchronously from the new queue
    const nextCard = selectNextCardFromQueue(newQueue, newRecentNoteIds, reviewedNoteIdsRef.current, cardId);

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
      setCardVersion(v => v + 1);
      setCurrentCardState({ card: nextCard, note: note || null, deck: deck || null });
    } else {
      // No card from queue - need to check IndexedDB for delayed learning cards.
      // First, await any pending background writes so the DB query sees all state.
      if (pendingWritesRef.current.length > 0) {
        console.log('[useStudySession] Awaiting', pendingWritesRef.current.length, 'pending DB writes before fallback query');
        await Promise.all(pendingWritesRef.current);
        pendingWritesRef.current = [];
      }

      // Then update IndexedDB with the current card's new state,
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
        const studyCutoff = getStudyCutoff();
        const dueToday = delayedLearningCards.filter(c =>
          !c.due_timestamp || c.due_timestamp <= studyCutoff.ts
        );

        if (dueToday.length > 0) {
          dueToday.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));

          // Show immediately — even if it's the same card just rated (user preference:
          // drill all cards in one sitting without waiting for cooldowns)
          const selected = dueToday[0];

          const [note, deck] = await Promise.all([
            db.notes.get(selected.note_id),
            db.decks.get(selected.deck_id),
          ]);

          if (note) {
            console.log('[useStudySession] Selected delayed learning card:', selected.id);
            setQueue(newQueue);
            setRecentNoteIds(newRecentNoteIds);
            setCardVersion(v => v + 1);
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

    // Submit review in background (don't await), but track the promise
    // so we can await it if the next rating needs to query IndexedDB
    const writePromise = reviewMutation.mutateAsync({
      cardId,
      rating,
      timeSpentMs,
      userAnswer,
      recordingBlob,
    }).then(() => {
      pendingWritesRef.current = pendingWritesRef.current.filter(p => p !== writePromise);
    }).catch(() => {
      pendingWritesRef.current = pendingWritesRef.current.filter(p => p !== writePromise);
    });
    pendingWritesRef.current.push(writePromise);
  }, [currentCardState, queue, recentNoteIds, reviewMutation]);

  // Derive counts directly from the in-memory queue so the header updates in the
  // same render as the card transition (no DB round-trip).
  const counts: QueueCounts = useMemo(() => {
    let n = 0, l = 0, r = 0;
    for (const c of queue) {
      if (c.queue === CardQueue.NEW) n++;
      else if (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) l++;
      else if (c.queue === CardQueue.REVIEW) r++;
    }
    return { new: n, learning: l, review: r };
  }, [queue]);
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

  // Remove a deleted note's cards from the session and advance to the next card.
  // Call this after deleting a note from IndexedDB so the in-memory queue stays
  // consistent and we don't try to display a card whose note no longer exists.
  const removeNoteFromSession = useCallback(async (noteId: string) => {
    const newQueue = queue.filter(c => c.note_id !== noteId);
    const newRecentNoteIds = recentNoteIds.filter(id => id !== noteId);

    const nextCard = selectNextCardFromQueue(newQueue, newRecentNoteIds, reviewedNoteIdsRef.current);

    if (nextCard) {
      const [note, deck] = await Promise.all([
        db.notes.get(nextCard.note_id),
        db.decks.get(nextCard.deck_id),
      ]);

      if (note) {
        setQueue(newQueue);
        setRecentNoteIds(newRecentNoteIds);
        setCardVersion(v => v + 1);
        setCurrentCardState({ card: nextCard, note, deck: deck || null });
        return;
      }
    }

    // No card in the filtered queue — check for delayed learning cards in IndexedDB
    if (newQueue.length === 0) {
      let delayedLearningCards: LocalCard[];
      if (deckId) {
        delayedLearningCards = await db.cards
          .where('deck_id').equals(deckId)
          .filter(c =>
            (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
            c.note_id !== noteId
          )
          .toArray();
      } else {
        delayedLearningCards = await db.cards
          .filter(c =>
            (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
            c.note_id !== noteId
          )
          .toArray();
      }

      if (delayedLearningCards.length > 0) {
        const studyCutoff = getStudyCutoff();
        const dueToday = delayedLearningCards.filter(c =>
          !c.due_timestamp || c.due_timestamp <= studyCutoff.ts
        );

        if (dueToday.length > 0) {
          dueToday.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
          const selected = dueToday[0];

          const [note, deck] = await Promise.all([
            db.notes.get(selected.note_id),
            db.decks.get(selected.deck_id),
          ]);

          if (note) {
            setQueue(newQueue);
            setRecentNoteIds(newRecentNoteIds);
            setCardVersion(v => v + 1);
            setCurrentCardState({ card: selected, note, deck: deck || null });
            return;
          }
        }
      }
    }

    // Session is complete
    setQueue(newQueue);
    setRecentNoteIds(newRecentNoteIds);
    setCurrentCardState({ card: null, note: null, deck: null });
  }, [queue, recentNoteIds, deckId]);

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
      // Guard against stale async updates from a previous card: if the update
      // carries an explicit note id that doesn't match the current note, ignore it.
      // This happens when background generation (fun facts, sentence clue, etc.)
      // resolves after the user has already moved on to the next card.
      if (updatedNote.id && updatedNote.id !== prev.note.id) return prev;
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
    cardVersion,
    counts,
    intervalPreviews,
    hasMoreNewCards,
    isRating: reviewMutation.isPending,
    sessionStats,

    // Actions
    rateCard,
    reloadQueue,
    selectNextCard,
    removeNoteFromSession,
    updateCurrentNote,
  };
}
