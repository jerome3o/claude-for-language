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
  LocalReader,
  LocalGrammarLesson,
  LocalCustomLesson,
  getDueCards,
  getQueueCounts,
  getStudyCutoff,
  getReviewedNoteIds,
  ensureDailyStatsInitialized,
  createLocalReviewEvent,
  storePendingRecording,
  incrementNewCardsStudiedToday,
  decrementNewCardsStudiedToday,
  deleteCardCheckpoint,
  addPendingReviewDeletion,
} from '../db/database';
import {
  scheduleCard,
  deckSettingsFromDb,
  DeckSettings,
  DEFAULT_DECK_SETTINGS,
  getIntervalPreview,
} from '../services/anki-scheduler';
import {
  getDueReaders,
  recordReaderReview,
  getReaderIntervalPreviews,
  readerSchedulingFields,
} from '../services/reader-study';
import { getTodaysGrammarLesson, completeGrammarLesson, syncGrammarLessons, grammarGenerationPending, prefetchGrammarMedia } from '../services/grammar-study';
import {
  getDueCustomLessons,
  completeCustomLesson as recordCustomLessonCompletion,
  getCustomLessonIntervalPreviews,
  lessonSchedulingFields,
  syncCustomLessons,
  prefetchCustomLessonMedia,
} from '../services/custom-lesson-study';
import { ensureDailyReader, syncReadersFromServer, prefetchReaderMedia } from '../services/readerSync';
import { ensureSentenceSetForNote } from '../services/sentence-sets';
import { markDailyActivity } from '../api/client';
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


/**
 * True last-review time for FSRS elapsed_days credit.
 *
 * card.updated_at must NOT be used here: syncs and state fixes bump it, so an
 * 85-days-overdue card can look freshly reviewed — FSRS then sees ~0 elapsed
 * days and gives no overdue stability bonus (intervals come out far too short).
 *
 * Cards written before last_reviewed_at existed fall back to due − interval,
 * which is exactly when the last review happened for a normally scheduled card.
 */
function getCardLastReviewTime(card: LocalCard): string | null {
  if (card.last_reviewed_at) return card.last_reviewed_at;
  if (card.queue !== CardQueue.NEW && card.due_timestamp && card.interval > 0) {
    return new Date(card.due_timestamp - card.interval * 86_400_000).toISOString();
  }
  return null;
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
    getCardLastReviewTime(card)
  );
}

// The next thing to study: a card, a graded reader, a custom mini lesson,
// or a grammar lesson
type NextStudyItem =
  | { card: LocalCard }
  | { reader: LocalReader }
  | { customLesson: LocalCustomLesson }
  | { grammar: LocalGrammarLesson };

// A custom mini lesson is offered after this many card reviews, so lessons
// mix INTO the session instead of piling up at the end.
export const LESSON_MIX_INTERVAL = 8;

/**
 * Synchronously select the next study item from the card queue, the custom
 * lesson queue, and the reader queue (pure function).
 *
 * Cards keep their existing priorities. Custom mini lessons interleave with
 * the cards: one is offered every LESSON_MIX_INTERVAL reviews (lessonBreakDue),
 * and any left over run before the readers. Graded readers come at the VERY
 * END of the session (Jerome's preference): they're only offered once no card
 * is available — the story is the reward after the drilling is done. Today's
 * grammar lesson comes after the readers, closing out the session.
 *
 * Exported for tests.
 */
