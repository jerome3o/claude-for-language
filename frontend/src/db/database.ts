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
  // Daily quota for secondary new cards (note already has a reviewed card).
  // Additive to new_cards_per_day. Optional: rows synced before this field
  // existed won't have it — read with DEFAULT_SECONDARY_CARDS_PER_DAY fallback.
  secondary_cards_per_day?: number;
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
  alternatives: string | null;
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
  // Secondary new cards studied (note already had a reviewed card when this
  // card was introduced). Optional: rows written before this field existed.
  secondary_cards_studied?: number;
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

/** Default daily quota for secondary new cards (kept in sync with the D1 column default). */
export const DEFAULT_SECONDARY_CARDS_PER_DAY = 10;

/** Per-deck split of new cards introduced today. */
export interface NewCardsStudiedToday {
  primary: number;   // First card of a note ever reviewed
  secondary: number; // Note already had a reviewed card when this one was introduced
}

/** Fetch a card's first-ever review timestamp via the [card_id+reviewed_at] index. */
async function getFirstReviewedAt(cardId: string): Promise<string | undefined> {
  const keys = await db.reviewEvents
    .where('[card_id+reviewed_at]')
    .between([cardId, ''], [cardId, '\uffff'])
    .limit(1)
    .keys();
  const firstKey = keys[0] as unknown as [string, string] | undefined;
  return firstKey?.[1];
}

/**
 * Compute "new cards studied today" for ALL decks in one pass over today's review
 * events. A card counts as "new today" if its first-ever review was today. It
 * counts as SECONDARY if a sibling card of the same note was first reviewed
 * earlier (i.e. the note was already in circulation when it was introduced).
 *
 * Uses the `reviewed_at` index (range query) and a single bulkGet for cards, so
 * cost is O(events_today) regardless of total history size.
 */
async function computeNewCardsStudiedTodayByDeck(): Promise<Map<string, NewCardsStudiedToday>> {
  const today = getTodayString();

  const todayEvents = await db.reviewEvents
    .where('reviewed_at')
    .between(today, today + '\uffff')
    .toArray();

  const result = new Map<string, NewCardsStudiedToday>();
  if (todayEvents.length === 0) return result;

  const cardIds = [...new Set(todayEvents.map(e => e.card_id))];

  // A card was NEW before today iff it has no review events before today.
  const [firstEventTimes, cards] = await Promise.all([
    Promise.all(cardIds.map(getFirstReviewedAt)),
    db.cards.bulkGet(cardIds),
  ]);

  const firstReviewedAt = new Map<string, string>();
  for (let i = 0; i < cardIds.length; i++) {
    if (firstEventTimes[i]) firstReviewedAt.set(cardIds[i], firstEventTimes[i]!);
  }

  const introduced = cards.filter(
    (card): card is LocalCard => !!card && (firstReviewedAt.get(card.id) ?? '') >= today
  );
  if (introduced.length === 0) return result;

  // Load sibling cards of the introduced notes and their first-review times so
  // each introduced card can be classified as primary or secondary.
  const noteIds = [...new Set(introduced.map(c => c.note_id))];
  const siblings = await db.cards.where('note_id').anyOf(noteIds).toArray();
  const unknownFirst = siblings.filter(s => !firstReviewedAt.has(s.id));
  const siblingTimes = await Promise.all(unknownFirst.map(s => getFirstReviewedAt(s.id)));
  for (let i = 0; i < unknownFirst.length; i++) {
    if (siblingTimes[i]) firstReviewedAt.set(unknownFirst[i].id, siblingTimes[i]!);
  }

  const siblingsByNote = new Map<string, LocalCard[]>();
  for (const s of siblings) {
    const arr = siblingsByNote.get(s.note_id);
    if (arr) arr.push(s);
    else siblingsByNote.set(s.note_id, [s]);
  }

  for (const card of introduced) {
    const first = firstReviewedAt.get(card.id)!;
    const isSecondary = (siblingsByNote.get(card.note_id) ?? []).some(
      s => s.id !== card.id && (firstReviewedAt.get(s.id) ?? '\uffff') < first
    );
    const bucket = result.get(card.deck_id) ?? { primary: 0, secondary: 0 };
    if (isSecondary) bucket.secondary++;
    else bucket.primary++;
    result.set(card.deck_id, bucket);
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
      new_cards_studied: computed.get(d.id)?.primary ?? 0,
      secondary_cards_studied: computed.get(d.id)?.secondary ?? 0,
    }))
  );
}

/**
 * Read today's new-cards-studied counters for all decks. Prefers the dailyStats
 * cache; falls back to a single fast recompute for any decks not yet cached.
 */
