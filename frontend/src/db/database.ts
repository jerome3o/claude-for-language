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
  // Sync metadata
  _synced: boolean;
  _created_at: string;
}

export interface LocalCardCheckpoint {
  card_id: string;
  checkpoint_at: string;
  event_count: number;
  queue: CardQueue;
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
  fun_facts: string | null;
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
  _synced: boolean;
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
 * Count new cards studied today (for daily limit enforcement).
 * Uses reviewEvents to find cards that were NEW when first reviewed today.
 */
export async function getNewCardsStudiedToday(deckId?: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Get all review events from today
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
  const uniqueNewCards = new Set<string>();

  for (const [cardId] of cardFirstReview) {
    // Check if card had any reviews before today
    const priorReviews = await db.reviewEvents
      .where('card_id')
      .equals(cardId)
      .filter(e => !e.reviewed_at.startsWith(today))
      .count();

    if (priorReviews === 0) {
      // This was a NEW card - check deck filter
      if (deckId) {
        const card = await db.cards.get(cardId);
        if (card && card.deck_id === deckId) {
          uniqueNewCards.add(cardId);
        }
      } else {
        uniqueNewCards.add(cardId);
      }
    }
  }

  return uniqueNewCards.size;
}

// ============ Due Cards ============

export async function getDueCards(deckId?: string, ignoreDailyLimit = false): Promise<LocalCard[]> {
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

  // Get deck settings for new card limit
  let newCardsPerDay = 30; // default
  if (deckId) {
    const deck = await db.decks.get(deckId);
    if (deck) {
      newCardsPerDay = deck.new_cards_per_day;
    }
  }

  // Get new cards studied today
  const newCardsStudiedToday = await getNewCardsStudiedToday(deckId);
  const remainingNewCards = Math.max(0, newCardsPerDay - newCardsStudiedToday);

  // Filter for due cards
  const dueCards: LocalCard[] = [];
  let newCardCount = 0;

  for (const card of cards) {
    if (card.queue === CardQueue.NEW) {
      // Apply daily limit for new cards
      if (ignoreDailyLimit || newCardCount < remainingNewCards) {
        dueCards.push(card);
        newCardCount++;
      }
    } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      if (!card.due_timestamp || card.due_timestamp <= now) {
        dueCards.push(card);
      }
    } else if (card.queue === CardQueue.REVIEW) {
      // Include all cards due by end of today
      if (!card.next_review_at || card.next_review_at <= endOfTodayIso) {
        dueCards.push(card);
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
 */
export async function getQueueCounts(deckId?: string, ignoreDailyLimit = false): Promise<{ new: number; learning: number; review: number }> {
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

  // Get deck settings for new card limit
  let newCardsPerDay = 30;
  if (deckId) {
    const deck = await db.decks.get(deckId);
    if (deck) {
      newCardsPerDay = deck.new_cards_per_day;
    }
  }

  // Get new cards studied today
  const newCardsStudiedToday = await getNewCardsStudiedToday(deckId);
  const remainingNewCards = Math.max(0, newCardsPerDay - newCardsStudiedToday);

  let newCount = 0;
  let learningCount = 0;
  let reviewCount = 0;

  for (const card of cards) {
    if (card.queue === CardQueue.NEW) {
      // Apply daily limit for new cards
      if (ignoreDailyLimit || newCount < remainingNewCards) {
        newCount++;
      }
    } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      // Count ALL learning/relearning cards, even those with delays.
      // This matches Anki: failing a card immediately increments the red count.
      learningCount++;
    } else if (card.queue === CardQueue.REVIEW) {
      // Only count review cards due by end of today
      if (!card.next_review_at || card.next_review_at <= endOfTodayIso) {
        reviewCount++;
      }
    }
  }

  return {
    new: newCount,
    learning: learningCount,
    review: reviewCount,
  };
}

export async function hasMoreNewCards(deckId?: string): Promise<boolean> {
  const limitedCount = (await getQueueCounts(deckId, false)).new;
  const unlimitedCount = (await getQueueCounts(deckId, true)).new;
  return unlimitedCount > limitedCount;
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
    .modify({ _synced: true });
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
