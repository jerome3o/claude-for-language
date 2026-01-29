import Dexie, { Table } from 'dexie';
import { CardType, CardQueue, Rating } from '../types';

// ============ Review Event Types ============

export interface LocalReviewEvent {
  id: string;
  card_id: string;
  rating: Rating;
  time_spent_ms: number | null;
  user_answer: string | null;
  reviewed_at: string;
  // Sync metadata (0 = unsynced, 1 = synced)
  _synced: number;
  _created_at: string;
}

export interface LocalCardCheckpoint {
  card_id: string;
  checkpoint_at: string;
  event_count: number;
  queue: CardQueue;
  // FSRS fields
  stability: number;
  difficulty: number;
  lapses: number;
  // Legacy fields (kept for compatibility)
  learning_step: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review_at: string | null;
  due_timestamp: number | null;
}

export interface PendingRecording {
  id: string; // Same as review event id
  blob: Blob;
  uploaded: boolean;
  created_at: string;
}

export interface EventSyncMeta {
  id: string;
  last_event_synced_at: string | null;
  last_sync_at: string | null;
}

// ============ Core Types ============

export interface LocalDeck {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  new_cards_per_day: number;
  // FSRS settings
  request_retention: number;    // Target retention (0.7-0.97), default 0.9
  fsrs_weights: string | null;  // JSON array of 21 weights, null = use defaults
  // Legacy SM-2 settings (kept for compatibility)
  learning_steps: string;
  graduating_interval: number;
  easy_interval: number;
  relearning_steps: string;
  starting_ease: number;
  minimum_ease: number;
  maximum_ease: number;
  interval_modifier: number;
  hard_multiplier: number;
  easy_bonus: number;
  created_at: string;
  updated_at: string;
  _synced_at: number | null;
}

export interface LocalNote {
  id: string;
  deck_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  audio_url: string | null;
  audio_provider: 'minimax' | 'gtts' | null;
  fun_facts: string | null;
  context: string | null;
  created_at: string;
  updated_at: string;
  _synced_at: number | null;
}

export interface LocalCard {
  id: string;
  note_id: string;
  deck_id: string; // Denormalized for efficient queries
  card_type: CardType;
  queue: CardQueue;
  // FSRS fields
  stability: number;
  difficulty: number;
  lapses: number;
  // Legacy SM-2 fields (kept for compatibility)
  learning_step: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review_at: string | null;
  due_timestamp: number | null;
  created_at: string;
  updated_at: string;
  _synced_at: number | null;
}

export interface CachedAudio {
  key: string; // audio_url
  blob: Blob;
  cached_at: number;
}

export interface SyncMeta {
  id: string;
  last_full_sync: number | null;
  last_incremental_sync: number | null;
  user_id: string | null;
}

export interface LocalStudySession {
  id: string;
  deck_id: string | null;
  started_at: string;
  completed_at: string | null;
  cards_studied: number;
  _synced: number;
}

// Daily stats for tracking new cards studied (incremental counter)
export interface DailyStats {
  id: string; // Composite key: `${date}:${deckId}` e.g. "2026-01-22:deck-abc"
  date: string; // YYYY-MM-DD
  deck_id: string;
  new_cards_studied: number;
}

// Dexie database class
export class ChineseLearningDB extends Dexie {
  // Core tables
  decks!: Table<LocalDeck, string>;
  notes!: Table<LocalNote, string>;
  cards!: Table<LocalCard, string>;
  cachedAudio!: Table<CachedAudio, string>;
  syncMeta!: Table<SyncMeta, string>;
  studySessions!: Table<LocalStudySession, string>;

  // Event-sourced tables
  reviewEvents!: Table<LocalReviewEvent, string>;
  cardCheckpoints!: Table<LocalCardCheckpoint, string>;
  pendingRecordings!: Table<PendingRecording, string>;
  eventSyncMeta!: Table<EventSyncMeta, string>;

  // Performance optimization tables
  dailyStats!: Table<DailyStats, string>;