async function getNewCardsStudiedTodayMap(deckIds: string[]): Promise<Map<string, NewCardsStudiedToday>> {
  const today = getTodayString();
  const rows = await db.dailyStats.where('date').equals(today).toArray();
  const result = new Map<string, NewCardsStudiedToday>(
    rows.map(r => [r.deck_id, { primary: r.new_cards_studied, secondary: r.secondary_cards_studied ?? 0 }])
  );
  if (deckIds.every(id => result.has(id))) return result;

  const computed = await computeNewCardsStudiedTodayByDeck();
  for (const id of deckIds) {
    if (!result.has(id)) result.set(id, computed.get(id) ?? { primary: 0, secondary: 0 });
  }
  return result;
}

/** Read-only. Safe for useLiveQuery. Returns primary (blue) new cards studied today. */
export async function getNewCardsStudiedToday(deckId?: string): Promise<number> {
  const decks = await db.decks.toArray();
  const map = await getNewCardsStudiedTodayMap(decks.map(d => d.id));
  if (deckId) return map.get(deckId)?.primary ?? 0;
  let total = 0;
  for (const v of map.values()) total += v.primary;
  return total;
}

/**
 * Increment the new-cards-studied counter for a deck. Pass secondary=true when
 * the introduced card's note already had a reviewed card.
 * Writes to the database; call outside useLiveQuery contexts.
 */