export function selectNextItem(
  queue: LocalCard[],
  readerQueue: LocalReader[],
  customLessons: LocalCustomLesson[],
  lessonBreakDue: boolean,
  grammarLesson: LocalGrammarLesson | null,
  recentNoteIds: string[],
  reviewedNoteIds: Set<string>,
  lastRatedCardId?: string,
  lastRatedReaderId?: string,
): NextStudyItem | null {
  const now = Date.now();

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
    const card = pickWeightedLearningCard(learningDue, now);
    if (card) return { card };
  }

  // Custom-lesson break: after enough card reviews, slot a mini lesson into
  // the flow. Learning cards due NOW still win (their timers are active).
  if (lessonBreakDue && customLessons.length > 0) {
    return { customLesson: customLessons[0] };
  }

  // Priority 2: Mix new and review cards proportionally
  const newCards = cardsToChooseFrom.filter(c => c.queue === CardQueue.NEW);
  const reviewCards = cardsToChooseFrom.filter(c => c.queue === CardQueue.REVIEW);
  const totalMixable = newCards.length + reviewCards.length;

  if (totalMixable > 0) {
    const newProbability = newCards.length / totalMixable;
    const random = Math.random();

    if (random < newProbability && newCards.length > 0) {
      const card = pickPrioritizedNewCard(newCards, reviewedNoteIds);
      if (card) return { card };
    }
    if (reviewCards.length > 0) {
      const card = pickRandom(reviewCards);
      if (card) return { card };
    }
    if (newCards.length > 0) {
      const card = pickPrioritizedNewCard(newCards, reviewedNoteIds);
      if (card) return { card };
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
      if (other) return { card: other };
    }
    return { card: cooldownCards[0] };
  }

  // Priority 3.5: Cards done — any custom lessons that never hit an
  // interleave break run now, before the readers.
  if (customLessons.length > 0) {
    return { customLesson: customLessons[0] };
  }

  // Priority 4: All cards done — graded readers close out the session.
  // Learning readers whose timer expired first, then new/review readers,
  // then learning readers still on cooldown but due today.
  const learningReadersDue = readerQueue.filter(r =>
    (r.queue === CardQueue.LEARNING || r.queue === CardQueue.RELEARNING) &&
    r.due_timestamp && r.due_timestamp <= now
  );
  if (learningReadersDue.length > 0) {
    const other = learningReadersDue.find(r => r.id !== lastRatedReaderId);
    return { reader: other ?? learningReadersDue[0] };
  }

  const freshReaders = readerQueue.filter(r =>
    r.queue === CardQueue.NEW || r.queue === CardQueue.REVIEW
  );
  if (freshReaders.length > 0) {
    const reader = pickRandom(freshReaders);
    if (reader) return { reader };
  }

  const cooldownReaders = readerQueue.filter(r =>
    (r.queue === CardQueue.LEARNING || r.queue === CardQueue.RELEARNING) &&
    (!r.due_timestamp || r.due_timestamp <= studyCutoff.ts)
  );
  if (cooldownReaders.length > 0) {
    cooldownReaders.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
    const other = cooldownReaders.find(r => r.id !== lastRatedReaderId);
    return { reader: other ?? cooldownReaders[0] };
  }

  // Priority 5: Cards and readers done — today's grammar lesson closes out
  // the session.
  if (grammarLesson) {
    return { grammar: grammarLesson };
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

// Combined state for the current study item to ensure atomic updates.
// Exactly one of card (with note/deck) or reader is set at a time.
interface CurrentItemState {
  card: LocalCard | null;
  note: Note | null;
  deck: Deck | null;
  reader?: LocalReader | null;
  grammar?: LocalGrammarLesson | null;
  customLesson?: LocalCustomLesson | null;
}

// Snapshot taken just before a rating is applied so the last review can be
// undone: restores the in-memory session state and the card's IndexedDB row.
interface UndoSnapshot {
  eventId: string;
  card: LocalCard; // full card row BEFORE the review
  note: Note;
  deck: Deck | null;
  queue: LocalCard[]; // in-memory queue BEFORE the review
  recentNoteIds: string[];
  sessionStats: SessionStats;
  noteWasReviewed: boolean; // reviewedNoteIds membership before the review
  prevAgainCount: number; // againCountByNote value before the review
}

export function useStudySession(options: UseStudySessionOptions = {}) {
  const { deckId, bonusNewCards = 0, enabled = true } = options;

  // Local queue state
  const [queue, setQueue] = useState<LocalCard[]>([]);
  // Due graded readers, interleaved with cards. Readers aren't deck-scoped,
  // so they only join "All Decks" sessions (no deckId filter).
  const [readerQueue, setReaderQueue] = useState<LocalReader[]>([]);
  // Pending custom mini lessons (agent-authored), mixed into the card flow.
  // Like readers, they aren't deck-scoped — all-decks sessions only.
  const [customLessonQueue, setCustomLessonQueue] = useState<LocalCustomLesson[]>([]);
  // Card reviews since the last custom lesson — drives the interleave break
  const reviewsSinceLessonRef = useRef(0);
  // Monotonic counter — incremented every time a new card is shown (even same ID)
  const [cardVersion, setCardVersion] = useState(0);
  const [currentCardState, setCurrentCardState] = useState<CurrentItemState>({
    card: null,
    note: null,
    deck: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [recentNoteIds, setRecentNoteIds] = useState<string[]>([]);
  const [hasMoreNewCards, setHasMoreNewCards] = useState(false);
  // True while today's graded reader is being generated in the background —
  // shown as a placeholder count until it lands at the end of the session.
  const [dailyReaderPending, setDailyReaderPending] = useState(false);
  // Today's grammar lesson (offline, precomputed); null once completed today
  const [grammarLesson, setGrammarLesson] = useState<LocalGrammarLesson | null>(null);
  // True while the server is still generating today's lesson exercises —
  // shown as a placeholder count and polled until the lesson lands.
  const [grammarPending, setGrammarPending] = useState(false);

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

  // Single-level undo (like Anki): snapshot of the state before the last rating
  const undoSnapshotRef = useRef<UndoSnapshot | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  // Re-entrancy guard for the async reader rating flow
  const ratingReaderRef = useRef(false);

  // Load initial queue
  const loadQueue = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    try {
      await ensureDailyStatsInitialized();
      const [dueCards, counts, reviewedIds, dueReaders, todaysGrammar, pendingLessons] = await Promise.all([
        getDueCards(deckId, bonusNewCards),
        getQueueCounts(deckId, bonusNewCards),
        getReviewedNoteIds(deckId),
        deckId ? Promise.resolve([]) : getDueReaders(),
        deckId ? Promise.resolve(null) : getTodaysGrammarLesson(),
        deckId ? Promise.resolve([]) : getDueCustomLessons(),
      ]);
      setQueue(dueCards);
      setReaderQueue(dueReaders);
      setGrammarLesson(todaysGrammar);
      setCustomLessonQueue(pendingLessons);
      reviewsSinceLessonRef.current = 0;
      setHasMoreNewCards(counts.hasMoreNew);
      reviewedNoteIdsRef.current = reviewedIds;
      initializedRef.current = true;

      // Make sure today has a graded reader (all-decks sessions only). Runs
      // in the background; if one starts generating, a placeholder count is
      // shown and polling picks it up when it's ready.
      if (!deckId) {
        // Actively refresh the grammar lesson cache too — the background
        // sync may not have run yet (fresh app load), and the first upcoming
        // call is also what kicks off server-side exercise generation.
        if (navigator.onLine) {
          syncGrammarLessons()
            .then(async () => {
              const lesson = await getTodaysGrammarLesson();
              if (lesson) {
                setGrammarLesson(lesson);
                setGrammarPending(false);
              } else {
                setGrammarPending(await grammarGenerationPending());
              }
            })
            .catch(err => console.error('[useStudySession] Grammar lesson refresh failed:', err));

          // Custom mini lessons: pick up anything an agent created since the
          // last sync, then cache media so the lessons work offline.
          syncCustomLessons()
            .then(async () => {
              setCustomLessonQueue(await getDueCustomLessons());
              prefetchCustomLessonMedia().catch(() => {});
            })
            .catch(err => console.error('[useStudySession] Custom lesson refresh failed:', err));
        }

        ensureDailyReader()
          .then(async pending => {
            setDailyReaderPending(pending);
            if (!pending) {
              // ensureDailyReader may have synced a ready-but-not-local
              // reader — refresh the queue so it joins this session.
              const fresh = await getDueReaders();
              setReaderQueue(fresh);
            }
          })
          .catch(err => console.error('[useStudySession] ensureDailyReader failed:', err));
      }
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

  // Find a learning/relearning card in IndexedDB that's due today. Used when
  // the in-memory queue runs dry — learning cards on cooldown are shown
  // immediately rather than making the user wait out the timer.
  const findDelayedLearningCard = useCallback(async (excludeNoteId?: string): Promise<LocalCard | null> => {
    const collection = deckId
      ? db.cards.where('deck_id').equals(deckId)
      : db.cards.toCollection();
    const delayed = await collection
      .filter(c =>
        (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) &&
        (!excludeNoteId || c.note_id !== excludeNoteId)
      )
      .toArray();
    if (delayed.length === 0) return null;

    const studyCutoff = getStudyCutoff();
    const dueToday = delayed.filter(c => !c.due_timestamp || c.due_timestamp <= studyCutoff.ts);
    if (dueToday.length === 0) return null;

    dueToday.sort((a, b) => (a.due_timestamp || 0) - (b.due_timestamp || 0));
    return dueToday[0];
  }, [deckId]);

  // Optional state updates applied atomically with a card/reader transition
  interface QueueUpdates {
    queue?: LocalCard[];
    recentNoteIds?: string[];
    readerQueue?: LocalReader[];
    customLessonQueue?: LocalCustomLesson[];
  }

  const applyQueueUpdates = useCallback((updates?: QueueUpdates) => {
    if (updates?.queue) setQueue(updates.queue);
    if (updates?.recentNoteIds) setRecentNoteIds(updates.recentNoteIds);
    if (updates?.readerQueue) setReaderQueue(updates.readerQueue);
    if (updates?.customLessonQueue) setCustomLessonQueue(updates.customLessonQueue);
  }, []);

  // Load a card's note+deck and show it. Returns false if the note is missing
  // (orphaned card) — the caller should fall back to something else.
  const presentCard = useCallback(async (card: LocalCard, updates?: QueueUpdates): Promise<boolean> => {
    const [note, deck] = await Promise.all([
      db.notes.get(card.note_id),
      db.decks.get(card.deck_id),
    ]);
    if (!note) return false;

    applyQueueUpdates(updates);
    setCardVersion(v => v + 1);
    setCurrentCardState({ card, note, deck: deck || null });
    return true;
  }, [applyQueueUpdates]);

  const presentReader = useCallback((reader: LocalReader, updates?: QueueUpdates) => {
    applyQueueUpdates(updates);
    setCardVersion(v => v + 1);
    setCurrentCardState({ card: null, note: null, deck: null, reader });
  }, [applyQueueUpdates]);

  const presentGrammar = useCallback((grammar: LocalGrammarLesson, updates?: QueueUpdates) => {
    applyQueueUpdates(updates);
    setCardVersion(v => v + 1);
    setCurrentCardState({ card: null, note: null, deck: null, grammar });
  }, [applyQueueUpdates]);

  const presentCustomLesson = useCallback((customLesson: LocalCustomLesson, updates?: QueueUpdates) => {
    applyQueueUpdates(updates);
    // Starting a lesson resets the interleave counter, so the next one waits
    // for another run of card reviews.
    reviewsSinceLessonRef.current = 0;
    setCardVersion(v => v + 1);
    setCurrentCardState({ card: null, note: null, deck: null, customLesson });
  }, [applyQueueUpdates]);

  const presentNothing = useCallback((updates?: QueueUpdates) => {
    applyQueueUpdates(updates);
    setCurrentCardState({ card: null, note: null, deck: null });
  }, [applyQueueUpdates]);

  // Show whatever selectNextItem picked. Returns false only when a card's
  // note is missing (orphaned card) — the caller falls back to something else.
  const presentSelection = useCallback(async (selection: NextStudyItem, updates?: QueueUpdates): Promise<boolean> => {
    if ('reader' in selection) {
      presentReader(selection.reader, updates);
      return true;
    }
    if ('grammar' in selection) {
      presentGrammar(selection.grammar, updates);
      return true;
    }
    if ('customLesson' in selection) {
      presentCustomLesson(selection.customLesson, updates);
      return true;
    }
    return presentCard(selection.card, updates);
  }, [presentReader, presentGrammar, presentCustomLesson, presentCard]);

  // Whether enough card reviews have passed to slot in a custom mini lesson
  const lessonBreakReady = useCallback(
    () => reviewsSinceLessonRef.current >= LESSON_MIX_INTERVAL,
    [],
  );

  // Track a pending background DB write so fallback queries can await it
  const trackWrite = useCallback((write: Promise<unknown>) => {
    const tracked: Promise<void> = write
      .then(() => undefined, () => undefined)
      .then(() => {
        pendingWritesRef.current = pendingWritesRef.current.filter(p => p !== tracked);
      });
    pendingWritesRef.current.push(tracked);
  }, []);

  // Persist a review event (+ optional recording) and kick off a background
  // sync. Shared by every card-rating path. The recording shares the event
  // id — recording upload looks its event up by id.
  const persistReviewEvent = useCallback(async (
    reviewId: string,
    cardId: string,
    rating: Rating,
    reviewedAt: string,
    timeSpentMs?: number,
    userAnswer?: string,
    recordingBlob?: Blob,
  ): Promise<void> => {
    await createLocalReviewEvent({
      id: reviewId,
      card_id: cardId,
      rating,
      time_spent_ms: timeSpentMs || null,
      user_answer: userAnswer || null,
      reviewed_at: reviewedAt,
      _synced: 0,
    });
    if (recordingBlob) {
      await storePendingRecording({
        id: reviewId,
        blob: recordingBlob,
        uploaded: false,
        created_at: reviewedAt,
      });
    }
    if (navigator.onLine) {
      syncService.syncEvents().catch(console.error);
    }
  }, []);

  // A NEW card being introduced counts against the primary (blue) quota, or
  // the secondary (purple) quota if its note already has a reviewed card.
  const countNewCardIntroduced = useCallback(async (card: LocalCard) => {
    if (card.queue !== CardQueue.NEW) return;
    const siblings = await db.cards.where('note_id').equals(card.note_id).toArray();
    const isSecondary = siblings.some(s => s.id !== card.id && s.queue !== CardQueue.NEW);
    await incrementNewCardsStudiedToday(card.deck_id, isSecondary);
  }, []);

  // Select the next item from the queues (async version for fallback cases)
  const selectNextCard = useCallback(async () => {
    const selection = selectNextItem(queue, readerQueue, customLessonQueue, lessonBreakReady(), grammarLesson, recentNoteIds, reviewedNoteIdsRef.current);

    if (selection && await presentSelection(selection)) return;

    // Queues empty — check for delayed learning cards in IndexedDB
    const delayed = await findDelayedLearningCard();
    if (delayed && await presentCard(delayed)) return;

    console.log('[useStudySession] No cards available');
    presentNothing();
  }, [queue, readerQueue, customLessonQueue, lessonBreakReady, grammarLesson, recentNoteIds, presentCard, presentSelection, presentNothing, findDelayedLearningCard]);

  // Select first item when queue loads
  useEffect(() => {
    const nothingShown = !currentCardState.card && !currentCardState.reader && !currentCardState.grammar && !currentCardState.customLesson;
    if (!isLoading && (queue.length > 0 || readerQueue.length > 0 || customLessonQueue.length > 0 || grammarLesson) && nothingShown) {
      selectNextCard();
    }
  }, [isLoading, queue.length, readerQueue.length, customLessonQueue.length, grammarLesson, currentCardState.card, currentCardState.reader, currentCardState.grammar, currentCardState.customLesson, selectNextCard]);

  // While today's grammar exercises are generating server-side, poll until
  // they land, then slot the lesson in at the end of the session.
  useEffect(() => {
    if (!grammarPending || !enabled) return;

    const POLL_MS = 30_000;
    const interval = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        await syncGrammarLessons();
        const lesson = await getTodaysGrammarLesson();
        if (lesson) {
          setGrammarLesson(lesson);
          setGrammarPending(false);
          prefetchGrammarMedia().catch(() => {});
        } else if (!(await grammarGenerationPending())) {
          setGrammarPending(false);
        }
      } catch (err) {
        console.error('[useStudySession] Grammar lesson poll failed:', err);
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [grammarPending, enabled]);

  // While today's reader is generating, poll sync until it lands, then slot
  // it into the session (it shows up at the end, after the cards).
  useEffect(() => {
    if (!dailyReaderPending || !enabled) return;

    const POLL_MS = 20_000;
    const interval = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        await syncReadersFromServer();
        const fresh = await getDueReaders();
        if (fresh.some(r => r.queue === CardQueue.NEW)) {
          setReaderQueue(fresh);
          setDailyReaderPending(false);
          prefetchReaderMedia().catch(() => {});
        }
      } catch (err) {
        console.error('[useStudySession] Daily reader poll failed:', err);
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [dailyReaderPending, enabled]);

  // Submit review mutation
  const reviewMutation = useMutation({
    mutationFn: async ({
      reviewId,
      cardId,
      rating,
      timeSpentMs,
      userAnswer,
      sessionId: _sessionId,
      recordingBlob,
    }: {
      reviewId: string;
      cardId: string;
      rating: Rating;
      timeSpentMs?: number;
      userAnswer?: string;
      sessionId?: string;
      recordingBlob?: Blob;
    }) => {
      const card = await db.cards.get(cardId);
      if (!card) throw new Error('Card not found');

      await countNewCardIntroduced(card);

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
        getCardLastReviewTime(card)
      );

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
        last_reviewed_at: reviewedAt,
        updated_at: reviewedAt,
      });

      await persistReviewEvent(reviewId, cardId, rating, reviewedAt, timeSpentMs, userAnswer, recordingBlob);

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
    const currentNote = currentCardState.note;
    const currentDeck = currentCardState.deck;

    if (!currentCard || !currentNote) return;

    const cardId = currentCard.id;
    const noteId = currentCard.note_id;
    const reviewId = crypto.randomUUID();

    console.log('[useStudySession] Rating card', { cardId, rating });

    // Failing a card is a strong signal you want more of this word. Start its
    // sentence set now (if it hasn't got one) so it's ready when the card
    // comes back — Again reschedules it about a minute out. Fire-and-forget:
    // this must not hold up the transition to the next card.
    if (rating === 0) {
      void ensureSentenceSetForNote(noteId);
    }

    // Snapshot everything the review is about to change, so Undo can restore it
    undoSnapshotRef.current = {
      eventId: reviewId,
      card: { ...currentCard },
      note: currentNote,
      deck: currentDeck,
      queue,
      recentNoteIds,
      sessionStats,
      noteWasReviewed: reviewedNoteIdsRef.current.has(noteId),
      prevAgainCount: againCountByNoteRef.current.get(noteId) || 0,
    };
    setCanUndo(true);

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
      getCardLastReviewTime(currentCard)
    );

    // Build the new queue
    const newQueue = queue.filter(c => c.id !== cardId);

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
        last_reviewed_at: new Date().toISOString(),
      };
      newQueue.push(updatedCard);
    }

    // Update recent notes for variety filtering
    const newRecentNoteIds = [...recentNoteIds.slice(-4), noteId];

    // The rated card is no longer NEW, so its note is now "in circulation" —
    // its remaining NEW siblings count as secondary cards from here on.
    reviewedNoteIdsRef.current.add(noteId);

    const updates = { queue: newQueue, recentNoteIds: newRecentNoteIds };

    // One more review toward the next custom-lesson interleave break
    reviewsSinceLessonRef.current += 1;

    // Select the next item synchronously from the new queues
    const selection = selectNextItem(newQueue, readerQueue, customLessonQueue, lessonBreakReady(), grammarLesson, newRecentNoteIds, reviewedNoteIdsRef.current, cardId);

    let presented = false;
    if (selection) {
      presented = await presentSelection(selection, updates);
    }

    if (presented) {
      // Submit review in background (don't await), tracked so a later rating
      // that needs to query IndexedDB can await it first.
      trackWrite(reviewMutation.mutateAsync({
        reviewId,
        cardId,
        rating,
        timeSpentMs,
        userAnswer,
        recordingBlob,
      }));
      return;
    }

    // Nothing in the queues — fall back to delayed learning cards in
    // IndexedDB. First await pending background writes so the query sees all
    // state, then write this card's new state inline (reviewMutation isn't
    // used on this path), otherwise the query would find this card still in
    // its old LEARNING state.
    if (pendingWritesRef.current.length > 0) {
      console.log('[useStudySession] Awaiting', pendingWritesRef.current.length, 'pending DB writes before fallback query');
      await Promise.all(pendingWritesRef.current);
      pendingWritesRef.current = [];
    }

    await countNewCardIntroduced(currentCard);

    const reviewedAt = new Date().toISOString();
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
      last_reviewed_at: reviewedAt,
      updated_at: reviewedAt,
    });

    // Show a delayed learning card immediately — even if it's the same card
    // just rated (user preference: drill all cards in one sitting without
    // waiting for cooldowns)
    const delayed = await findDelayedLearningCard();
    if (delayed && await presentCard(delayed, updates)) {
      trackWrite(persistReviewEvent(reviewId, cardId, rating, reviewedAt, timeSpentMs, userAnswer, recordingBlob));
      return;
    }

    // No delayed learning cards - session is truly done
    console.log('[useStudySession] No cards available - session complete');
    presentNothing(updates);
    trackWrite(persistReviewEvent(reviewId, cardId, rating, reviewedAt, timeSpentMs, userAnswer, recordingBlob));
  }, [currentCardState, queue, readerQueue, customLessonQueue, lessonBreakReady, grammarLesson, recentNoteIds, sessionStats, reviewMutation, presentCard, presentSelection, presentNothing, trackWrite, persistReviewEvent, countNewCardIntroduced, findDelayedLearningCard]);

  // Rate the current reader and transition to the next item. Reader reviews
  // follow the same FSRS cadence as cards; they aren't undoable yet, so
  // rating one drops any pending card undo snapshot.
  const rateReader = useCallback(async (rating: Rating, timeSpentMs: number) => {
    const reader = currentCardState.reader;
    if (!reader) return;
    // Guard against double-taps while the async review write is in flight
    if (ratingReaderRef.current) return;
    ratingReaderRef.current = true;

    undoSnapshotRef.current = null;
    setCanUndo(false);

    setSessionStats(prev => {
      const isCorrect = rating === 2 || rating === 3; // Good or Easy
      const newCurrentStreak = isCorrect ? prev.currentStreak + 1 : 0;
      return {
        ...prev,
        totalReviews: prev.totalReviews + 1,
        correctCount: prev.correctCount + (isCorrect ? 1 : 0),
        againCount: prev.againCount + (rating === 0 ? 1 : 0),
        currentStreak: newCurrentStreak,
        bestStreak: Math.max(prev.bestStreak, newCurrentStreak),
      };
    });

    try {
      const { newState } = await recordReaderReview(reader.id, rating, timeSpentMs);

      // Reading a story in-session counts as the day's reader activity
      // (streaks) — best effort, offline reviews just skip it.
      if (navigator.onLine) {
        markDailyActivity('reader', reader.id).catch(() => {});
      }

      // Keep the reader in the session while it's still in learning; otherwise
      // FSRS has scheduled it out to a future day.
      const newReaderQueue = readerQueue.filter(r => r.id !== reader.id);
      if (newState.queue === CardQueue.LEARNING || newState.queue === CardQueue.RELEARNING) {
        newReaderQueue.push({ ...reader, ...readerSchedulingFields(newState) });
      }

      if (navigator.onLine) {
        syncService.syncEvents().catch(console.error);
      }

      const updates = { readerQueue: newReaderQueue };
      const selection = selectNextItem(queue, newReaderQueue, customLessonQueue, lessonBreakReady(), grammarLesson, recentNoteIds, reviewedNoteIdsRef.current, undefined, reader.id);
      if (selection && await presentSelection(selection, updates)) return;

      const delayed = await findDelayedLearningCard();
      if (delayed && await presentCard(delayed, updates)) return;

      presentNothing(updates);
    } finally {
      ratingReaderRef.current = false;
    }
  }, [currentCardState, queue, readerQueue, customLessonQueue, lessonBreakReady, grammarLesson, recentNoteIds, presentCard, presentSelection, presentNothing, findDelayedLearningCard]);

  // Complete the current grammar lesson: record the completion event
  // (synced up in the background) and advance — this is the session's last
  // item, so the next selection is usually the All Done screen.
  const completeGrammar = useCallback(async (correct: number, total: number) => {
    const grammar = currentCardState.grammar;
    if (!grammar) return;

    try {
      await completeGrammarLesson(grammar.grammar_point_id, correct, total);
    } catch (err) {
      console.error('[useStudySession] Failed to record grammar completion:', err);
    }
    setGrammarLesson(null);

    if (navigator.onLine) {
      syncService.syncEvents().catch(console.error);
    }

    const selection = selectNextItem(queue, readerQueue, customLessonQueue, lessonBreakReady(), null, recentNoteIds, reviewedNoteIdsRef.current);
    if (selection && await presentSelection(selection)) return;

    const delayed = await findDelayedLearningCard();
    if (delayed && await presentCard(delayed)) return;

    presentNothing();
  }, [currentCardState, queue, readerQueue, customLessonQueue, lessonBreakReady, recentNoteIds, presentCard, presentSelection, presentNothing, findDelayedLearningCard]);

  // Complete the current custom mini lesson: record the rated completion
  // event (synced up in the background) and advance. Like readers, a lesson
  // rated back into learning stays in the session queue with its new
  // scheduling; otherwise FSRS has pushed it out to a future day.
  const completeCustomLessonAction = useCallback(async (correct: number, total: number, rating: Rating) => {
    const lesson = currentCardState.customLesson;
    if (!lesson) return;

    setSessionStats(prev => {
      const isCorrect = rating === 2 || rating === 3; // Good or Easy
      const newCurrentStreak = isCorrect ? prev.currentStreak + 1 : 0;
      return {
        ...prev,
        totalReviews: prev.totalReviews + 1,
        correctCount: prev.correctCount + (isCorrect ? 1 : 0),
        againCount: prev.againCount + (rating === 0 ? 1 : 0),
        currentStreak: newCurrentStreak,
        bestStreak: Math.max(prev.bestStreak, newCurrentStreak),
      };
    });

    let newLessonQueue = customLessonQueue.filter(l => l.id !== lesson.id);
    try {
      const { newState } = await recordCustomLessonCompletion(lesson.id, correct, total, rating);
      if (newState.queue === CardQueue.LEARNING || newState.queue === CardQueue.RELEARNING) {
        newLessonQueue = [...newLessonQueue, { ...lesson, ...lessonSchedulingFields(newState) }];
      }
    } catch (err) {
      console.error('[useStudySession] Failed to record custom lesson completion:', err);
    }
    if (navigator.onLine) {
      syncCustomLessons().catch(() => {});
    }

    const updates = { customLessonQueue: newLessonQueue };
    const selection = selectNextItem(queue, readerQueue, newLessonQueue, false, grammarLesson, recentNoteIds, reviewedNoteIdsRef.current);
    if (selection && await presentSelection(selection, updates)) return;

    const delayed = await findDelayedLearningCard();
    if (delayed && await presentCard(delayed, updates)) return;

    presentNothing(updates);
  }, [currentCardState, queue, readerQueue, customLessonQueue, grammarLesson, recentNoteIds, presentCard, presentSelection, presentNothing, findDelayedLearningCard]);

  // Undo the last rating (single-level, like Anki). Deletes the review event
  // locally and queues its deletion on the server, restores the card's
  // previous scheduling state, and brings the card back as the current card.
  const undoLastReview = useCallback(async () => {
    const snap = undoSnapshotRef.current;
    if (!snap) return;
    undoSnapshotRef.current = null;
    setCanUndo(false);

    console.log('[useStudySession] Undoing last review', { cardId: snap.card.id, eventId: snap.eventId });

    // Wait for the review's background writes to land before reverting them
    if (pendingWritesRef.current.length > 0) {
      await Promise.all(pendingWritesRef.current);
      pendingWritesRef.current = [];
    }

    const cardId = snap.card.id;
    const noteId = snap.card.note_id;

    // The daily new-card counter was incremented if the undone card was NEW.
    // Recompute the same primary/secondary classification — sibling queues
    // are unchanged by the review, so this matches what was counted.
    if (snap.card.queue === CardQueue.NEW) {
      const siblings = await db.cards.where('note_id').equals(noteId).toArray();
      const isSecondary = siblings.some(s => s.id !== cardId && s.queue !== CardQueue.NEW);
      await decrementNewCardsStudiedToday(snap.card.deck_id, isSecondary);
    }

    // Remove the event and any recording tied to it, then restore the card
    // row. A checkpoint may have been written at this review — drop it (it's
    // a pure cache, recreated on the next review).
    await db.reviewEvents.delete(snap.eventId);
    await db.pendingRecordings.delete(snap.eventId);
    await deleteCardCheckpoint(cardId);
    await db.cards.put(snap.card);

    // The event may already be on the server (sync runs right after rating):
    // queue a server-side deletion. Sync pushes it, and event downloads skip
    // the id until the server confirms, so the review can't be resurrected.
    await addPendingReviewDeletion(snap.eventId);
    if (navigator.onLine) {
      syncService.syncEvents().catch(console.error);
    }

    // Restore in-memory session state
    if (!snap.noteWasReviewed) {
      reviewedNoteIdsRef.current.delete(noteId);
    }
    if (snap.prevAgainCount > 0) {
      againCountByNoteRef.current.set(noteId, snap.prevAgainCount);
    } else {
      againCountByNoteRef.current.delete(noteId);
    }
    setSessionStats(snap.sessionStats);
    setQueue(snap.queue);
    setRecentNoteIds(snap.recentNoteIds);
    setCardVersion(v => v + 1);
    setCurrentCardState({ card: snap.card, note: snap.note, deck: snap.deck });
  }, []);

  // Derive counts directly from the in-memory queues so the header updates in
  // the same render as the card transition (no DB round-trip). Due readers
  // count in the bucket matching their queue state.
  const counts: QueueCounts = useMemo(() => {
    let n = 0, s = 0, l = 0, r = 0;
    for (const c of queue) {
      if (c.queue === CardQueue.NEW) {
        if (reviewedNoteIdsRef.current.has(c.note_id)) s++;
        else n++;
      }
      else if (c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING) l++;
      else if (c.queue === CardQueue.REVIEW) r++;
    }
    for (const reader of readerQueue) {
      if (reader.queue === CardQueue.NEW) n++;
      else if (reader.queue === CardQueue.LEARNING || reader.queue === CardQueue.RELEARNING) l++;
      else r++;
    }
    // Placeholder for today's still-generating reader — it will arrive as a
    // NEW (blue) item, so count it there while it's being written.
    if (dailyReaderPending) n++;
    // Custom mini lessons count in the bucket matching their FSRS state.
    for (const lesson of customLessonQueue) {
      const q = lesson.queue ?? CardQueue.NEW;
      if (q === CardQueue.NEW) n++;
      else if (q === CardQueue.LEARNING || q === CardQueue.RELEARNING) l++;
      else r++;
    }
    // Today's grammar lesson: blue if it's a brand-new pattern, green if
    // it's a repeat round of one still being learned. A lesson still being
    // generated counts as a blue placeholder.
    if (grammarLesson) {
      if (grammarLesson.status === 'new') n++;
      else r++;
    } else if (grammarPending) {
      n++;
    }
    return { new: n, secondaryNew: s, learning: l, review: r };
  }, [queue, readerQueue, customLessonQueue, dailyReaderPending, grammarLesson, grammarPending]);
  const { card: currentCard, note: currentNote, deck: currentDeck } = currentCardState;
  const currentReader = currentCardState.reader ?? null;
  const currentGrammar = currentCardState.grammar ?? null;
  const currentCustomLesson = currentCardState.customLesson ?? null;

  // Whether the current card is a "secondary" new card (purple): NEW, but its
  // note already has a reviewed card. Used to highlight the right header count.
  const currentCardIsSecondaryNew =
    !!currentCard &&
    currentCard.queue === CardQueue.NEW &&
    reviewedNoteIdsRef.current.has(currentCard.note_id);

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

  const customLessonIntervalPreviews: Record<Rating, IntervalPreview> | null =
    currentCustomLesson ? getCustomLessonIntervalPreviews(currentCustomLesson) : null;

  const readerIntervalPreviews: Record<Rating, IntervalPreview> | null =
    currentReader ? getReaderIntervalPreviews(currentReader) : null;

  // Remove a deleted note's cards from the session and advance to the next card.
  // Call this after deleting a note from IndexedDB so the in-memory queue stays
  // consistent and we don't try to display a card whose note no longer exists.
  const removeNoteFromSession = useCallback(async (noteId: string) => {
    // The deleted note's cards can't be restored — drop any undo for them
    if (undoSnapshotRef.current?.card.note_id === noteId) {
      undoSnapshotRef.current = null;
      setCanUndo(false);
    }

    const newQueue = queue.filter(c => c.note_id !== noteId);
    const newRecentNoteIds = recentNoteIds.filter(id => id !== noteId);
    const updates = { queue: newQueue, recentNoteIds: newRecentNoteIds };

    const selection = selectNextItem(newQueue, readerQueue, customLessonQueue, lessonBreakReady(), grammarLesson, newRecentNoteIds, reviewedNoteIdsRef.current);
    if (selection && await presentSelection(selection, updates)) return;

    // Nothing in the queues — check for delayed learning cards in IndexedDB
    const delayed = await findDelayedLearningCard(noteId);
    if (delayed && await presentCard(delayed, updates)) return;

    // Session is complete
    presentNothing(updates);
  }, [queue, readerQueue, customLessonQueue, lessonBreakReady, grammarLesson, recentNoteIds, presentCard, presentSelection, presentNothing, findDelayedLearningCard]);

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
    currentReader,
    currentGrammar,
    currentCustomLesson,
    currentCardIsSecondaryNew,
    cardVersion,
    counts,
    dailyReaderPending,
    grammarPending,
    intervalPreviews,
    readerIntervalPreviews,
    customLessonIntervalPreviews,
    hasMoreNewCards,
    isRating: reviewMutation.isPending,
    sessionStats,
    canUndo,

    // Actions
    rateCard,
    rateReader,
    completeGrammar,
    completeCustomLesson: completeCustomLessonAction,
    undoLastReview,
    reloadQueue,
    selectNextCard,
    removeNoteFromSession,
    updateCurrentNote,
  };
}