  constructor() {
    super('ChineseLearningDB');

    // Version 1: Original schema
    this.version(1).stores({
      decks: 'id, user_id, updated_at, _synced_at',
      notes: 'id, deck_id, updated_at, _synced_at',
      cards: 'id, note_id, deck_id, queue, next_review_at, due_timestamp, [deck_id+queue], [deck_id+next_review_at]',
      pendingReviews: 'id, card_id, _pending, reviewed_at, [_pending+reviewed_at]',
      cachedAudio: 'key, cached_at',
      syncMeta: 'id',
      studySessions: 'id, deck_id, started_at, _synced',
    });

    // Version 2: Add event-sourced tables
    this.version(2).stores({
      decks: 'id, user_id, updated_at, _synced_at',
      notes: 'id, deck_id, updated_at, _synced_at',
      cards: 'id, note_id, deck_id, queue, next_review_at, due_timestamp, [deck_id+queue], [deck_id+next_review_at]',
      pendingReviews: 'id, card_id, _pending, reviewed_at, [_pending+reviewed_at]',
      cachedAudio: 'key, cached_at',
      syncMeta: 'id',
      studySessions: 'id, deck_id, started_at, _synced',
      reviewEvents: 'id, card_id, reviewed_at, _synced, [card_id+reviewed_at], [_synced+_created_at]',
      cardCheckpoints: 'card_id',
      pendingRecordings: 'id, uploaded',
      eventSyncMeta: 'id',
    });

    // Version 3: Remove legacy pendingReviews table
    this.version(3).stores({
      decks: 'id, user_id, updated_at, _synced_at',
      notes: 'id, deck_id, updated_at, _synced_at',
      cards: 'id, note_id, deck_id, queue, next_review_at, due_timestamp, [deck_id+queue], [deck_id+next_review_at]',
      pendingReviews: null, // Delete this table
      cachedAudio: 'key, cached_at',
      syncMeta: 'id',
      studySessions: 'id, deck_id, started_at, _synced',
      reviewEvents: 'id, card_id, reviewed_at, _synced, [card_id+reviewed_at], [_synced+_created_at]',
      cardCheckpoints: 'card_id',
      pendingRecordings: 'id, uploaded',
      eventSyncMeta: 'id',
    });

    // Version 4: Add dailyStats table for fast new card counting
    this.version(4).stores({
      decks: 'id, user_id, updated_at, _synced_at',
      notes: 'id, deck_id, updated_at, _synced_at',
      cards: 'id, note_id, deck_id, queue, next_review_at, due_timestamp, [deck_id+queue], [deck_id+next_review_at]',
      cachedAudio: 'key, cached_at',
      syncMeta: 'id',
      studySessions: 'id, deck_id, started_at, _synced',
      reviewEvents: 'id, card_id, reviewed_at, _synced, [card_id+reviewed_at], [_synced+_created_at]',
      cardCheckpoints: 'card_id',
      pendingRecordings: 'id, uploaded',
      eventSyncMeta: 'id',
      dailyStats: 'id, date, deck_id, [date+deck_id]',
    });

    // Version 5: Add FSRS fields to cards and decks
    // Cards get: stability, difficulty, lapses
    // Decks get: request_retention, fsrs_weights
    this.version(5).stores({
      decks: 'id, user_id, updated_at, _synced_at',
      notes: 'id, deck_id, updated_at, _synced_at',
      cards: 'id, note_id, deck_id, queue, next_review_at, due_timestamp, [deck_id+queue], [deck_id+next_review_at]',
      cachedAudio: 'key, cached_at',
      syncMeta: 'id',
      studySessions: 'id, deck_id, started_at, _synced',
      reviewEvents: 'id, card_id, reviewed_at, _synced, [card_id+reviewed_at], [_synced+_created_at]',
      cardCheckpoints: 'card_id',
      pendingRecordings: 'id, uploaded',
      eventSyncMeta: 'id',
      dailyStats: 'id, date, deck_id, [date+deck_id]',
    }).upgrade(async tx => {
      // Migrate cards: add FSRS defaults
      await tx.table('cards').toCollection().modify(card => {
        // Set stability based on current interval (rough approximation)
        card.stability = card.interval > 0 ? card.interval : 0;
        // Set default difficulty (5 = middle of 1-10 scale)
        card.difficulty = card.difficulty || 5;
        // Initialize lapses to 0
        card.lapses = card.lapses || 0;
      });

      // Migrate decks: add FSRS defaults
      await tx.table('decks').toCollection().modify(deck => {
        deck.request_retention = deck.request_retention || 0.9;
        deck.fsrs_weights = deck.fsrs_weights || null;
      });

      // Migrate checkpoints: add FSRS defaults
      await tx.table('cardCheckpoints').toCollection().modify(checkpoint => {
        checkpoint.stability = checkpoint.stability || checkpoint.interval || 0;
        checkpoint.difficulty = checkpoint.difficulty || 5;
        checkpoint.lapses = checkpoint.lapses || 0;
      });

      console.log('[DB] Migrated to version 5 (FSRS)');
    });
  }
}

