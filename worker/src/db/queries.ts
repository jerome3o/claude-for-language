import {
  Deck,
  Note,
  Card,
  StudySession,
  CardReview,
  NoteQuestion,
  NoteWithCards,
  DeckWithNotes,
  CardWithNote,
  CardQueue,
  QueueCounts,
  Rating,
} from '../types';
import { generateId, CARD_TYPES } from '../services/cards';
import { DeckSettings, DEFAULT_DECK_SETTINGS, parseLearningSteps, SchedulerResult } from '../services/anki-scheduler';

// ============ Review Events (Event-Sourced Architecture) ============

export interface ReviewEvent {
  id: string;
  card_id: string;
  user_id: string;
  rating: Rating;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
  reviewed_at: string;
  created_at: string;
  // Snapshot for debugging (not used for computation)
  snapshot_queue: number | null;
  snapshot_ease: number | null;
  snapshot_interval: number | null;
  snapshot_next_review_at: string | null;
}

export interface CardCheckpoint {
  card_id: string;
  checkpoint_at: string;
  event_count: number;
  queue: number;
  learning_step: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review_at: string | null;
  due_timestamp: number | null;
  updated_at: string;
}

/**
 * Create a review event (for dual-write during migration)
 */
export async function createReviewEvent(
  db: D1Database,
  cardId: string,
  userId: string,
  rating: Rating,
  reviewedAt: string,
  timeSpentMs?: number,
  userAnswer?: string,
  recordingUrl?: string,
  snapshot?: {
    queue: number;
    ease_factor: number;
    interval: number;
    next_review_at: string | null;
  }
): Promise<ReviewEvent> {
  const id = generateId();

  await db.prepare(`
    INSERT INTO review_events (
      id, card_id, user_id, rating, time_spent_ms, user_answer, recording_url, reviewed_at,
      snapshot_queue, snapshot_ease, snapshot_interval, snapshot_next_review_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    cardId,
    userId,
    rating,
    timeSpentMs || null,
    userAnswer || null,
    recordingUrl || null,
    reviewedAt,
    snapshot?.queue ?? null,
    snapshot?.ease_factor ?? null,
    snapshot?.interval ?? null,
    snapshot?.next_review_at ?? null
  ).run();

  const event = await db.prepare('SELECT * FROM review_events WHERE id = ?')
    .bind(id)
    .first<ReviewEvent>();

  if (!event) throw new Error('Failed to create review event');
  return event;
}

/**
 * Create multiple review events in a batch (for sync upload)
 */
export async function createReviewEventsBatch(
  db: D1Database,
  events: Array<{
    id: string;
    card_id: string;
    user_id: string;
    rating: Rating;
    reviewed_at: string;
    time_spent_ms?: number;
    user_answer?: string;
    recording_url?: string;
  }>
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const event of events) {
    try {
      // Check if event already exists (idempotency)
      const existing = await db.prepare('SELECT id FROM review_events WHERE id = ?')
        .bind(event.id)
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await db.prepare(`
        INSERT INTO review_events (
          id, card_id, user_id, rating, time_spent_ms, user_answer, recording_url, reviewed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event.id,
        event.card_id,
        event.user_id,
        event.rating,
        event.time_spent_ms || null,
        event.user_answer || null,
        event.recording_url || null,
        event.reviewed_at
      ).run();

      created++;
    } catch (err) {
      console.error('[createReviewEventsBatch] Error creating event:', event.id, err);
      skipped++;
    }
  }

  return { created, skipped };
}

/**
 * Get review events for a user since a given timestamp
 */