export async function incrementNewCardsStudiedToday(deckId: string, secondary = false): Promise<void> {
  const today = getTodayString();
  const id = getDailyStatsId(today, deckId);
  const existing = await db.dailyStats.get(id);
  await db.dailyStats.put({
    id,
    date: today,
    deck_id: deckId,
    new_cards_studied: (existing?.new_cards_studied ?? 0) + (secondary ? 0 : 1),
    secondary_cards_studied: (existing?.secondary_cards_studied ?? 0) + (secondary ? 1 : 0),
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
  totalNew: number;          // NEW cards on unseen notes (primary pool)
  totalSecondaryNew: number; // NEW cards whose note already has a reviewed card
  newCardsPerDay: number;
  secondaryCardsPerDay: number;
  studiedToday: number;          // primary new cards introduced today
  secondaryStudiedToday: number; // secondary new cards introduced today
}

export interface DeckQueueCounts {
  new: number;
  secondaryNew: number;
  learning: number;
  review: number;
  hasMoreNew: boolean;
}

export const EMPTY_QUEUE_COUNTS: DeckQueueCounts = {
  new: 0,
  secondaryNew: 0,
  learning: 0,
  review: 0,
  hasMoreNew: false,
};

/**
 * Remaining daily budgets for new-card admission. Secondary cards studied
 * beyond their own quota were funded by the primary budget (spillover), so the
 * excess counts against it.
 */
export function newCardBudgets(
  raw: Pick<DeckQueueRaw, 'newCardsPerDay' | 'secondaryCardsPerDay' | 'studiedToday' | 'secondaryStudiedToday'>,
  bonus: number
): { primary: number; secondary: number } {
  const overflow = Math.max(0, raw.secondaryStudiedToday - raw.secondaryCardsPerDay);
  return {
    primary: Math.max(0, raw.newCardsPerDay + bonus - raw.studiedToday - overflow),
    secondary: Math.max(0, raw.secondaryCardsPerDay - raw.secondaryStudiedToday),
  };
}

/** Apply a daily-limit + bonus to raw counts to get the displayable numbers. */
export function applyNewCardBonus(raw: DeckQueueRaw, bonus: number): DeckQueueCounts {
  const budgets = newCardBudgets(raw, bonus);
  const newCount = Math.min(raw.totalNew, budgets.primary);
  // Secondary cards draw from their own quota first, then spill into whatever
  // primary budget is left (e.g. when there are no unseen notes remaining).
  const spill = budgets.primary - newCount;
  const secondaryCount = Math.min(raw.totalSecondaryNew, budgets.secondary + spill);
  return {
    new: newCount,
    secondaryNew: secondaryCount,
    learning: raw.learning,
    review: raw.review,
    hasMoreNew: raw.totalNew + raw.totalSecondaryNew > newCount + secondaryCount,
  };
}

export function sumQueueCounts(counts: Iterable<DeckQueueCounts>): DeckQueueCounts {
  const total = { ...EMPTY_QUEUE_COUNTS };
  for (const c of counts) {
    total.new += c.new;
    total.secondaryNew += c.secondaryNew;
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
    const s = studied.get(d.id) ?? { primary: 0, secondary: 0 };
    byDeck.set(d.id, {
      learning: 0,
      review: 0,
      totalNew: 0,
      totalSecondaryNew: 0,
      newCardsPerDay: d.new_cards_per_day,
      secondaryCardsPerDay: d.secondary_cards_per_day ?? DEFAULT_SECONDARY_CARDS_PER_DAY,
      studiedToday: s.primary,
      secondaryStudiedToday: s.secondary,
    });
  }

  // Notes with at least one reviewed card — their remaining NEW cards are "secondary"
  const reviewedNoteIds = new Set<string>();
  for (const card of cards) {
    if (card.queue !== CardQueue.NEW) reviewedNoteIds.add(card.note_id);
  }

  for (const card of cards) {
    const bucket = byDeck.get(card.deck_id);
    if (!bucket) continue;
    if (card.queue === CardQueue.NEW) {
      if (reviewedNoteIds.has(card.note_id)) bucket.totalSecondaryNew++;
      else bucket.totalNew++;
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
 * New cards are sorted by priority before the daily limits are applied:
 *   1. Notes with no reviews yet + hanzi_to_meaning type (highest)
 *   2. Notes with no reviews yet (any type)
 *   3. Notes already reviewed + hanzi_to_meaning type
 *   4. Notes already reviewed (any type)
 *
 * Two daily budgets are applied per deck:
 *   - Primary (new_cards_per_day + bonus): admits cards of unseen notes
 *     (tiers 1-2). Leftover primary budget can also admit secondary cards.
 *   - Secondary (secondary_cards_per_day): reserved for cards whose note is
 *     already in circulation (tiers 3-4), so they keep flowing even when
 *     unseen notes alone would exhaust the primary limit.
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

  // Notes that have at least one card that's been reviewed (queue != NEW)
  const reviewedNoteIds = new Set<string>();
  for (const card of cards) {
    if (card.queue !== CardQueue.NEW) reviewedNoteIds.add(card.note_id);
  }

  const budgets = new Map(
    decks.map(d => {
      const s = studied.get(d.id) ?? { primary: 0, secondary: 0 };
      return [
        d.id,
        newCardBudgets(
          {
            newCardsPerDay: d.new_cards_per_day,
            secondaryCardsPerDay: d.secondary_cards_per_day ?? DEFAULT_SECONDARY_CARDS_PER_DAY,
            studiedToday: s.primary,
            secondaryStudiedToday: s.secondary,
          },
          bonusNewCards
        ),
      ];
    })
  );
  const due: LocalCard[] = [];

  // Sort new cards by priority before applying per-deck daily limits so that
  // higher-priority cards make it into the session when the limit is tight.
  // Primary-pool cards (unseen notes) sort first, so they get first claim on
  // the primary budget before secondary cards can spill into it.
  const sortedNewCards = cards
    .filter(c => c.queue === CardQueue.NEW)
    .sort((a, b) => {
      const ap = (!reviewedNoteIds.has(a.note_id) ? 0 : 2) + (a.card_type === 'hanzi_to_meaning' ? 0 : 1);
      const bp = (!reviewedNoteIds.has(b.note_id) ? 0 : 2) + (b.card_type === 'hanzi_to_meaning' ? 0 : 1);
      return ap - bp;
    });

  for (const card of sortedNewCards) {
    const budget = budgets.get(card.deck_id);
    if (!budget) continue;
    if (reviewedNoteIds.has(card.note_id)) {
      // Secondary: own quota first, then spill into leftover primary budget
      if (budget.secondary > 0) {
        budget.secondary--;
        due.push(card);
      } else if (budget.primary > 0) {
        budget.primary--;
        due.push(card);
      }
    } else if (budget.primary > 0) {
      budget.primary--;
      due.push(card);
    }
  }

  for (const card of cards) {
    if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      if (!card.due_timestamp || card.due_timestamp <= cutoff.ts) due.push(card);
    } else if (card.queue === CardQueue.REVIEW) {
      if (!card.next_review_at || card.next_review_at <= cutoff.iso) due.push(card);
    }
  }

  return due;
}

/**
 * Returns the set of note IDs that have at least one reviewed card (queue != NEW).
 * Used by the study session to prioritize unreviewed notes when selecting new cards.
 */
export async function getReviewedNoteIds(deckId?: string): Promise<Set<string>> {
  const cards = await loadCards(deckId);
  const ids = new Set<string>();
  for (const card of cards) {
    if (card.queue !== CardQueue.NEW) ids.add(card.note_id);
  }
  return ids;
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