// Singleton database instance
export const db = new ChineseLearningDB();

// ============ Deck/Note/Card Helpers ============

export async function getDeckById(deckId: string): Promise<LocalDeck | undefined> {
  return db.decks.get(deckId);
}

export async function getAllDecks(): Promise<LocalDeck[]> {
  return db.decks.toArray();
}

export async function getNotesByDeckId(deckId: string): Promise<LocalNote[]> {
  return db.notes.where('deck_id').equals(deckId).toArray();
}

export async function getCardsByNoteId(noteId: string): Promise<LocalCard[]> {
  return db.cards.where('note_id').equals(noteId).toArray();
}

export async function getCardsByDeckId(deckId: string): Promise<LocalCard[]> {
  return db.cards.where('deck_id').equals(deckId).toArray();
}

// ============ Daily Limit Tracking ============

/**
 * Get the daily stats ID for a given date and deck.
 */
function getDailyStatsId(date: string, deckId: string): string {
  return `${date}:${deckId}`;
}

/**
 * Get the current date string in YYYY-MM-DD format.
 */
function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * SLOW: Compute new cards studied today by scanning review events.
 * This is O(n) where n = cards reviewed today. Used as fallback when counter not cached.
 * This is READ-ONLY and safe to call from useLiveQuery contexts.
 */