export async function getReviewEventsSince(
  db: D1Database,
  userId: string,
  since: string,
  limit: number = 1000
): Promise<ReviewEvent[]> {
  const result = await db.prepare(`
    SELECT * FROM review_events
    WHERE user_id = ? AND created_at > ?
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(userId, since, limit).all<ReviewEvent>();

  return result.results;
}

/**
 * Get review events for a specific card
 */
export async function getCardReviewEvents(
  db: D1Database,
  cardId: string,
  userId: string
): Promise<ReviewEvent[]> {
  const result = await db.prepare(`
    SELECT * FROM review_events
    WHERE card_id = ? AND user_id = ?
    ORDER BY reviewed_at ASC
  `).bind(cardId, userId).all<ReviewEvent>();

  return result.results;
}

/**
 * Get or create a card checkpoint
 */
export async function getCardCheckpoint(
  db: D1Database,
  cardId: string
): Promise<CardCheckpoint | null> {
  return db.prepare('SELECT * FROM card_checkpoints WHERE card_id = ?')
    .bind(cardId)
    .first<CardCheckpoint>();
}

/**
 * Update or create a card checkpoint
 */
export async function upsertCardCheckpoint(
  db: D1Database,
  checkpoint: Omit<CardCheckpoint, 'updated_at'>
): Promise<void> {
  await db.prepare(`
    INSERT INTO card_checkpoints (
      card_id, checkpoint_at, event_count, queue, learning_step,
      ease_factor, interval, repetitions, next_review_at, due_timestamp
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      checkpoint_at = excluded.checkpoint_at,
      event_count = excluded.event_count,
      queue = excluded.queue,
      learning_step = excluded.learning_step,
      ease_factor = excluded.ease_factor,
      interval = excluded.interval,
      repetitions = excluded.repetitions,
      next_review_at = excluded.next_review_at,
      due_timestamp = excluded.due_timestamp,
      updated_at = datetime('now')
  `).bind(
    checkpoint.card_id,
    checkpoint.checkpoint_at,
    checkpoint.event_count,
    checkpoint.queue,
    checkpoint.learning_step,
    checkpoint.ease_factor,
    checkpoint.interval,
    checkpoint.repetitions,
    checkpoint.next_review_at,
    checkpoint.due_timestamp
  ).run();
}

/**
 * Get sync metadata for a user
 */
export async function getSyncMetadata(
  db: D1Database,
  userId: string
): Promise<{ last_event_at: string | null; last_sync_at: string | null } | null> {
  return db.prepare('SELECT last_event_at, last_sync_at FROM sync_metadata WHERE user_id = ?')
    .bind(userId)
    .first();
}

/**
 * Update sync metadata for a user
 */
export async function updateSyncMetadata(
  db: D1Database,
  userId: string,
  lastEventAt: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_metadata (user_id, last_event_at, last_sync_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      last_event_at = excluded.last_event_at,
      last_sync_at = datetime('now')
  `).bind(userId, lastEventAt).run();
}

// ============ Decks ============

export async function getAllDecks(db: D1Database, userId: string): Promise<Deck[]> {
  const result = await db
    .prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<Deck>();
  return result.results;
}

export async function getDeckById(db: D1Database, id: string, userId: string): Promise<Deck | null> {
  return db
    .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Deck>();
}

export async function getDeckWithNotes(db: D1Database, id: string, userId: string): Promise<DeckWithNotes | null> {
  const deck = await getDeckById(db, id, userId);
  if (!deck) return null;

  const notes = await db
    .prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at DESC')
    .bind(id)
    .all<Note>();

  return { ...deck, notes: notes.results };
}

// Extended type for notes with cards included
export interface NoteWithCardsInDeck extends Note {
  cards: Card[];
}

export interface DeckWithNotesAndCards extends Deck {
  notes: NoteWithCardsInDeck[];
}

export async function getDeckWithNotesAndCards(db: D1Database, id: string, userId: string): Promise<DeckWithNotesAndCards | null> {
  const deck = await getDeckById(db, id, userId);
  if (!deck) return null;

  const notes = await db
    .prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at DESC')
    .bind(id)
    .all<Note>();

  // Get all cards for all notes (batch to avoid SQLite parameter limit of 999)
  const noteIds = notes.results.map(n => n.id);
  console.log(`[getDeckWithNotesAndCards] Fetching cards for ${noteIds.length} notes (batched)`);
  if (noteIds.length === 0) {
    return { ...deck, notes: [] };
  }

  // Batch queries to stay under D1's parameter limit (lower than standard SQLite's 999)
  const BATCH_SIZE = 100;
  const allCards: Card[] = [];

  for (let i = 0; i < noteIds.length; i += BATCH_SIZE) {
    const batch = noteIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const cards = await db
      .prepare(`SELECT * FROM cards WHERE note_id IN (${placeholders})`)
      .bind(...batch)
      .all<Card>();
    allCards.push(...cards.results);
  }

  // Group cards by note_id
  const cardsByNoteId: Record<string, Card[]> = {};
  for (const card of allCards) {
    if (!cardsByNoteId[card.note_id]) {
      cardsByNoteId[card.note_id] = [];
    }
    cardsByNoteId[card.note_id].push(card);
  }

  // Attach cards to notes
  const notesWithCards: NoteWithCardsInDeck[] = notes.results.map(note => ({
    ...note,
    cards: cardsByNoteId[note.id] || [],
  }));

  return { ...deck, notes: notesWithCards };
}

export async function createDeck(
  db: D1Database,
  userId: string,
  name: string,
  description?: string
): Promise<Deck> {
  const id = generateId();
  await db
    .prepare('INSERT INTO decks (id, user_id, name, description) VALUES (?, ?, ?, ?)')
    .bind(id, userId, name, description || null)
    .run();

  const deck = await db
    .prepare('SELECT * FROM decks WHERE id = ?')
    .bind(id)
    .first<Deck>();
  if (!deck) throw new Error('Failed to create deck');
  return deck;
}

export async function updateDeck(
  db: D1Database,
  id: string,
  userId: string,
  name?: string,
  description?: string
): Promise<Deck | null> {
  // Verify ownership first
  const existing = await getDeckById(db, id, userId);
  if (!existing) return null;

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  await db
    .prepare(`UPDATE decks SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getDeckById(db, id, userId);
}

export async function deleteDeck(db: D1Database, id: string, userId: string): Promise<void> {
  // Only delete if user owns the deck
  await db
    .prepare('DELETE FROM decks WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
}

// ============ Notes ============

export async function getNoteById(db: D1Database, id: string, userId?: string): Promise<Note | null> {
  if (userId) {
    // Verify the note belongs to a deck owned by the user
    return db
      .prepare(`
        SELECT n.* FROM notes n
        JOIN decks d ON n.deck_id = d.id
        WHERE n.id = ? AND d.user_id = ?
      `)
      .bind(id, userId)
      .first<Note>();
  }
  return db.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first<Note>();
}

export async function getNoteWithCards(db: D1Database, id: string, userId: string): Promise<NoteWithCards | null> {
  const note = await getNoteById(db, id, userId);
  if (!note) return null;

  const cards = await db
    .prepare('SELECT * FROM cards WHERE note_id = ?')
    .bind(id)
    .all<Card>();

  return { ...note, cards: cards.results };
}

export async function createNote(
  db: D1Database,
  deckId: string,
  hanzi: string,
  pinyin: string,
  english: string,
  audioUrl?: string,
  funFacts?: string
): Promise<NoteWithCards> {
  const noteId = generateId();

  // Insert note
  await db
    .prepare(
      'INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url, fun_facts) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(noteId, deckId, hanzi, pinyin, english, audioUrl || null, funFacts || null)
    .run();

  // Create cards for each type
  const cardInserts = CARD_TYPES.map((cardType) => {
    const cardId = generateId();
    return db
      .prepare('INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)')
      .bind(cardId, noteId, cardType)
      .run();
  });

  await Promise.all(cardInserts);

  // Update deck's updated_at
  await db
    .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
    .bind(deckId)
    .run();

  // Return the note with cards (no user check needed since we just created it)
  const note = await db.prepare('SELECT * FROM notes WHERE id = ?').bind(noteId).first<Note>();
  const cards = await db.prepare('SELECT * FROM cards WHERE note_id = ?').bind(noteId).all<Card>();

  if (!note) throw new Error('Failed to create note');
  return { ...note, cards: cards.results };
}

export async function updateNote(
  db: D1Database,
  id: string,
  userIdOrUpdates?: string | {
    hanzi?: string;
    pinyin?: string;
    english?: string;
    audioUrl?: string;
    audioProvider?: 'minimax' | 'gtts';
    funFacts?: string;
  },
  updates?: {
    hanzi?: string;
    pinyin?: string;
    english?: string;
    audioUrl?: string;
    audioProvider?: 'minimax' | 'gtts';
    funFacts?: string;
  }
): Promise<Note | null> {
  // Handle overloaded function signature
  let userId: string | undefined;
  let actualUpdates: {
    hanzi?: string;
    pinyin?: string;
    english?: string;
    audioUrl?: string;
    audioProvider?: 'minimax' | 'gtts';
    funFacts?: string;
  };

  if (typeof userIdOrUpdates === 'string') {
    userId = userIdOrUpdates;
    actualUpdates = updates || {};
  } else {
    actualUpdates = userIdOrUpdates || {};
  }

  // Verify ownership if userId provided
  if (userId) {
    const existing = await getNoteById(db, id, userId);
    if (!existing) return null;
  }

  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (actualUpdates.hanzi !== undefined) {
    fields.push('hanzi = ?');
    values.push(actualUpdates.hanzi);
  }
  if (actualUpdates.pinyin !== undefined) {
    fields.push('pinyin = ?');
    values.push(actualUpdates.pinyin);
  }
  if (actualUpdates.english !== undefined) {
    fields.push('english = ?');
    values.push(actualUpdates.english);
  }
  if (actualUpdates.audioUrl !== undefined) {
    fields.push('audio_url = ?');
    values.push(actualUpdates.audioUrl);
  }
  if (actualUpdates.audioProvider !== undefined) {
    fields.push('audio_provider = ?');
    values.push(actualUpdates.audioProvider);
  }
  if (actualUpdates.funFacts !== undefined) {
    fields.push('fun_facts = ?');
    values.push(actualUpdates.funFacts);
  }

  if (fields.length === 0) {
    return getNoteById(db, id, userId);
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  await db
    .prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // Also update deck's updated_at
  const note = await getNoteById(db, id);
  if (note) {
    await db
      .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
      .bind(note.deck_id)
      .run();
  }

  return note;
}

export async function deleteNote(db: D1Database, id: string, userId: string): Promise<void> {
  // Verify ownership first
  const note = await getNoteById(db, id, userId);
  if (!note) return;

  await db.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();

  // Update deck's updated_at
  await db
    .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
    .bind(note.deck_id)
    .run();
}

// ============ Cards ============

export async function getCardById(db: D1Database, id: string, userId: string): Promise<Card | null> {
  // Verify the card belongs to a note in a deck owned by the user
  return db
    .prepare(`
      SELECT c.* FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE c.id = ? AND d.user_id = ?
    `)
    .bind(id, userId)
    .first<Card>();
}

export async function getCardWithNote(db: D1Database, id: string, userId: string): Promise<CardWithNote | null> {
  const card = await getCardById(db, id, userId);
  if (!card) return null;

  const note = await getNoteById(db, card.note_id);
  if (!note) return null;

  return { ...card, note };
}

export async function getDueCards(
  db: D1Database,
  userId: string,
  deckId?: string,
  includeNew: boolean = true,
  limit: number = 20
): Promise<CardWithNote[]> {
  let query = `
    SELECT c.*, n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts, n.context, n.deck_id
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= date('now', '+1 day', 'start of day'))
  `;

  const params: (string | number)[] = [userId];

  if (!includeNew) {
    query += ' AND c.next_review_at IS NOT NULL';
  }

  if (deckId) {
    query += ' AND n.deck_id = ?';
    params.push(deckId);
  }

  query += ' ORDER BY c.next_review_at ASC NULLS LAST LIMIT ?';
  params.push(limit);

  const result = await db
    .prepare(query)
    .bind(...params)
    .all();

  return result.results.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    note_id: row.note_id as string,
    card_type: row.card_type as Card['card_type'],
    ease_factor: (row.ease_factor as number) || 2.5,
    interval: (row.interval as number) || 0,
    repetitions: (row.repetitions as number) || 0,
    next_review_at: row.next_review_at as string | null,
    queue: (row.queue as CardQueue) ?? CardQueue.NEW,
    learning_step: (row.learning_step as number) || 0,
    due_timestamp: row.due_timestamp as number | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    note: {
      id: row.note_id as string,
      deck_id: row.deck_id as string,
      hanzi: row.hanzi as string,
      pinyin: row.pinyin as string,
      english: row.english as string,
      audio_url: row.audio_url as string | null,
      audio_provider: (row.audio_provider as 'minimax' | 'gtts' | null) || null,
      fun_facts: row.fun_facts as string | null,
      context: row.context as string | null,
      created_at: '',
      updated_at: '',
    },
  }));
}

export async function updateCardSM2(
  db: D1Database,
  id: string,
  easeFactor: number,
  interval: number,
  repetitions: number,
  nextReviewAt: Date
): Promise<void> {
  await db
    .prepare(
      `UPDATE cards SET
        ease_factor = ?,
        interval = ?,
        repetitions = ?,
        next_review_at = ?,
        updated_at = datetime('now')
      WHERE id = ?`
    )
    .bind(easeFactor, interval, repetitions, nextReviewAt.toISOString(), id)
    .run();
}

/**
 * Set card progress directly (for imports)
 * Sets the card to review queue with the given SRS values
 */
export async function setCardProgress(
  db: D1Database,
  cardId: string,
  interval: number,
  easeFactor: number,
  repetitions: number
): Promise<void> {
  // Calculate next review date based on interval
  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  // Set queue to REVIEW if interval > 0, otherwise NEW
  const queue = interval > 0 ? CardQueue.REVIEW : CardQueue.NEW;

  await db
    .prepare(
      `UPDATE cards SET
        queue = ?,
        learning_step = 0,
        ease_factor = ?,
        interval = ?,
        repetitions = ?,
        next_review_at = ?,
        updated_at = datetime('now')
      WHERE id = ?`
    )
    .bind(queue, easeFactor, interval, repetitions, nextReviewAt.toISOString(), cardId)
    .run();
}

// ============ Study Sessions ============

export async function createStudySession(
  db: D1Database,
  userId: string,
  deckId?: string
): Promise<StudySession> {
  const id = generateId();
  await db
    .prepare('INSERT INTO study_sessions (id, user_id, deck_id) VALUES (?, ?, ?)')
    .bind(id, userId, deckId || null)
    .run();

  const session = await db
    .prepare('SELECT * FROM study_sessions WHERE id = ?')
    .bind(id)
    .first<StudySession>();

  if (!session) throw new Error('Failed to create session');
  return session;
}

export async function getStudySession(
  db: D1Database,
  id: string,
  userId: string
): Promise<StudySession | null> {
  return db
    .prepare('SELECT * FROM study_sessions WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<StudySession>();
}

export async function completeStudySession(
  db: D1Database,
  id: string,
  userId: string
): Promise<StudySession | null> {
  // Verify ownership
  const existing = await getStudySession(db, id, userId);
  if (!existing) return null;

  // Count cards studied
  const countResult = await db
    .prepare('SELECT COUNT(*) as count FROM card_reviews WHERE session_id = ?')
    .bind(id)
    .first<{ count: number }>();

  const cardsStudied = countResult?.count || 0;

  await db
    .prepare(
      "UPDATE study_sessions SET completed_at = datetime('now'), cards_studied = ? WHERE id = ?"
    )
    .bind(cardsStudied, id)
    .run();

  return getStudySession(db, id, userId);
}

export async function getSessionWithReviews(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<StudySession & { reviews: (CardReview & { card: CardWithNote })[] } | null> {
  const session = await getStudySession(db, sessionId, userId);
  if (!session) return null;

  const reviews = await db
    .prepare(
      `SELECT cr.*, c.note_id, c.card_type, c.ease_factor, c.interval, c.repetitions,
              n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts, n.context, n.deck_id
       FROM card_reviews cr
       JOIN cards c ON cr.card_id = c.id
       JOIN notes n ON c.note_id = n.id
       WHERE cr.session_id = ?
       ORDER BY cr.reviewed_at ASC`
    )
    .bind(sessionId)
    .all();

  const mappedReviews = reviews.results.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    session_id: row.session_id as string,
    card_id: row.card_id as string,
    rating: row.rating as 0 | 1 | 2 | 3,
    time_spent_ms: row.time_spent_ms as number | null,
    user_answer: row.user_answer as string | null,
    recording_url: row.recording_url as string | null,
    reviewed_at: row.reviewed_at as string,
    card: {
      id: row.card_id as string,
      note_id: row.note_id as string,
      card_type: row.card_type as Card['card_type'],
      ease_factor: (row.ease_factor as number) || 2.5,
      interval: (row.interval as number) || 0,
      repetitions: (row.repetitions as number) || 0,
      next_review_at: null,
      queue: CardQueue.REVIEW,
      learning_step: 0,
      due_timestamp: null,
      created_at: '',
      updated_at: '',
      note: {
        id: row.note_id as string,
        deck_id: row.deck_id as string,
        hanzi: row.hanzi as string,
        pinyin: row.pinyin as string,
        english: row.english as string,
        audio_url: row.audio_url as string | null,
        audio_provider: (row.audio_provider as 'minimax' | 'gtts' | null) || null,
        fun_facts: row.fun_facts as string | null,
        context: row.context as string | null,
        created_at: '',
        updated_at: '',
      },
    },
  }));

  return { ...session, reviews: mappedReviews };
}

// ============ Note History ============

export interface NoteReviewHistory {
  card_type: string;
  card_stats: {
    ease_factor: number;
    interval: number;
    repetitions: number;
    next_review_at: string | null;
  };
  reviews: Array<{
    id: string;
    rating: number;
    time_spent_ms: number | null;
    user_answer: string | null;
    recording_url: string | null;
    reviewed_at: string;
  }>;
}

export async function getNoteReviewHistory(
  db: D1Database,
  noteId: string,
  userId: string
): Promise<NoteReviewHistory[] | null> {
  // First verify note exists and belongs to user
  const note = await getNoteById(db, noteId, userId);
  if (!note) return null;

  // Get card stats for this note
  const cards = await db
    .prepare(`
      SELECT id, card_type, ease_factor, interval, repetitions, next_review_at
      FROM cards
      WHERE note_id = ?
    `)
    .bind(noteId)
    .all<{
      id: string;
      card_type: string;
      ease_factor: number;
      interval: number;
      repetitions: number;
      next_review_at: string | null;
    }>();

  const cardStats: Record<string, NoteReviewHistory['card_stats']> = {};
  for (const card of cards.results) {
    cardStats[card.card_type] = {
      ease_factor: card.ease_factor,
      interval: card.interval,
      repetitions: card.repetitions,
      next_review_at: card.next_review_at,
    };
  }

  // Get all reviews for all cards of this note (from review_events table)
  const reviews = await db
    .prepare(`
      SELECT re.id, re.rating, re.time_spent_ms, re.user_answer, re.recording_url, re.reviewed_at, c.card_type
      FROM review_events re
      JOIN cards c ON re.card_id = c.id
      WHERE c.note_id = ?
      ORDER BY re.reviewed_at DESC
    `)
    .bind(noteId)
    .all<{
      id: string;
      rating: number;
      time_spent_ms: number | null;
      user_answer: string | null;
      recording_url: string | null;
      reviewed_at: string;
      card_type: string;
    }>();

  // Group by card type
  const byCardType: Record<string, NoteReviewHistory['reviews']> = {};
  for (const review of reviews.results) {
    if (!byCardType[review.card_type]) {
      byCardType[review.card_type] = [];
    }
    byCardType[review.card_type].push({
      id: review.id,
      rating: review.rating,
      time_spent_ms: review.time_spent_ms,
      user_answer: review.user_answer,
      recording_url: review.recording_url,
      reviewed_at: review.reviewed_at,
    });
  }

  // Return all card types (even those with no reviews yet)
  const allCardTypes = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
  return allCardTypes
    .filter(ct => cardStats[ct]) // Only include card types that exist
    .map((card_type) => ({
      card_type,
      card_stats: cardStats[card_type],
      reviews: byCardType[card_type] || [],
    }));
}

// ============ Note Questions ============

export async function createNoteQuestion(
  db: D1Database,
  noteId: string,
  question: string,
  answer: string
): Promise<NoteQuestion> {
  const id = generateId();
  await db
    .prepare(
      'INSERT INTO note_questions (id, note_id, question, answer) VALUES (?, ?, ?, ?)'
    )
    .bind(id, noteId, question, answer)
    .run();

  const noteQuestion = await db
    .prepare('SELECT * FROM note_questions WHERE id = ?')
    .bind(id)
    .first<NoteQuestion>();

  if (!noteQuestion) throw new Error('Failed to create note question');
  return noteQuestion;
}

export async function getNoteQuestions(
  db: D1Database,
  noteId: string,
  userId: string
): Promise<NoteQuestion[]> {
  // Verify note belongs to user first
  const note = await getNoteById(db, noteId, userId);
  if (!note) return [];

  const result = await db
    .prepare('SELECT * FROM note_questions WHERE note_id = ? ORDER BY asked_at DESC')
    .bind(noteId)
    .all<NoteQuestion>();
  return result.results;
}

// ============ Statistics ============

export async function getOverviewStats(db: D1Database, userId: string): Promise<{
  total_cards: number;
  cards_due_today: number;
  cards_studied_today: number;
  total_decks: number;
}> {
  const [totalCards, cardsDue, studiedToday, totalDecks] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) as count FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE d.user_id = ?
    `).bind(userId).first<{ count: number }>(),
    db.prepare(`
      SELECT COUNT(*) as count FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= date('now', '+1 day', 'start of day'))
    `).bind(userId).first<{ count: number }>(),
    db.prepare(`
      SELECT COUNT(*) as count FROM review_events
      WHERE user_id = ? AND date(reviewed_at) = date('now')
    `).bind(userId).first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM decks WHERE user_id = ?')
      .bind(userId).first<{ count: number }>(),
  ]);

  return {
    total_cards: totalCards?.count || 0,
    cards_due_today: cardsDue?.count || 0,
    cards_studied_today: studiedToday?.count || 0,
    total_decks: totalDecks?.count || 0,
  };
}

