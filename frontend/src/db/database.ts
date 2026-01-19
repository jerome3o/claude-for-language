import Dexie, { Table } from 'dexie';
import { CardType, CardQueue, Rating } from '../types';

// ============ Event-Sourced Types ============

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

// ============ Legacy Types (still in use) ============

// Local database types with sync metadata
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

export interface PendingReview {
  id: string;
  card_id: string;
  session_id: string | null;
  rating: Rating;
  time_spent_ms: number | null;
  user_answer: string | null;
  reviewed_at: string;
  // Original queue before this review (for daily limit tracking)
  original_queue: CardQueue;
  // Computed result (applied locally immediately)
  new_queue: CardQueue;
  new_learning_step: number;
  new_ease_factor: number;
  new_interval: number;
  new_repetitions: number;
  new_next_review_at: string | null;
  new_due_timestamp: number | null;
  // Recording blob (stored until sync completes, then uploaded)
  recording_blob?: Blob;
  // Sync status
  _pending: boolean;
  _retries: number;
  _last_error: string | null;
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
  // Legacy tables (still in use during migration)
  decks!: Table<LocalDeck, string>;
  notes!: Table<LocalNote, string>;
  cards!: Table<LocalCard, string>;
  pendingReviews!: Table<PendingReview, string>;
  cachedAudio!: Table<CachedAudio, string>;
  syncMeta!: Table<SyncMeta, string>;
  studySessions!: Table<LocalStudySession, string>;

  // Event-sourced tables (new architecture)
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

    // Version 2: Add event-sourced tables for new sync architecture
    this.version(2).stores({
      // Existing tables (unchanged)
      decks: 'id, user_id, updated_at, _synced_at',
      notes: 'id, deck_id, updated_at, _synced_at',
      cards: 'id, note_id, deck_id, queue, next_review_at, due_timestamp, [deck_id+queue], [deck_id+next_review_at]',
      pendingReviews: 'id, card_id, _pending, reviewed_at, [_pending+reviewed_at]',
      cachedAudio: 'key, cached_at',
      syncMeta: 'id',
      studySessions: 'id, deck_id, started_at, _synced',
      // New event-sourced tables
      reviewEvents: 'id, card_id, reviewed_at, _synced, [card_id+reviewed_at], [_synced+_created_at]',
      cardCheckpoints: 'card_id',
      pendingRecordings: 'id, uploaded',
      eventSyncMeta: 'id',
    });
  }
}

// Singleton database instance
export const db = new ChineseLearningDB();

// Helper functions for common operations

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

// Count new cards studied today (for daily limit enforcement)
export async function getNewCardsStudiedToday(deckId?: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const allReviews = await db.pendingReviews.toArray();

  // Get unique cards reviewed today that started as NEW
  const newCardReviews = allReviews.filter(r =>
    r.reviewed_at.startsWith(today) &&
    r.original_queue === CardQueue.NEW
  );

  // Get unique card IDs (first review of a NEW card counts)
  const uniqueNewCards = new Set<string>();
  for (const review of newCardReviews) {
    if (deckId) {
      const card = await db.cards.get(review.card_id);
      if (card && card.deck_id === deckId) {
        uniqueNewCards.add(review.card_id);
      }
    } else {
      uniqueNewCards.add(review.card_id);
    }
  }

  return uniqueNewCards.size;
}

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

export async function getPendingReviews(): Promise<PendingReview[]> {
  // Use filter since _pending is boolean
  return db.pendingReviews.filter(r => r._pending === true).toArray();
}

export async function getPendingReviewCount(): Promise<number> {
  return (await getPendingReviews()).length;
}

export async function getSyncMeta(): Promise<SyncMeta | undefined> {
  return db.syncMeta.get('sync_state');
}

export async function updateSyncMeta(meta: Partial<SyncMeta>): Promise<void> {
  await db.syncMeta.put({ id: 'sync_state', ...meta } as SyncMeta);
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.pendingReviews, db.syncMeta, db.studySessions], async () => {
    await db.decks.clear();
    await db.notes.clear();
    await db.cards.clear();
    await db.pendingReviews.clear();
    await db.syncMeta.clear();
    await db.studySessions.clear();
  });
}

// Get queue counts for display (Anki-style)
export async function getQueueCounts(deckId?: string, ignoreDailyLimit = false): Promise<{ new: number; learning: number; review: number }> {
  const cards = await getDueCards(deckId, ignoreDailyLimit);

  return {
    new: cards.filter(c => c.queue === CardQueue.NEW).length,
    learning: cards.filter(c => c.queue === CardQueue.LEARNING || c.queue === CardQueue.RELEARNING).length,
    review: cards.filter(c => c.queue === CardQueue.REVIEW).length,
  };
}