async function _computeNewCardsStudiedTodaySlow(deckId: string): Promise<number> {
  const today = getTodayString();

  // Get all review events from today for this deck's cards
  const todayEvents = await db.reviewEvents
    .filter(e => e.reviewed_at.startsWith(today))
    .toArray();

  if (todayEvents.length === 0) return 0;

  // Group by card_id and find first review of each card
  const cardFirstReview = new Map<string, LocalReviewEvent>();
  for (const event of todayEvents) {
    const existing = cardFirstReview.get(event.card_id);
    if (!existing || event.reviewed_at < existing.reviewed_at) {
      cardFirstReview.set(event.card_id, event);
    }
  }

  // For each card, check if it was NEW before today's first review
  // A card was NEW if it had no reviews before today
  let count = 0;

  for (const [cardId] of cardFirstReview) {
    // Check if card had any reviews before today
    const priorReviews = await db.reviewEvents
      .where('card_id')
      .equals(cardId)
      .filter(e => !e.reviewed_at.startsWith(today))
      .count();

    if (priorReviews === 0) {
      // This was a NEW card - check deck filter
      const card = await db.cards.get(cardId);
      if (card && card.deck_id === deckId) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Get new cards studied today - READ-ONLY version safe for useLiveQuery.
 * Uses cached counter if available, falls back to slow computation.
 * Does NOT write to the database.
 */
async function _getNewCardsStudiedTodayReadOnly(deckId: string): Promise<number> {
  const today = getTodayString();
  const id = getDailyStatsId(today, deckId);

  const existing = await db.dailyStats.get(id);
  if (existing) {
    return existing.new_cards_studied;
  }

  // No cached counter - fall back to slow computation (but don't cache here)
  // Caching will happen when incrementNewCardsStudiedToday is called
  return _computeNewCardsStudiedTodaySlow(deckId);
}

/**
 * Get new cards studied today.
 * READ-ONLY - safe to call from useLiveQuery contexts.
 */
export async function getNewCardsStudiedToday(deckId?: string): Promise<number> {
  if (!deckId) {
    // "All Decks" mode - sum up all decks
    const allDecks = await db.decks.toArray();
    let total = 0;
    for (const deck of allDecks) {
      total += await _getNewCardsStudiedTodayReadOnly(deck.id);
    }
    return total;
  }

  return _getNewCardsStudiedTodayReadOnly(deckId);
}

/**
 * Increment the new cards studied counter for a deck.
 * Called when a NEW card is reviewed for the first time.
 * This WRITES to the database - only call outside of useLiveQuery contexts.
 */
export async function incrementNewCardsStudiedToday(deckId: string): Promise<void> {
  const today = getTodayString();
  const id = getDailyStatsId(today, deckId);

  const existing = await db.dailyStats.get(id);
  if (existing) {
    // Counter exists - increment it
    await db.dailyStats.update(id, {
      new_cards_studied: existing.new_cards_studied + 1,
    });
  } else {
    // Counter doesn't exist - compute current count and add 1
    const currentCount = await _computeNewCardsStudiedTodaySlow(deckId);
    await db.dailyStats.put({
      id,
      date: today,
      deck_id: deckId,
      new_cards_studied: currentCount + 1,
    });
    console.log(`[dailyStats] Initialized counter for deck ${deckId} at ${currentCount + 1}`);
  }

  console.log(`[dailyStats] Incremented counter for deck ${deckId}`);
}

/**
 * Clean up old daily stats (older than 7 days).
 * Can be called periodically to prevent unbounded growth.
 */
export async function cleanupOldDailyStats(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const oldStats = await db.dailyStats
    .filter(stat => stat.date < cutoffStr)
    .toArray();

  if (oldStats.length > 0) {
    await db.dailyStats.bulkDelete(oldStats.map(s => s.id));
    console.log(`[dailyStats] Cleaned up ${oldStats.length} old entries`);
  }
}

// ============ Due Cards ============

/**
 * Get cards that are due for study.
 *
 * @param deckId - Optional deck ID to filter by
 * @param bonusNewCards - Number of extra new cards to allow beyond the daily limit (default 0)
 *                        Pass Infinity to ignore the limit entirely
 */
export async function getDueCards(deckId?: string, bonusNewCards = 0): Promise<LocalCard[]> {
  const now = Date.now();
  // Get end of today (midnight tonight) for review cards
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const endOfTodayIso = today.toISOString();

  let cards: LocalCard[];
  if (deckId) {
    cards = await db.cards.where('deck_id').equals(deckId).toArray();
  } else {
    cards = await db.cards.toArray();
  }

  // Filter for due cards
  const dueCards: LocalCard[] = [];

  if (deckId) {
    // Single deck mode - use that deck's limit
    let newCardsPerDay = 30; // default
    const deck = await db.decks.get(deckId);
    if (deck) {
      newCardsPerDay = deck.new_cards_per_day;
    }
    const newCardsStudiedToday = await getNewCardsStudiedToday(deckId);
    // Apply bonus to the effective limit
    const effectiveLimit = newCardsPerDay + bonusNewCards;
    const remainingNewCards = Math.max(0, effectiveLimit - newCardsStudiedToday);
    let newCardCount = 0;

    for (const card of cards) {
      if (card.queue === CardQueue.NEW) {
        if (newCardCount < remainingNewCards) {
          dueCards.push(card);
          newCardCount++;
        }
      } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
        if (!card.due_timestamp || card.due_timestamp <= now) {
          dueCards.push(card);
        }
      } else if (card.queue === CardQueue.REVIEW) {
        if (!card.next_review_at || card.next_review_at <= endOfTodayIso) {
          dueCards.push(card);
        }
      }
    }
  } else {
    // All Decks mode - respect per-deck new card limits
    const allDecks = await db.decks.toArray();

    // Build a map of deck_id -> remaining new cards for that deck
    const deckLimits = new Map<string, number>();
    const deckNewCounts = new Map<string, number>();

    for (const deck of allDecks) {
      const studiedToday = await getNewCardsStudiedToday(deck.id);
      // Apply bonus proportionally across decks (or to total if not specified)
      const effectiveLimit = deck.new_cards_per_day + bonusNewCards;
      const remaining = Math.max(0, effectiveLimit - studiedToday);
      deckLimits.set(deck.id, remaining);
      deckNewCounts.set(deck.id, 0);
    }

    for (const card of cards) {
      if (card.queue === CardQueue.NEW) {
        const deckRemaining = deckLimits.get(card.deck_id) || 0;
        const deckCurrentNew = deckNewCounts.get(card.deck_id) || 0;
        if (deckCurrentNew < deckRemaining) {
          dueCards.push(card);
          deckNewCounts.set(card.deck_id, deckCurrentNew + 1);
        }
      } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
        if (!card.due_timestamp || card.due_timestamp <= now) {
          dueCards.push(card);
        }
      } else if (card.queue === CardQueue.REVIEW) {
        if (!card.next_review_at || card.next_review_at <= endOfTodayIso) {
          dueCards.push(card);
        }
      }
    }
  }

  return dueCards;
}

// ============ Sync Metadata ============

export async function getSyncMeta(): Promise<SyncMeta | undefined> {
  return db.syncMeta.get('sync_state');
}

export async function updateSyncMeta(meta: Partial<SyncMeta>): Promise<void> {
  await db.syncMeta.put({ id: 'sync_state', ...meta } as SyncMeta);
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.syncMeta, db.studySessions, db.reviewEvents, db.cardCheckpoints, db.eventSyncMeta], async () => {
    await db.decks.clear();
    await db.notes.clear();
    await db.cards.clear();
    await db.syncMeta.clear();
    await db.studySessions.clear();
    await db.reviewEvents.clear();
    await db.cardCheckpoints.clear();
    await db.eventSyncMeta.clear();
  });
}