export async function getDeckStats(
  db: D1Database,
  deckId: string,
  userId: string
): Promise<{
  total_notes: number;
  total_cards: number;
  cards_due: number;
  cards_mastered: number;
} | null> {
  const deck = await getDeckById(db, deckId, userId);
  if (!deck) return null;

  const [totalNotes, totalCards, cardsDue, cardsMastered] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) as count FROM notes WHERE deck_id = ?')
      .bind(deckId)
      .first<{ count: number }>(),
    db
      .prepare(
        'SELECT COUNT(*) as count FROM cards c JOIN notes n ON c.note_id = n.id WHERE n.deck_id = ?'
      )
      .bind(deckId)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as count FROM cards c
         JOIN notes n ON c.note_id = n.id
         WHERE n.deck_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= date('now', '+1 day', 'start of day'))`
      )
      .bind(deckId)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as count FROM cards c
         JOIN notes n ON c.note_id = n.id
         WHERE n.deck_id = ? AND c.interval > 21`
      )
      .bind(deckId)
      .first<{ count: number }>(),
  ]);

  return {
    total_notes: totalNotes?.count || 0,
    total_cards: totalCards?.count || 0,
    cards_due: cardsDue?.count || 0,
    cards_mastered: cardsMastered?.count || 0,
  };
}