// Check if there are more new cards beyond the daily limit
export async function hasMoreNewCards(deckId?: string): Promise<boolean> {
  const limitedCount = (await getQueueCounts(deckId, false)).new;
  const unlimitedCount = (await getQueueCounts(deckId, true)).new;
  return unlimitedCount > limitedCount;
}

// Clear old synced pending reviews (keep last 7 days)
export async function cleanupSyncedReviews(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffDate = sevenDaysAgo.toISOString();

  // Get all synced reviews older than 7 days
  const oldReviews = await db.pendingReviews
    .filter(r => !r._pending && r.reviewed_at < cutoffDate)
    .toArray();

  if (oldReviews.length > 0) {
    await db.pendingReviews.bulkDelete(oldReviews.map(r => r.id));
  }

  return oldReviews.length;
}

// Get database stats for debugging
export async function getDatabaseStats(): Promise<{
  decks: number;
  notes: number;
  cards: number;
  pendingReviews: number;
  syncedReviews: number;
  reviewEvents?: number;
  unsyncedEvents?: number;
}> {
  const [decks, notes, cards, pendingReviews, syncedReviews] = await Promise.all([
    db.decks.count(),
    db.notes.count(),
    db.cards.count(),
    db.pendingReviews.where('_pending').equals(1).count(),
    db.pendingReviews.where('_pending').equals(0).count(),
  ]);

  // Try to get event-sourced stats (may not exist in older DBs)
  let reviewEvents = 0;
  let unsyncedEvents = 0;
  try {
    reviewEvents = await db.reviewEvents.count();
    unsyncedEvents = await db.reviewEvents.where('_synced').equals(0).count();
  } catch {
    // Tables may not exist yet
  }

  return { decks, notes, cards, pendingReviews, syncedReviews, reviewEvents, unsyncedEvents };
}

// ============ Event-Sourced Helper Functions ============

/**
 * Create a local review event
 */
export async function createLocalReviewEvent(event: Omit<LocalReviewEvent, '_created_at'>): Promise<void> {
  await db.reviewEvents.put({
    ...event,
    _created_at: new Date().toISOString(),
  });
}

/**
 * Get all review events for a card (sorted by reviewed_at)
 */
export async function getCardReviewEvents(cardId: string): Promise<LocalReviewEvent[]> {
  return db.reviewEvents
    .where('card_id')
    .equals(cardId)
    .sortBy('reviewed_at');
}

/**
 * Get unsynced review events
 */
export async function getUnsyncedReviewEvents(limit = 100): Promise<LocalReviewEvent[]> {
  return db.reviewEvents
    .where('_synced')
    .equals(0)
    .limit(limit)
    .toArray();
}

/**
 * Mark review events as synced
 */
export async function markReviewEventsSynced(eventIds: string[]): Promise<void> {
  await db.reviewEvents
    .where('id')
    .anyOf(eventIds)
    .modify({ _synced: true });
}

/**
 * Get card checkpoint
 */
export async function getCardCheckpoint(cardId: string): Promise<LocalCardCheckpoint | undefined> {
  return db.cardCheckpoints.get(cardId);
}

/**
 * Update or create card checkpoint
 */
export async function upsertCardCheckpoint(checkpoint: LocalCardCheckpoint): Promise<void> {
  await db.cardCheckpoints.put(checkpoint);
}

/**
 * Get event sync metadata
 */
export async function getEventSyncMeta(): Promise<EventSyncMeta | undefined> {
  return db.eventSyncMeta.get('event_sync_state');
}

/**
 * Update event sync metadata
 */
export async function updateEventSyncMeta(lastEventSyncedAt: string): Promise<void> {
  await db.eventSyncMeta.put({
    id: 'event_sync_state',
    last_event_synced_at: lastEventSyncedAt,
    last_sync_at: new Date().toISOString(),
  });
}

/**
 * Store a pending recording
 */
export async function storePendingRecording(recording: PendingRecording): Promise<void> {
  await db.pendingRecordings.put(recording);
}

/**
 * Get pending recordings that haven't been uploaded
 */
export async function getPendingRecordings(): Promise<PendingRecording[]> {
  return db.pendingRecordings.where('uploaded').equals(0).toArray();
}

/**
 * Mark a recording as uploaded
 */
export async function markRecordingUploaded(id: string): Promise<void> {
  await db.pendingRecordings.update(id, { uploaded: true });
}

/**
 * Clean up uploaded recordings older than 24 hours
 */
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