// ============ Queue Counts ============

/**
 * Get queue counts for the current study session.
 *
 * Unlike getDueCards (which only returns immediately available cards),
 * this includes ALL learning/relearning cards regardless of their delay.
 * This matches Anki behavior where failing a card increments the red count
 * immediately, even though the card won't be shown again for a few minutes.
 *
 * When all counts hit zero, the user is done studying for the day.
 *
 * @param deckId - Optional deck ID to filter by
 * @param bonusNewCards - Number of extra new cards to allow beyond the daily limit (default 0)
 *                        Pass Infinity to ignore the limit entirely
 */
export async function getQueueCounts(deckId?: string, bonusNewCards = 0): Promise<{ new: number; learning: number; review: number }> {
  // Get end of today for review cards
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const endOfTodayIso = today.toISOString();

  let cards: LocalCard[];
  if (deckId) {
    cards = await db.cards.where('deck_id').equals(deckId).toArray();
  } else {
    cards = await db.cards.toArray();
  }

  let newCount = 0;
  let learningCount = 0;
  let reviewCount = 0;

  if (deckId) {
    // Single deck mode - use that deck's limit
    let newCardsPerDay = 30;
    const deck = await db.decks.get(deckId);
    if (deck) {
      newCardsPerDay = deck.new_cards_per_day;
    }
    const newCardsStudiedToday = await getNewCardsStudiedToday(deckId);
    const effectiveLimit = newCardsPerDay + bonusNewCards;
    const remainingNewCards = Math.max(0, effectiveLimit - newCardsStudiedToday);

    for (const card of cards) {
      if (card.queue === CardQueue.NEW) {
        if (newCount < remainingNewCards) {
          newCount++;
        }
      } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
        learningCount++;
      } else if (card.queue === CardQueue.REVIEW) {
        if (!card.next_review_at || card.next_review_at <= endOfTodayIso) {
          reviewCount++;
        }
      }
    }
  } else {
    // All Decks mode - sum up per-deck limits
    const allDecks = await db.decks.toArray();

    // Build a map of deck_id -> remaining new cards for that deck
    const deckLimits = new Map<string, number>();
    const deckNewCounts = new Map<string, number>();

    for (const deck of allDecks) {
      const studiedToday = await getNewCardsStudiedToday(deck.id);
      const effectiveLimit = deck.new_cards_per_day + bonusNewCards;
      const remaining = Math.max(0, effectiveLimit - studiedToday);
      deckLimits.set(deck.id, remaining);
      deckNewCounts.set(deck.id, 0);
    }

    for (const card of cards) {
      if (card.queue === CardQueue.NEW) {
        const deckRemaining = deckLimits.get(card.deck_id) || 0;
        const deckCurrentNew = deckNewCounts.get(card.deck_id) || 0;
        if (deckCurrentNew < deckRemaining) {
          newCount++;
          deckNewCounts.set(card.deck_id, deckCurrentNew + 1);
        }
      } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
        learningCount++;
      } else if (card.queue === CardQueue.REVIEW) {
        if (!card.next_review_at || card.next_review_at <= endOfTodayIso) {
          reviewCount++;
        }
      }
    }
  }

  return {
    new: newCount,
    learning: learningCount,
    review: reviewCount,
  };
}