// ============ Anki-style Queue Management ============

/**
 * Get queue counts (new/learning/review) for display
 */
export async function getQueueCounts(
  db: D1Database,
  userId: string,
  deckId?: string
): Promise<QueueCounts> {
  const today = new Date().toISOString().split('T')[0];

  let deckFilter = '';
  const params: (string | number)[] = [userId];

  if (deckId) {
    deckFilter = 'AND n.deck_id = ?';
    params.push(deckId);
  }

  // Get new cards count (respecting daily limit)
  const newCardsQuery = `
    SELECT COUNT(*) as count FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue = 0
  `;

  // Get today's new card count for this user/deck
  const dailyCountQuery = deckId
    ? `SELECT COALESCE(SUM(new_cards_studied), 0) as studied FROM daily_counts
       WHERE user_id = ? AND deck_id = ? AND date = ?`
    : `SELECT COALESCE(SUM(new_cards_studied), 0) as studied FROM daily_counts
       WHERE user_id = ? AND date = ?`;

  // Get learning + relearning cards count (all in learning, not just due)
  const learningQuery = `
    SELECT COUNT(*) as count FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue IN (1, 3)
  `;

  // Get review cards count (due by end of today)
  const reviewQuery = `
    SELECT COUNT(*) as count FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue = 2
    AND c.next_review_at <= date('now', '+1 day', 'start of day')
  `;

  const [newResult, dailyResult, learningResult, reviewResult] = await Promise.all([
    db.prepare(newCardsQuery).bind(...params).first<{ count: number }>(),
    deckId
      ? db.prepare(dailyCountQuery).bind(userId, deckId, today).first<{ studied: number }>()
      : db.prepare(dailyCountQuery).bind(userId, today).first<{ studied: number }>(),
    db.prepare(learningQuery).bind(...params).first<{ count: number }>(),
    db.prepare(reviewQuery).bind(...params).first<{ count: number }>(),
  ]);

  // Get deck settings for new card limit
  let newCardsPerDay = DEFAULT_DECK_SETTINGS.new_cards_per_day;
  if (deckId) {
    const deck = await getDeckById(db, deckId, userId);
    if (deck) {
      newCardsPerDay = deck.new_cards_per_day;
    }
  }

  const totalNewCards = newResult?.count || 0;
  const studiedToday = dailyResult?.studied || 0;
  const remainingNew = Math.max(0, Math.min(totalNewCards, newCardsPerDay - studiedToday));

  return {
    new: remainingNew,
    learning: learningResult?.count || 0,
    review: reviewResult?.count || 0,
  };
}

