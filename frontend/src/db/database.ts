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
  maximum_interval: number;
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
  sentence_clue: string | null;
  sentence_clue_pinyin: string | null;
  sentence_clue_translation: string | null;
  sentence_clue_audio_url: string | null;
  multiple_choice_options: string | null;
  pinyin_only: number;
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

// Sync debug log entry
export interface SyncLogEntry {
  id: string;
  timestamp: number; // Date.now()
  type: 'full' | 'incremental' | 'events' | 'background';
  outcome: 'success' | 'error';
  duration_ms: number;
  error_message?: string;
  details: {
    decks_synced?: number;
    notes_synced?: number;
    cards_synced?: number;
    events_uploaded?: number;
    events_downloaded?: number;
    recordings_uploaded?: number;
  };
}

// Cached character definition for instant lookups
export interface CachedCharacterDefinition {
  hanzi: string; // Primary key - single character or word
  pinyin: string;
  english: string;
  fun_facts: string | null;
  example: string | null;
  cached_at: number;
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
  characterDefinitions!: Table<CachedCharacterDefinition, string>;

  // Debug tables
  syncLogs!: Table<SyncLogEntry, string>;

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

    // Version 6: Add syncLogs table for debug statistics
    this.version(6).stores({
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
      syncLogs: 'id, timestamp',
    });