export async function hasMoreNewCards(deckId?: string, currentBonus = 0): Promise<boolean> {
  const limitedCounts = await getQueueCounts(deckId, currentBonus);
  const unlimitedCounts = await getQueueCounts(deckId, Infinity);
  const hasMore = unlimitedCounts.new > limitedCounts.new;
  console.log(`[hasMoreNewCards] deckId: ${deckId}, currentBonus: ${currentBonus}, limitedNew: ${limitedCounts.new}, unlimitedNew: ${unlimitedCounts.new}, hasMore: ${hasMore}`);
  return hasMore;
}

// ============ Database Stats ============

export async function getDatabaseStats(): Promise<{
  decks: number;
  notes: number;
  cards: number;
  reviewEvents: number;
  unsyncedEvents: number;
}> {
  const [decks, notes, cards, reviewEvents, unsyncedEvents] = await Promise.all([
    db.decks.count(),
    db.notes.count(),
    db.cards.count(),
    db.reviewEvents.count(),
    db.reviewEvents.where('_synced').equals(0).count(),
  ]);

  return { decks, notes, cards, reviewEvents, unsyncedEvents };
}

// ============ Review Event Functions ============

export async function createLocalReviewEvent(event: Omit<LocalReviewEvent, '_created_at'>): Promise<void> {
  await db.reviewEvents.put({
    ...event,
    _created_at: new Date().toISOString(),
  });
}

export async function getCardReviewEvents(cardId: string): Promise<LocalReviewEvent[]> {
  return db.reviewEvents
    .where('card_id')
    .equals(cardId)
    .sortBy('reviewed_at');
}

export async function getUnsyncedReviewEvents(limit = 100): Promise<LocalReviewEvent[]> {
  return db.reviewEvents
    .where('_synced')
    .equals(0)
    .limit(limit)
    .toArray();
}

export async function markReviewEventsSynced(eventIds: string[]): Promise<void> {
  await db.reviewEvents
    .where('id')
    .anyOf(eventIds)
    .modify({ _synced: 1 });
}

// ============ Checkpoint Functions ============

export async function getCardCheckpoint(cardId: string): Promise<LocalCardCheckpoint | undefined> {
  return db.cardCheckpoints.get(cardId);
}

export async function upsertCardCheckpoint(checkpoint: LocalCardCheckpoint): Promise<void> {
  await db.cardCheckpoints.put(checkpoint);
}

// ============ Event Sync Metadata ============

export async function getEventSyncMeta(): Promise<EventSyncMeta | undefined> {
  return db.eventSyncMeta.get('event_sync_state');
}

export async function updateEventSyncMeta(lastEventSyncedAt: string): Promise<void> {
  await db.eventSyncMeta.put({
    id: 'event_sync_state',
    last_event_synced_at: lastEventSyncedAt,
    last_sync_at: new Date().toISOString(),
  });
}

// ============ Recording Functions ============

export async function storePendingRecording(recording: PendingRecording): Promise<void> {
  await db.pendingRecordings.put(recording);
}

export async function getPendingRecordings(): Promise<PendingRecording[]> {
  return db.pendingRecordings.where('uploaded').equals(0).toArray();
}

export async function markRecordingUploaded(id: string): Promise<void> {
  await db.pendingRecordings.update(id, { uploaded: true });
}

export async function cleanupUploadedRecordings(): Promise<number> {
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const cutoffDate = oneDayAgo.toISOString();

  const oldRecordings = await db.pendingRecordings
    .filter(r => r.uploaded && r.created_at < cutoffDate)
    .toArray();

  if (oldRecordings.length > 0) {
    await db.pendingRecordings.bulkDelete(oldRecordings.map(r => r.id));
  }

  return oldRecordings.length;
}