/**
 * Get next card to study (priority: learning -> review -> new)
 */
export async function getNextStudyCard(
  db: D1Database,
  userId: string,
  deckId?: string,
  excludeNoteIds: string[] = [],
  ignoreDailyLimit: boolean = false
): Promise<CardWithNote | null> {
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];

  let deckFilter = '';
  const baseParams: string[] = [userId];

  if (deckId) {
    deckFilter = 'AND n.deck_id = ?';
    baseParams.push(deckId);
  }

  // Build note exclusion clause
  let noteExclude = '';
  if (excludeNoteIds.length > 0) {
    noteExclude = `AND c.note_id NOT IN (${excludeNoteIds.map(() => '?').join(',')})`;
  }

  const selectFields = `
    c.id, c.note_id, c.card_type, c.ease_factor, c.interval, c.repetitions,
    c.next_review_at, c.queue, c.learning_step, c.due_timestamp,
    c.created_at, c.updated_at,
    n.id as n_id, n.deck_id, n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts, n.context
  `;

  // Priority 1: Learning/Relearning cards due now
  const learningQuery = `
    SELECT ${selectFields} FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue IN (1, 3)
    AND c.due_timestamp <= ?
    ${noteExclude}
    ORDER BY c.due_timestamp ASC
    LIMIT 1
  `;

  const learningParams = [...baseParams, now.toString(), ...excludeNoteIds];
  const learningCard = await db.prepare(learningQuery).bind(...learningParams).first();

  if (learningCard) {
    return mapCardWithNote(learningCard);
  }

  // Priority 2: Review cards due by end of today
  const reviewQuery = `
    SELECT ${selectFields} FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue = 2
    AND c.next_review_at <= date('now', '+1 day', 'start of day')
    ${noteExclude}
    ORDER BY c.next_review_at ASC
    LIMIT 1
  `;

  const reviewParams = [...baseParams, ...excludeNoteIds];
  const reviewCard = await db.prepare(reviewQuery).bind(...reviewParams).first();

  if (reviewCard) {
    return mapCardWithNote(reviewCard);
  }

  // Priority 3: New cards (check daily limit)
  const dailyCountQuery = deckId
    ? `SELECT COALESCE(SUM(new_cards_studied), 0) as studied FROM daily_counts
       WHERE user_id = ? AND deck_id = ? AND date = ?`
    : `SELECT COALESCE(SUM(new_cards_studied), 0) as studied FROM daily_counts
       WHERE user_id = ? AND date = ?`;

  const dailyResult = deckId
    ? await db.prepare(dailyCountQuery).bind(userId, deckId, today).first<{ studied: number }>()
    : await db.prepare(dailyCountQuery).bind(userId, today).first<{ studied: number }>();

  const studiedToday = dailyResult?.studied || 0;

  // Get new card limit
  let newCardsPerDay = DEFAULT_DECK_SETTINGS.new_cards_per_day;
  if (deckId) {
    const deck = await getDeckById(db, deckId, userId);
    if (deck) {
      newCardsPerDay = deck.new_cards_per_day;
    }
  }

  if (!ignoreDailyLimit && studiedToday >= newCardsPerDay) {
    return null; // Daily limit reached
  }

  const newQuery = `
    SELECT ${selectFields} FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue = 0
    ${noteExclude}
    ORDER BY RANDOM()
    LIMIT 1
  `;

  const newParams = [...baseParams, ...excludeNoteIds];
  const newCard = await db.prepare(newQuery).bind(...newParams).first();

  if (newCard) {
    return mapCardWithNote(newCard);
  }

  return null;
}