    // Version 7: Add characterDefinitions table for cached character lookups
    this.version(7).stores({
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
      syncLogs: 'id, timestamp',
      characterDefinitions: 'hanzi, cached_at',
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

function getDailyStatsId(date: string, deckId: string): string {
  return `${date}:${deckId}`;
}

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Compute "new cards studied today" for ALL decks in one pass over today's review
 * events. A card counts as "new today" if its first-ever review was today.
 *
 * Uses the `reviewed_at` index (range query) and a single bulkGet for cards, so
 * cost is O(events_today) regardless of total history size.
 */
async function computeNewCardsStudiedTodayByDeck(): Promise<Map<string, number>> {
  const today = getTodayString();

  const todayEvents = await db.reviewEvents
    .where('reviewed_at')
    .between(today, today + '\uffff')
    .toArray();

  const result = new Map<string, number>();
  if (todayEvents.length === 0) return result;

  const cardIds = [...new Set(todayEvents.map(e => e.card_id))];

  // A card was NEW before today iff it has no review events before today.
  // The [card_id+reviewed_at] index lets us fetch each card's first-ever event cheaply.
  const [firstEventKeys, cards] = await Promise.all([
    Promise.all(
      cardIds.map(id =>
        db.reviewEvents.where('[card_id+reviewed_at]').between([id, ''], [id, '\uffff']).limit(1).keys()
      )
    ),
    db.cards.bulkGet(cardIds),
  ]);

  const deckByCard = new Map<string, string>();
  for (const card of cards) {
    if (card) deckByCard.set(card.id, card.deck_id);
  }

  for (let i = 0; i < cardIds.length; i++) {
    const firstKey = firstEventKeys[i][0] as [string, string] | undefined;
    if (!firstKey || firstKey[1] < today) continue; // had reviews before today
    const deckId = deckByCard.get(cardIds[i]);
    if (!deckId) continue;
    result.set(deckId, (result.get(deckId) ?? 0) + 1);
  }

  return result;
}

/**
 * Seed today's dailyStats counters for every deck so that subsequent reads never
 * fall through to event scanning. Call once on app load (and at day rollover).
 * Safe to call repeatedly; only writes rows that don't already exist.
 */
export async function ensureDailyStatsInitialized(): Promise<void> {
  const today = getTodayString();
  const [decks, existing] = await Promise.all([
    db.decks.toArray(),
    db.dailyStats.where('date').equals(today).toArray(),
  ]);

  const have = new Set(existing.map(s => s.deck_id));
  const missing = decks.filter(d => !have.has(d.id));
  if (missing.length === 0) return;

  const computed = await computeNewCardsStudiedTodayByDeck();
  await db.dailyStats.bulkPut(
    missing.map(d => ({
      id: getDailyStatsId(today, d.id),
      date: today,
      deck_id: d.id,
      new_cards_studied: computed.get(d.id) ?? 0,
    }))
  );
}

/**
 * Read today's new-cards-studied counters for all decks. Prefers the dailyStats
 * cache; falls back to a single fast recompute for any decks not yet cached.
 */
async function getNewCardsStudiedTodayMap(deckIds: string[]): Promise<Map<string, number>> {
  const today = getTodayString();
  const rows = await db.dailyStats.where('date').equals(today).toArray();
  const result = new Map(rows.map(r => [r.deck_id, r.new_cards_studied]));
  if (deckIds.every(id => result.has(id))) return result;

  const computed = await computeNewCardsStudiedTodayByDeck();
  for (const id of deckIds) {
    if (!result.has(id)) result.set(id, computed.get(id) ?? 0);
  }
  return result;
}

/** Read-only. Safe for useLiveQuery. */
export async function getNewCardsStudiedToday(deckId?: string): Promise<number> {
  const decks = await db.decks.toArray();
  const map = await getNewCardsStudiedTodayMap(decks.map(d => d.id));
  if (deckId) return map.get(deckId) ?? 0;
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}

/**
 * Increment the new-cards-studied counter for a deck.
 * Writes to the database; call outside useLiveQuery contexts.
 */
export async function incrementNewCardsStudiedToday(deckId: string): Promise<void> {
  const today = getTodayString();
  const id = getDailyStatsId(today, deckId);
  const existing = await db.dailyStats.get(id);
  await db.dailyStats.put({
    id,
    date: today,
    deck_id: deckId,
    new_cards_studied: (existing?.new_cards_studied ?? 0) + 1,
  });
}

/**
 * Clean up old daily stats (older than 7 days).
 * Can be called periodically to prevent unbounded growth.
 */
export async function cleanupOldDailyStats(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const year = cutoff.getFullYear();
  const month = String(cutoff.getMonth() + 1).padStart(2, '0');
  const day = String(cutoff.getDate()).padStart(2, '0');
  const cutoffStr = `${year}-${month}-${day}`;

  const oldStats = await db.dailyStats
    .filter(stat => stat.date < cutoffStr)
    .toArray();

  if (oldStats.length > 0) {
    await db.dailyStats.bulkDelete(oldStats.map(s => s.id));
    console.log(`[dailyStats] Cleaned up ${oldStats.length} old entries`);
  }
}

// ============ Due Cards & Queue Counts ============

/**
 * "Due today" cutoff: end of today, or one hour from now if later (so studying
 * near midnight still picks up cards due just after midnight).
 */
export function getStudyCutoff(): { iso: string; ts: number } {
  const eod = new Date();
  eod.setHours(23, 59, 59, 999);
  const plus1h = Date.now() + 60 * 60 * 1000;
  const ts = Math.max(eod.getTime(), plus1h);
  return { iso: new Date(ts).toISOString(), ts };
}

async function loadCards(deckId?: string): Promise<LocalCard[]> {
  return deckId ? db.cards.where('deck_id').equals(deckId).toArray() : db.cards.toArray();
}

/** Raw per-deck counts before applying the daily new-card limit/bonus. */
export interface DeckQueueRaw {
  learning: number;
  review: number;
  totalNew: number;
  newCardsPerDay: number;
  studiedToday: number;
}

export interface DeckQueueCounts {
  new: number;
  learning: number;
  review: number;
  hasMoreNew: boolean;
}

export const EMPTY_QUEUE_COUNTS: DeckQueueCounts = {
  new: 0,
  learning: 0,
  review: 0,
  hasMoreNew: false,
};

/** Apply a daily-limit + bonus to raw counts to get the displayable numbers. */
export function applyNewCardBonus(raw: DeckQueueRaw, bonus: number): DeckQueueCounts {
  const remaining = Math.max(0, raw.newCardsPerDay + bonus - raw.studiedToday);
  const newCount = Math.min(raw.totalNew, remaining);
  return {
    new: newCount,
    learning: raw.learning,
    review: raw.review,
    hasMoreNew: raw.totalNew > newCount,
  };
}

export function sumQueueCounts(counts: Iterable<DeckQueueCounts>): DeckQueueCounts {
  const total = { ...EMPTY_QUEUE_COUNTS };
  for (const c of counts) {
    total.new += c.new;
    total.learning += c.learning;
    total.review += c.review;
    total.hasMoreNew ||= c.hasMoreNew;
  }
  return total;
}

/**
 * Single scan of the cards table producing raw per-deck counts. Bonus/limit
 * application is left to the caller (see applyNewCardBonus) so that one scan
 * can serve multiple views with different bonuses.
 */
export async function getRawQueueCounts(deckId?: string): Promise<Map<string, DeckQueueRaw>> {
  const cutoff = getStudyCutoff();
  const decks = deckId
    ? await db.decks.get(deckId).then(d => (d ? [d] : []))
    : await db.decks.toArray();
  const [cards, studied] = await Promise.all([
    loadCards(deckId),
    getNewCardsStudiedTodayMap(decks.map(d => d.id)),
  ]);

  const byDeck = new Map<string, DeckQueueRaw>();
  for (const d of decks) {
    byDeck.set(d.id, {
      learning: 0,
      review: 0,
      totalNew: 0,
      newCardsPerDay: d.new_cards_per_day,
      studiedToday: studied.get(d.id) ?? 0,
    });
  }

  for (const card of cards) {
    const bucket = byDeck.get(card.deck_id);
    if (!bucket) continue;
    if (card.queue === CardQueue.NEW) {
      bucket.totalNew++;
    } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      bucket.learning++;
    } else if (card.queue === CardQueue.REVIEW) {
      if (!card.next_review_at || card.next_review_at <= cutoff.iso) bucket.review++;
    }
  }

  return byDeck;
}

/**
 * Get cards that are due for study, respecting per-deck new-card limits.
 *
 * @param bonusNewCards Extra new cards beyond the daily limit (Infinity = no limit).
 */
export async function getDueCards(deckId?: string, bonusNewCards = 0): Promise<LocalCard[]> {
  const cutoff = getStudyCutoff();
  const decks = deckId
    ? await db.decks.get(deckId).then(d => (d ? [d] : []))
    : await db.decks.toArray();
  const [cards, studied] = await Promise.all([
    loadCards(deckId),
    getNewCardsStudiedTodayMap(decks.map(d => d.id)),
  ]);

  const remaining = new Map(
    decks.map(d => [d.id, Math.max(0, d.new_cards_per_day + bonusNewCards - (studied.get(d.id) ?? 0))])
  );
  const newTaken = new Map<string, number>();
  const due: LocalCard[] = [];

  for (const card of cards) {
    if (card.queue === CardQueue.NEW) {
      const taken = newTaken.get(card.deck_id) ?? 0;
      if (taken < (remaining.get(card.deck_id) ?? 0)) {
        due.push(card);
        newTaken.set(card.deck_id, taken + 1);
      }
    } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      if (!card.due_timestamp || card.due_timestamp <= cutoff.ts) due.push(card);
    } else if (card.queue === CardQueue.REVIEW) {
      if (!card.next_review_at || card.next_review_at <= cutoff.iso) due.push(card);
    }
  }

  return due;
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

/**
 * Reset sync timestamps to force a full sync on next sync.
 * This does NOT delete any local data - just resets the "last synced at" timestamps
 * so that the next sync will be a full sync that fetches all data from server.
 */
export async function resetSyncTimestamps(): Promise<void> {
  await db.syncMeta.clear();
}

/** Convenience: counts for one deck (or all combined) with a flat bonus applied. */
export async function getQueueCounts(
  deckId?: string,
  bonusNewCards = 0
): Promise<DeckQueueCounts> {
  const raw = await getRawQueueCounts(deckId);
  const applied = [...raw.values()].map(r => applyNewCardBonus(r, bonusNewCards));
  return deckId ? applied[0] ?? EMPTY_QUEUE_COUNTS : sumQueueCounts(applied);
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

// ============ Sync Log Functions ============

const MAX_SYNC_LOGS = 200;
const SYNC_LOG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

export async function addSyncLog(entry: SyncLogEntry): Promise<void> {
  await db.syncLogs.put(entry);
  // Purge old entries
  await purgeSyncLogs();
}

export async function getSyncLogs(): Promise<SyncLogEntry[]> {
  return db.syncLogs.orderBy('timestamp').reverse().toArray();
}

async function purgeSyncLogs(): Promise<void> {
  const cutoff = Date.now() - SYNC_LOG_MAX_AGE_MS;

  // Delete entries older than 2 weeks
  const oldEntries = await db.syncLogs
    .where('timestamp')
    .below(cutoff)
    .toArray();
  if (oldEntries.length > 0) {
    await db.syncLogs.bulkDelete(oldEntries.map(e => e.id));
  }

  // Keep only the most recent 200
  const count = await db.syncLogs.count();
  if (count > MAX_SYNC_LOGS) {
    const toRemove = await db.syncLogs
      .orderBy('timestamp')
      .limit(count - MAX_SYNC_LOGS)
      .toArray();
    await db.syncLogs.bulkDelete(toRemove.map(e => e.id));
  }
}