/**
 * Helper to map query result to CardWithNote
 */
function mapCardWithNote(row: Record<string, unknown>): CardWithNote {
  return {
    id: row.id as string,
    note_id: row.note_id as string,
    card_type: row.card_type as Card['card_type'],
    ease_factor: (row.ease_factor as number) || 2.5,
    interval: (row.interval as number) || 0,
    repetitions: (row.repetitions as number) || 0,
    next_review_at: row.next_review_at as string | null,
    queue: (row.queue as CardQueue) ?? CardQueue.NEW,
    learning_step: (row.learning_step as number) || 0,
    due_timestamp: row.due_timestamp as number | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    note: {
      id: row.n_id as string || row.note_id as string,
      deck_id: row.deck_id as string,
      hanzi: row.hanzi as string,
      pinyin: row.pinyin as string,
      english: row.english as string,
      audio_url: row.audio_url as string | null,
      audio_provider: (row.audio_provider as 'minimax' | 'gtts' | null) || null,
      fun_facts: row.fun_facts as string | null,
      context: row.context as string | null,
      created_at: '',
      updated_at: '',
    },
  };
}

/**
 * Increment daily new card count
 */
export async function incrementDailyNewCount(
  db: D1Database,
  userId: string,
  deckId?: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const id = generateId();

  // Try to insert, update on conflict
  await db.prepare(`
    INSERT INTO daily_counts (id, user_id, deck_id, date, new_cards_studied)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(user_id, deck_id, date) DO UPDATE SET
      new_cards_studied = new_cards_studied + 1
  `).bind(id, userId, deckId || null, today).run();
}

/**
 * Update card with new scheduling values from Anki scheduler
 */
export async function updateCardSchedule(
  db: D1Database,
  cardId: string,
  result: SchedulerResult
): Promise<void> {
  await db.prepare(`
    UPDATE cards SET
      queue = ?,
      learning_step = ?,
      ease_factor = ?,
      interval = ?,
      repetitions = ?,
      due_timestamp = ?,
      next_review_at = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    result.queue,
    result.learning_step,
    result.ease_factor,
    result.interval,
    result.repetitions,
    result.due_timestamp,
    result.next_review_at?.toISOString() || null,
    cardId
  ).run();
}

/**
 * Get deck settings for scheduling
 */
export async function getDeckSettings(
  db: D1Database,
  deckId: string,
  userId: string
): Promise<DeckSettings | null> {
  const deck = await getDeckById(db, deckId, userId);
  if (!deck) return null;

  return {
    new_cards_per_day: deck.new_cards_per_day,
    learning_steps: parseLearningSteps(deck.learning_steps),
    graduating_interval: deck.graduating_interval,
    easy_interval: deck.easy_interval,
    relearning_steps: parseLearningSteps(deck.relearning_steps),
    starting_ease: deck.starting_ease / 100,
    minimum_ease: deck.minimum_ease / 100,
    maximum_ease: deck.maximum_ease / 100,
    interval_modifier: deck.interval_modifier / 100,
    hard_multiplier: deck.hard_multiplier / 100,
    easy_bonus: deck.easy_bonus / 100,
  };
}

/**
 * Update deck settings
 */
export async function updateDeckSettings(
  db: D1Database,
  deckId: string,
  userId: string,
  settings: Partial<{
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
  }>
): Promise<Deck | null> {
  const existing = await getDeckById(db, deckId, userId);
  if (!existing) return null;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (settings.new_cards_per_day !== undefined) {
    updates.push('new_cards_per_day = ?');
    values.push(settings.new_cards_per_day);
  }
  if (settings.learning_steps !== undefined) {
    updates.push('learning_steps = ?');
    values.push(settings.learning_steps);
  }
  if (settings.graduating_interval !== undefined) {
    updates.push('graduating_interval = ?');
    values.push(settings.graduating_interval);
  }
  if (settings.easy_interval !== undefined) {
    updates.push('easy_interval = ?');
    values.push(settings.easy_interval);
  }
  if (settings.relearning_steps !== undefined) {
    updates.push('relearning_steps = ?');
    values.push(settings.relearning_steps);
  }
  if (settings.starting_ease !== undefined) {
    updates.push('starting_ease = ?');
    values.push(settings.starting_ease);
  }
  if (settings.minimum_ease !== undefined) {
    updates.push('minimum_ease = ?');
    values.push(settings.minimum_ease);
  }
  if (settings.maximum_ease !== undefined) {
    updates.push('maximum_ease = ?');
    values.push(settings.maximum_ease);
  }
  if (settings.interval_modifier !== undefined) {
    updates.push('interval_modifier = ?');
    values.push(settings.interval_modifier);
  }
  if (settings.hard_multiplier !== undefined) {
    updates.push('hard_multiplier = ?');
    values.push(settings.hard_multiplier);
  }
  if (settings.easy_bonus !== undefined) {
    updates.push('easy_bonus = ?');
    values.push(settings.easy_bonus);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push("updated_at = datetime('now')");
  values.push(deckId);

  await db.prepare(`UPDATE decks SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getDeckById(db, deckId, userId);
}
