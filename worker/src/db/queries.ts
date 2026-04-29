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
  GradedReader,
  ReaderPage,
  GradedReaderWithPages,
  VocabularyItem,
  DifficultyLevel,
  NoteAudioRecording,
  HomeworkAssignment,
  HomeworkAssignmentWithDetails,
  HomeworkStatus,
  HomeworkRecording,
  HomeworkRecordingType,
  HomeworkFeedback,
  HomeworkFeedbackType,
  AppNotification,
  NotificationType,
} from '../types';
import { generateId, CARD_TYPES } from '../services/cards';
import { DeckSettings, DEFAULT_DECK_SETTINGS, parseLearningSteps, SchedulerResult } from '../services/anki-scheduler';
import type { GrammarPoint } from '../services/practice';

// Default for new cards per day (not part of FSRS scheduling)
const DEFAULT_NEW_CARDS_PER_DAY = 30;

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
    sentenceClue?: string;
    sentenceCluePinyin?: string;
    sentenceClueTranslation?: string;
    sentenceClueAudioUrl?: string;
    multipleChoiceOptions?: string;
    pinyinOnly?: number;
  },
  updates?: {
    hanzi?: string;
    pinyin?: string;
    english?: string;
    audioUrl?: string;
    audioProvider?: 'minimax' | 'gtts';
    funFacts?: string;
    sentenceClue?: string;
    sentenceCluePinyin?: string;
    sentenceClueTranslation?: string;
    sentenceClueAudioUrl?: string;
    multipleChoiceOptions?: string;
    pinyinOnly?: number;
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
    sentenceClue?: string;
    sentenceCluePinyin?: string;
    sentenceClueTranslation?: string;
    sentenceClueAudioUrl?: string;
    multipleChoiceOptions?: string;
    pinyinOnly?: number;
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
  if (actualUpdates.sentenceClue !== undefined) {
    fields.push('sentence_clue = ?');
    values.push(actualUpdates.sentenceClue);
  }
  if (actualUpdates.sentenceCluePinyin !== undefined) {
    fields.push('sentence_clue_pinyin = ?');
    values.push(actualUpdates.sentenceCluePinyin);
  }
  if (actualUpdates.sentenceClueTranslation !== undefined) {
    fields.push('sentence_clue_translation = ?');
    values.push(actualUpdates.sentenceClueTranslation);
  }
  if (actualUpdates.sentenceClueAudioUrl !== undefined) {
    fields.push('sentence_clue_audio_url = ?');
    values.push(actualUpdates.sentenceClueAudioUrl);
  }
  if (actualUpdates.multipleChoiceOptions !== undefined) {
    fields.push('multiple_choice_options = ?');
    values.push(actualUpdates.multipleChoiceOptions);
  }
  if (actualUpdates.pinyinOnly !== undefined) {
    fields.push('pinyin_only = ?');
    values.push(String(actualUpdates.pinyinOnly));
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
    SELECT c.*, n.hanzi, n.pinyin, n.english, n.audio_url, n.audio_provider, n.fun_facts, n.deck_id, n.sentence_clue, n.sentence_clue_pinyin, n.sentence_clue_translation, n.sentence_clue_audio_url, n.multiple_choice_options, n.pinyin_only
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
    // FSRS fields
    stability: (row.stability as number) || 0,
    difficulty: (row.difficulty as number) || 5,
    lapses: (row.lapses as number) || 0,
    // Legacy fields
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
      sentence_clue: row.sentence_clue as string | null,
      sentence_clue_pinyin: row.sentence_clue_pinyin as string | null,
      sentence_clue_translation: row.sentence_clue_translation as string | null,
      sentence_clue_audio_url: row.sentence_clue_audio_url as string | null,
      multiple_choice_options: row.multiple_choice_options as string | null,
      pinyin_only: (row.pinyin_only as number) || 0,
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
              n.hanzi, n.pinyin, n.english, n.audio_url, n.audio_provider, n.fun_facts, n.deck_id, n.sentence_clue, n.sentence_clue_pinyin, n.sentence_clue_translation, n.sentence_clue_audio_url, n.multiple_choice_options, n.pinyin_only
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
      // FSRS fields
      stability: (row.stability as number) || 0,
      difficulty: (row.difficulty as number) || 5,
      lapses: (row.lapses as number) || 0,
      // Legacy fields
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
        sentence_clue: row.sentence_clue as string | null,
        sentence_clue_pinyin: row.sentence_clue_pinyin as string | null,
        sentence_clue_translation: row.sentence_clue_translation as string | null,
        sentence_clue_audio_url: row.sentence_clue_audio_url as string | null,
        multiple_choice_options: row.multiple_choice_options as string | null,
        pinyin_only: (row.pinyin_only as number) || 0,
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
  cards_learning: number;
} | null> {
  const deck = await getDeckById(db, deckId, userId);
  if (!deck) return null;

  const [totalNotes, totalCards, cardsDue, cardsMastered, cardsLearning] = await Promise.all([
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
    db
      .prepare(
        `SELECT COUNT(*) as count FROM cards c
         JOIN notes n ON c.note_id = n.id
         WHERE n.deck_id = ? AND c.interval > 0 AND c.interval <= 21`
      )
      .bind(deckId)
      .first<{ count: number }>(),
  ]);

  return {
    total_notes: totalNotes?.count || 0,
    total_cards: totalCards?.count || 0,
    cards_due: cardsDue?.count || 0,
    cards_mastered: cardsMastered?.count || 0,
    cards_learning: cardsLearning?.count || 0,
  };
}

// ============ Anki-style Queue Management ============

/**
 * Get queue counts (new/learning/review) for display
 */
export async function getQueueCounts(
  db: D1Database,
  userId: string,
  deckId?: string,
  localDate?: string
): Promise<QueueCounts> {
  const today = localDate || new Date().toISOString().split('T')[0];

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
  let newCardsPerDay = DEFAULT_NEW_CARDS_PER_DAY;
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
  ignoreDailyLimit: boolean = false,
  localDate?: string
): Promise<CardWithNote | null> {
  const now = Date.now();
  const today = localDate || new Date().toISOString().split('T')[0];

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
    n.id as n_id, n.deck_id, n.hanzi, n.pinyin, n.english, n.audio_url, n.audio_provider, n.fun_facts, n.sentence_clue, n.sentence_clue_pinyin, n.sentence_clue_translation, n.sentence_clue_audio_url, n.multiple_choice_options, n.pinyin_only
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
  let newCardsPerDay = DEFAULT_NEW_CARDS_PER_DAY;
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
    // FSRS fields
    stability: (row.stability as number) || 0,
    difficulty: (row.difficulty as number) || 5,
    lapses: (row.lapses as number) || 0,
    // Legacy fields
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
      sentence_clue: row.sentence_clue as string | null,
      sentence_clue_pinyin: row.sentence_clue_pinyin as string | null,
      sentence_clue_translation: row.sentence_clue_translation as string | null,
      sentence_clue_audio_url: row.sentence_clue_audio_url as string | null,
      multiple_choice_options: row.multiple_choice_options as string | null,
      pinyin_only: (row.pinyin_only as number) || 0,
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
  deckId?: string,
  localDate?: string
): Promise<void> {
  const today = localDate || new Date().toISOString().split('T')[0];
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
 * Get deck settings for scheduling (FSRS)
 */
export async function getDeckSettings(
  db: D1Database,
  deckId: string,
  userId: string
): Promise<DeckSettings | null> {
  const deck = await getDeckById(db, deckId, userId);
  if (!deck) return null;

  // Parse FSRS weights if custom, otherwise use defaults
  let weights = DEFAULT_DECK_SETTINGS.w;
  if (deck.fsrs_weights) {
    try {
      weights = JSON.parse(deck.fsrs_weights);
    } catch {
      // Use defaults if parsing fails
    }
  }

  return {
    request_retention: deck.request_retention || 0.9,
    maximum_interval: deck.maximum_interval || 36500,
    enable_fuzz: true,
    w: weights,
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
    maximum_interval: number;
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
  if (settings.maximum_interval !== undefined) {
    updates.push('maximum_interval = ?');
    values.push(settings.maximum_interval);
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

// ============ Graded Readers ============

/**
 * Create a graded reader with pages
 */
export async function createGradedReader(
  db: D1Database,
  userId: string,
  data: {
    title_chinese: string;
    title_english: string;
    difficulty_level: DifficultyLevel;
    topic: string | null;
    source_deck_ids: string[];
    vocabulary_used: VocabularyItem[];
    pages: Array<{
      content_chinese: string;
      content_pinyin: string;
      content_english: string;
      image_url: string | null;
      image_prompt: string | null;
    }>;
  }
): Promise<GradedReaderWithPages> {
  const readerId = generateId();

  // Create the reader with status='ready' (since pages are provided)
  await db.prepare(`
    INSERT INTO graded_readers (
      id, user_id, title_chinese, title_english, difficulty_level,
      topic, source_deck_ids, vocabulary_used, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    readerId,
    userId,
    data.title_chinese,
    data.title_english,
    data.difficulty_level,
    data.topic,
    JSON.stringify(data.source_deck_ids),
    JSON.stringify(data.vocabulary_used),
    'ready'
  ).run();

  // Create pages
  const pages: ReaderPage[] = [];
  for (let i = 0; i < data.pages.length; i++) {
    const page = data.pages[i];
    const pageId = generateId();

    await db.prepare(`
      INSERT INTO reader_pages (
        id, reader_id, page_number, content_chinese, content_pinyin,
        content_english, image_url, image_prompt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      pageId,
      readerId,
      i + 1,
      page.content_chinese,
      page.content_pinyin,
      page.content_english,
      page.image_url,
      page.image_prompt
    ).run();

    pages.push({
      id: pageId,
      reader_id: readerId,
      page_number: i + 1,
      content_chinese: page.content_chinese,
      content_pinyin: page.content_pinyin,
      content_english: page.content_english,
      image_url: page.image_url,
      image_prompt: page.image_prompt,
    });
  }

  const reader = await db.prepare('SELECT * FROM graded_readers WHERE id = ?')
    .bind(readerId)
    .first<GradedReader & { source_deck_ids: string; vocabulary_used: string }>();

  if (!reader) throw new Error('Failed to create graded reader');

  return {
    ...reader,
    source_deck_ids: JSON.parse(reader.source_deck_ids) as string[],
    vocabulary_used: JSON.parse(reader.vocabulary_used) as VocabularyItem[],
    pages,
  };
}

/**
 * Get all graded readers for a user
 */
export async function getGradedReaders(
  db: D1Database,
  userId: string
): Promise<GradedReader[]> {
  const result = await db.prepare(`
    SELECT * FROM graded_readers
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).bind(userId).all<GradedReader & { source_deck_ids: string; vocabulary_used: string }>();

  return result.results.map(r => ({
    ...r,
    source_deck_ids: JSON.parse(r.source_deck_ids) as string[],
    vocabulary_used: JSON.parse(r.vocabulary_used) as VocabularyItem[],
  }));
}

/**
 * Get a graded reader with all its pages
 */
export async function getGradedReader(
  db: D1Database,
  readerId: string,
  userId: string
): Promise<GradedReaderWithPages | null> {
  const reader = await db.prepare(`
    SELECT * FROM graded_readers
    WHERE id = ? AND user_id = ?
  `).bind(readerId, userId).first<GradedReader & { source_deck_ids: string; vocabulary_used: string }>();

  if (!reader) return null;

  const pagesResult = await db.prepare(`
    SELECT * FROM reader_pages
    WHERE reader_id = ?
    ORDER BY page_number ASC
  `).bind(readerId).all<ReaderPage>();

  return {
    ...reader,
    source_deck_ids: JSON.parse(reader.source_deck_ids) as string[],
    vocabulary_used: JSON.parse(reader.vocabulary_used) as VocabularyItem[],
    pages: pagesResult.results,
  };
}

/**
 * Get a reader by ID (for internal use, e.g., queue handler)
 */
export async function getGradedReaderById(
  db: D1Database,
  readerId: string
): Promise<GradedReaderWithPages | null> {
  const reader = await db.prepare(`
    SELECT * FROM graded_readers
    WHERE id = ?
  `).bind(readerId).first<GradedReader & { source_deck_ids: string; vocabulary_used: string }>();

  if (!reader) return null;

  const pagesResult = await db.prepare(`
    SELECT * FROM reader_pages
    WHERE reader_id = ?
    ORDER BY page_number ASC
  `).bind(readerId).all<ReaderPage>();

  return {
    ...reader,
    source_deck_ids: JSON.parse(reader.source_deck_ids) as string[],
    vocabulary_used: JSON.parse(reader.vocabulary_used) as VocabularyItem[],
    pages: pagesResult.results,
  };
}

/**
 * Update a reader page's image URL
 */
export async function updateReaderPageImage(
  db: D1Database,
  pageId: string,
  imageUrl: string
): Promise<void> {
  await db.prepare(`
    UPDATE reader_pages SET image_url = ? WHERE id = ?
  `).bind(imageUrl, pageId).run();
}

/**
 * Create a pending reader (status='generating', no pages yet)
 */
export async function createPendingReader(
  db: D1Database,
  userId: string,
  data: {
    title_chinese: string;
    title_english: string;
    difficulty_level: DifficultyLevel;
    topic: string | null;
    source_deck_ids: string[];
    vocabulary_used: VocabularyItem[];
  }
): Promise<GradedReader> {
  const readerId = generateId();

  await db.prepare(`
    INSERT INTO graded_readers (
      id, user_id, title_chinese, title_english, difficulty_level,
      topic, source_deck_ids, vocabulary_used, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    readerId,
    userId,
    data.title_chinese,
    data.title_english,
    data.difficulty_level,
    data.topic,
    JSON.stringify(data.source_deck_ids),
    JSON.stringify(data.vocabulary_used),
    'generating'
  ).run();

  return {
    id: readerId,
    user_id: userId,
    title_chinese: data.title_chinese,
    title_english: data.title_english,
    difficulty_level: data.difficulty_level,
    topic: data.topic,
    source_deck_ids: data.source_deck_ids,
    vocabulary_used: data.vocabulary_used,
    status: 'generating',
    created_at: new Date().toISOString(),
  };
}

/**
 * Add pages to an existing reader
 */
export async function addReaderPages(
  db: D1Database,
  readerId: string,
  pages: Array<{
    content_chinese: string;
    content_pinyin: string;
    content_english: string;
    image_url: string | null;
    image_prompt: string | null;
  }>
): Promise<ReaderPage[]> {
  const createdPages: ReaderPage[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageId = generateId();

    await db.prepare(`
      INSERT INTO reader_pages (
        id, reader_id, page_number, content_chinese, content_pinyin,
        content_english, image_url, image_prompt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      pageId,
      readerId,
      i + 1,
      page.content_chinese,
      page.content_pinyin,
      page.content_english,
      page.image_url,
      page.image_prompt
    ).run();

    createdPages.push({
      id: pageId,
      reader_id: readerId,
      page_number: i + 1,
      content_chinese: page.content_chinese,
      content_pinyin: page.content_pinyin,
      content_english: page.content_english,
      image_url: page.image_url,
      image_prompt: page.image_prompt,
    });
  }

  return createdPages;
}

/**
 * Update reader status
 */
export async function updateReaderStatus(
  db: D1Database,
  readerId: string,
  status: 'generating' | 'ready' | 'failed'
): Promise<void> {
  await db.prepare(`
    UPDATE graded_readers SET status = ? WHERE id = ?
  `).bind(status, readerId).run();
}

/**
 * Delete a graded reader and all its pages
 */
export async function deleteGradedReader(
  db: D1Database,
  readerId: string,
  userId: string
): Promise<boolean> {
  // Verify ownership
  const reader = await db.prepare(`
    SELECT id FROM graded_readers WHERE id = ? AND user_id = ?
  `).bind(readerId, userId).first();

  if (!reader) return false;

  // Delete pages first (foreign key constraint)
  await db.prepare('DELETE FROM reader_pages WHERE reader_id = ?')
    .bind(readerId)
    .run();

  // Delete reader
  await db.prepare('DELETE FROM graded_readers WHERE id = ?')
    .bind(readerId)
    .run();

  return true;
}

/**
 * Get learned vocabulary from decks (cards with interval > 1 day)
 */
export async function getLearnedVocabulary(
  db: D1Database,
  userId: string,
  deckIds?: string[]
): Promise<VocabularyItem[]> {
  if (deckIds && deckIds.length === 0) return [];

  const deckFilter = deckIds
    ? `AND d.id IN (${deckIds.map(() => '?').join(',')})`
    : '';

  const result = await db.prepare(`
    SELECT DISTINCT n.hanzi, n.pinyin, n.english
    FROM notes n
    JOIN decks d ON n.deck_id = d.id
    JOIN cards c ON c.note_id = n.id
    WHERE d.user_id = ?
    ${deckFilter}
    AND c.interval >= 1
    GROUP BY n.id
  `).bind(userId, ...(deckIds ?? [])).all<{ hanzi: string; pinyin: string; english: string }>();

  return result.results;
}

// ============ Reader Editor ============

export async function createBlankReader(db: D1Database, userId: string, data: { title_chinese: string; title_english: string; difficulty_level: DifficultyLevel; topic: string | null }): Promise<GradedReaderWithPages> {
  const readerId = crypto.randomUUID();
  await db.prepare(`INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, topic, source_deck_ids, vocabulary_used, status, is_published, creator_role) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', 'ready', 0, 'tutor')`).bind(readerId, userId, data.title_chinese, data.title_english, data.difficulty_level, data.topic).run();
  return { id: readerId, user_id: userId, title_chinese: data.title_chinese, title_english: data.title_english, difficulty_level: data.difficulty_level, topic: data.topic, source_deck_ids: [], vocabulary_used: [], status: 'ready', is_published: 0, creator_role: 'tutor', created_at: new Date().toISOString(), pages: [] };
}

export async function updateGradedReader(db: D1Database, readerId: string, userId: string, data: { title_chinese?: string; title_english?: string; difficulty_level?: DifficultyLevel; topic?: string | null }): Promise<void> {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (data.title_chinese !== undefined) { sets.push('title_chinese = ?'); values.push(data.title_chinese); }
  if (data.title_english !== undefined) { sets.push('title_english = ?'); values.push(data.title_english); }
  if (data.difficulty_level !== undefined) { sets.push('difficulty_level = ?'); values.push(data.difficulty_level); }
  if (data.topic !== undefined) { sets.push('topic = ?'); values.push(data.topic); }
  if (sets.length === 0) return;
  values.push(readerId, userId);
  await db.prepare(`UPDATE graded_readers SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run();
}

export async function addReaderPage(db: D1Database, readerId: string, userId: string, pageData: { content_chinese: string; content_pinyin: string; content_english: string; image_prompt: string | null }): Promise<ReaderPage> {
  const reader = await db.prepare('SELECT id FROM graded_readers WHERE id = ? AND user_id = ?').bind(readerId, userId).first();
  if (!reader) throw new Error('Reader not found');
  const countResult = await db.prepare('SELECT COUNT(*) as count FROM reader_pages WHERE reader_id = ?').bind(readerId).first<{ count: number }>();
  const pageNumber = (countResult?.count || 0) + 1;
  const pageId = crypto.randomUUID();
  await db.prepare('INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english, image_url, image_prompt) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').bind(pageId, readerId, pageNumber, pageData.content_chinese, pageData.content_pinyin, pageData.content_english, pageData.image_prompt).run();
  return { id: pageId, reader_id: readerId, page_number: pageNumber, content_chinese: pageData.content_chinese, content_pinyin: pageData.content_pinyin, content_english: pageData.content_english, image_url: null, image_prompt: pageData.image_prompt };
}

export async function updateReaderPage(db: D1Database, pageId: string, readerId: string, userId: string, data: { content_chinese?: string; content_pinyin?: string; content_english?: string; image_prompt?: string | null }): Promise<void> {
  const reader = await db.prepare('SELECT id FROM graded_readers WHERE id = ? AND user_id = ?').bind(readerId, userId).first();
  if (!reader) throw new Error('Reader not found');
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (data.content_chinese !== undefined) { sets.push('content_chinese = ?'); values.push(data.content_chinese); }
  if (data.content_pinyin !== undefined) { sets.push('content_pinyin = ?'); values.push(data.content_pinyin); }
  if (data.content_english !== undefined) { sets.push('content_english = ?'); values.push(data.content_english); }
  if (data.image_prompt !== undefined) { sets.push('image_prompt = ?'); values.push(data.image_prompt); }
  if (sets.length === 0) return;
  values.push(pageId, readerId);
  await db.prepare(`UPDATE reader_pages SET ${sets.join(', ')} WHERE id = ? AND reader_id = ?`).bind(...values).run();
}

export async function deleteReaderPage(db: D1Database, pageId: string, readerId: string, userId: string): Promise<void> {
  const reader = await db.prepare('SELECT id FROM graded_readers WHERE id = ? AND user_id = ?').bind(readerId, userId).first();
  if (!reader) throw new Error('Reader not found');
  const page = await db.prepare('SELECT page_number FROM reader_pages WHERE id = ? AND reader_id = ?').bind(pageId, readerId).first<{ page_number: number }>();
  if (!page) throw new Error('Page not found');
  await db.prepare('DELETE FROM reader_pages WHERE id = ? AND reader_id = ?').bind(pageId, readerId).run();
  await db.prepare('UPDATE reader_pages SET page_number = page_number - 1 WHERE reader_id = ? AND page_number > ?').bind(readerId, page.page_number).run();
}

export async function reorderReaderPages(db: D1Database, readerId: string, userId: string, pageIds: string[]): Promise<void> {
  const reader = await db.prepare('SELECT id FROM graded_readers WHERE id = ? AND user_id = ?').bind(readerId, userId).first();
  if (!reader) throw new Error('Reader not found');
  for (let i = 0; i < pageIds.length; i++) {
    await db.prepare('UPDATE reader_pages SET page_number = ? WHERE id = ? AND reader_id = ?').bind(i + 1, pageIds[i], readerId).run();
  }
}

// ============ Note Audio Recordings ============

export async function getNoteAudioRecordings(
  db: D1Database,
  noteId: string
): Promise<NoteAudioRecording[]> {
  const result = await db.prepare(`
    SELECT nar.*, u.name as creator_name
    FROM note_audio_recordings nar
    LEFT JOIN users u ON nar.created_by = u.id
    WHERE nar.note_id = ?
    ORDER BY nar.is_primary DESC, nar.created_at ASC
  `).bind(noteId).all<NoteAudioRecording & { creator_name: string | null }>();

  return result.results.map(r => ({
    id: r.id,
    note_id: r.note_id,
    audio_url: r.audio_url,
    provider: r.provider,
    is_primary: !!r.is_primary,
    speaker_name: r.speaker_name,
    created_by: r.created_by,
    created_at: r.created_at,
  }));
}

export async function addNoteAudioRecording(
  db: D1Database,
  noteId: string,
  audioUrl: string,
  provider: string,
  speakerName: string | null,
  createdBy: string | null
): Promise<NoteAudioRecording> {
  const id = generateId();

  await db.prepare(`
    INSERT INTO note_audio_recordings (id, note_id, audio_url, provider, is_primary, speaker_name, created_by)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).bind(id, noteId, audioUrl, provider, speakerName, createdBy).run();

  const recording = await db.prepare('SELECT * FROM note_audio_recordings WHERE id = ?')
    .bind(id)
    .first<NoteAudioRecording>();

  if (!recording) throw new Error('Failed to create audio recording');
  return { ...recording, is_primary: !!recording.is_primary };
}

export async function setAudioRecordingPrimary(
  db: D1Database,
  noteId: string,
  recordingId: string
): Promise<void> {
  // Unset all primary flags for this note
  await db.prepare(`
    UPDATE note_audio_recordings SET is_primary = 0 WHERE note_id = ?
  `).bind(noteId).run();

  // Set the specified recording as primary
  await db.prepare(`
    UPDATE note_audio_recordings SET is_primary = 1 WHERE id = ? AND note_id = ?
  `).bind(recordingId, noteId).run();

  // Update notes.audio_url to match the new primary
  const recording = await db.prepare('SELECT audio_url, provider FROM note_audio_recordings WHERE id = ?')
    .bind(recordingId)
    .first<{ audio_url: string; provider: string }>();

  if (recording) {
    await db.prepare(`
      UPDATE notes SET audio_url = ?, audio_provider = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(recording.audio_url, recording.provider, noteId).run();
  }
}

export async function deleteAudioRecording(
  db: D1Database,
  recordingId: string
): Promise<{ was_primary: boolean; note_id: string; audio_url: string } | null> {
  const recording = await db.prepare('SELECT * FROM note_audio_recordings WHERE id = ?')
    .bind(recordingId)
    .first<NoteAudioRecording>();

  if (!recording) return null;

  const wasPrimary = !!recording.is_primary;
  const noteId = recording.note_id;
  const audioUrl = recording.audio_url;

  await db.prepare('DELETE FROM note_audio_recordings WHERE id = ?')
    .bind(recordingId)
    .run();

  // If we deleted the primary, promote the next one
  if (wasPrimary) {
    const next = await db.prepare(`
      SELECT id, audio_url, provider FROM note_audio_recordings
      WHERE note_id = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).bind(noteId).first<{ id: string; audio_url: string; provider: string }>();

    if (next) {
      await db.prepare('UPDATE note_audio_recordings SET is_primary = 1 WHERE id = ?')
        .bind(next.id).run();
      await db.prepare(`
        UPDATE notes SET audio_url = ?, audio_provider = ?, updated_at = datetime('now') WHERE id = ?
      `).bind(next.audio_url, next.provider, noteId).run();
    } else {
      // No recordings left, clear the note's audio_url
      await db.prepare(`
        UPDATE notes SET audio_url = NULL, audio_provider = NULL, updated_at = datetime('now') WHERE id = ?
      `).bind(noteId).run();
    }
  }

  return { was_primary: wasPrimary, note_id: noteId, audio_url: audioUrl };
}

// ============ Homework Assignments ============

export async function createHomeworkAssignment(
  db: D1Database,
  tutorId: string,
  studentId: string,
  readerId: string,
  notes: string | null,
): Promise<HomeworkAssignment> {
  const id = generateId();
  await db.prepare(`
    INSERT INTO homework_assignments (id, tutor_id, student_id, reader_id, notes)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, tutorId, studentId, readerId, notes).run();

  const row = await db.prepare('SELECT * FROM homework_assignments WHERE id = ?')
    .bind(id).first<HomeworkAssignment>();
  return row!;
}

export async function getHomeworkAssignments(
  db: D1Database,
  userId: string,
): Promise<HomeworkAssignmentWithDetails[]> {
  const rows = await db.prepare(`
    SELECT
      h.*,
      r.title_chinese AS reader_title_chinese,
      r.title_english AS reader_title_english,
      r.difficulty_level AS reader_difficulty_level,
      t.name AS tutor_name,
      t.email AS tutor_email,
      s.name AS student_name,
      s.email AS student_email
    FROM homework_assignments h
    JOIN graded_readers r ON h.reader_id = r.id
    JOIN users t ON h.tutor_id = t.id
    JOIN users s ON h.student_id = s.id
    WHERE h.tutor_id = ? OR h.student_id = ?
    ORDER BY h.assigned_at DESC
  `).bind(userId, userId).all<HomeworkAssignmentWithDetails>();
  return rows.results;
}

export async function getHomeworkAssignment(
  db: D1Database,
  id: string,
  userId: string,
): Promise<HomeworkAssignmentWithDetails | null> {
  return db.prepare(`
    SELECT
      h.*,
      r.title_chinese AS reader_title_chinese,
      r.title_english AS reader_title_english,
      r.difficulty_level AS reader_difficulty_level,
      t.name AS tutor_name,
      t.email AS tutor_email,
      s.name AS student_name,
      s.email AS student_email
    FROM homework_assignments h
    JOIN graded_readers r ON h.reader_id = r.id
    JOIN users t ON h.tutor_id = t.id
    JOIN users s ON h.student_id = s.id
    WHERE h.id = ? AND (h.tutor_id = ? OR h.student_id = ?)
  `).bind(id, userId, userId).first<HomeworkAssignmentWithDetails>();
}

export async function updateHomeworkStatus(
  db: D1Database,
  id: string,
  userId: string,
  status: HomeworkStatus,
): Promise<boolean> {
  const completedAt = status === 'completed' ? "datetime('now')" : 'NULL';
  const result = await db.prepare(`
    UPDATE homework_assignments
    SET status = ?, completed_at = ${completedAt}
    WHERE id = ? AND student_id = ?
  `).bind(status, id, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function deleteHomeworkAssignment(
  db: D1Database,
  id: string,
  tutorId: string,
): Promise<boolean> {
  const result = await db.prepare(`
    DELETE FROM homework_assignments
    WHERE id = ? AND tutor_id = ?
  `).bind(id, tutorId).run();
  return (result.meta?.changes ?? 0) > 0;
}

// ============ Homework Recordings ============

export async function createHomeworkRecording(
  db: D1Database,
  homeworkId: string,
  audioUrl: string,
  type: HomeworkRecordingType,
  pageId: string | null,
  durationMs: number | null,
): Promise<HomeworkRecording> {
  const id = generateId();
  await db.prepare(`
    INSERT INTO homework_recordings (id, homework_id, page_id, audio_url, duration_ms, type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, homeworkId, pageId, audioUrl, durationMs, type).run();

  const row = await db.prepare('SELECT * FROM homework_recordings WHERE id = ?')
    .bind(id).first<HomeworkRecording>();
  return row!;
}

export async function getHomeworkRecordings(
  db: D1Database,
  homeworkId: string,
): Promise<HomeworkRecording[]> {
  const rows = await db.prepare(`
    SELECT * FROM homework_recordings
    WHERE homework_id = ?
    ORDER BY recorded_at ASC
  `).bind(homeworkId).all<HomeworkRecording>();
  return rows.results;
}

export async function deleteHomeworkRecording(
  db: D1Database,
  recordingId: string,
  homeworkId: string,
): Promise<HomeworkRecording | null> {
  const row = await db.prepare(
    'SELECT * FROM homework_recordings WHERE id = ? AND homework_id = ?'
  ).bind(recordingId, homeworkId).first<HomeworkRecording>();
  if (!row) return null;

  await db.prepare(
    'DELETE FROM homework_recordings WHERE id = ? AND homework_id = ?'
  ).bind(recordingId, homeworkId).run();
  return row;
}

export async function submitHomework(
  db: D1Database,
  id: string,
  studentId: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE homework_assignments
    SET status = 'completed', completed_at = datetime('now')
    WHERE id = ? AND student_id = ? AND status != 'completed'
  `).bind(id, studentId).run();
  return (result.meta?.changes ?? 0) > 0;
}

// ============ Homework Feedback ============

export async function createHomeworkFeedback(
  db: D1Database,
  homeworkId: string,
  tutorId: string,
  type: HomeworkFeedbackType,
  pageId: string | null,
  textFeedback: string | null,
  audioFeedbackUrl: string | null,
  rating: number | null,
): Promise<HomeworkFeedback> {
  const id = generateId();
  await db.prepare(`
    INSERT INTO homework_feedback (id, homework_id, tutor_id, page_id, text_feedback, audio_feedback_url, rating, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, homeworkId, tutorId, pageId, textFeedback, audioFeedbackUrl, rating, type).run();

  const row = await db.prepare('SELECT * FROM homework_feedback WHERE id = ?')
    .bind(id).first<HomeworkFeedback>();
  return row!;
}

export async function getHomeworkFeedback(
  db: D1Database,
  homeworkId: string,
): Promise<HomeworkFeedback[]> {
  const rows = await db.prepare(`
    SELECT * FROM homework_feedback
    WHERE homework_id = ?
    ORDER BY created_at ASC
  `).bind(homeworkId).all<HomeworkFeedback>();
  return rows.results;
}

export async function updateHomeworkFeedback(
  db: D1Database,
  feedbackId: string,
  tutorId: string,
  textFeedback: string | null,
  audioFeedbackUrl: string | null,
  rating: number | null,
): Promise<HomeworkFeedback | null> {
  const result = await db.prepare(`
    UPDATE homework_feedback
    SET text_feedback = ?, audio_feedback_url = ?, rating = ?
    WHERE id = ? AND tutor_id = ?
  `).bind(textFeedback, audioFeedbackUrl, rating, feedbackId, tutorId).run();

  if ((result.meta?.changes ?? 0) === 0) return null;

  return db.prepare('SELECT * FROM homework_feedback WHERE id = ?')
    .bind(feedbackId).first<HomeworkFeedback>();
}

export async function deleteHomeworkFeedback(
  db: D1Database,
  feedbackId: string,
  tutorId: string,
): Promise<HomeworkFeedback | null> {
  const row = await db.prepare(
    'SELECT * FROM homework_feedback WHERE id = ? AND tutor_id = ?'
  ).bind(feedbackId, tutorId).first<HomeworkFeedback>();
  if (!row) return null;

  await db.prepare(
    'DELETE FROM homework_feedback WHERE id = ? AND tutor_id = ?'
  ).bind(feedbackId, tutorId).run();
  return row;
}

export async function markHomeworkReviewed(
  db: D1Database,
  id: string,
  tutorId: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE homework_assignments
    SET status = 'reviewed'
    WHERE id = ? AND tutor_id = ? AND status = 'completed'
  `).bind(id, tutorId).run();
  return (result.meta?.changes ?? 0) > 0;
}

// ============ Notifications ============

export async function createNotification(
  db: D1Database,
  userId: string,
  type: NotificationType,
  title: string,
  message: string | null,
  homeworkId: string | null,
  opts?: {
    note_id?: string | null;
    conversation_id?: string | null;
    relationship_id?: string | null;
  },
): Promise<AppNotification> {
  const id = generateId();
  await db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, homework_id, note_id, conversation_id, relationship_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, type, title, message, homeworkId,
    opts?.note_id ?? null,
    opts?.conversation_id ?? null,
    opts?.relationship_id ?? null,
  ).run();

  const row = await db.prepare('SELECT * FROM notifications WHERE id = ?')
    .bind(id).first<AppNotification>();
  return row!;
}

export async function getNotifications(
  db: D1Database,
  userId: string,
  limit: number = 50,
): Promise<AppNotification[]> {
  const rows = await db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(userId, limit).all<AppNotification>();
  return rows.results;
}

export async function getUnreadNotificationCount(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) as count FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).bind(userId).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function markNotificationRead(
  db: D1Database,
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE notifications SET is_read = 1
    WHERE id = ? AND user_id = ?
  `).bind(notificationId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function getRecentUnreadChatNotification(
  db: D1Database,
  userId: string,
  conversationId: string,
): Promise<AppNotification | null> {
  return db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? AND type = 'new_chat_message' AND conversation_id = ? AND is_read = 0
      AND created_at >= datetime('now', '-5 minutes')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId, conversationId).first<AppNotification>();
}

export async function updateNotificationMessage(
  db: D1Database,
  notificationId: string,
  title: string,
  message: string,
): Promise<void> {
  await db.prepare(`
    UPDATE notifications SET title = ?, message = ?, created_at = datetime('now')
    WHERE id = ?
  `).bind(title, message, notificationId).run();
}

export async function markNotificationsReadByConversation(
  db: D1Database,
  userId: string,
  conversationId: string,
): Promise<number> {
  const result = await db.prepare(`
    UPDATE notifications SET is_read = 1
    WHERE user_id = ? AND conversation_id = ? AND is_read = 0
  `).bind(userId, conversationId).run();
  return result.meta?.changes ?? 0;
}

export async function markAllNotificationsRead(
  db: D1Database,
  userId: string,
): Promise<number> {
  const result = await db.prepare(`
    UPDATE notifications SET is_read = 1
    WHERE user_id = ? AND is_read = 0
  `).bind(userId).run();
  return result.meta?.changes ?? 0;
}

// ============ Grammar Practice ============

function rowToGrammarPoint(r: {
  id: string;
  level: string;
  title: string;
  pattern: string;
  explanation: string;
  cgw_url: string | null;
  seed_examples: string;
  order_index: number;
}): GrammarPoint {
  return { ...r, seed_examples: JSON.parse(r.seed_examples) };
}

export async function listGrammarPoints(db: D1Database): Promise<GrammarPoint[]> {
  const result = await db.prepare(`
    SELECT id, level, title, pattern, explanation, cgw_url, seed_examples, order_index
    FROM grammar_points ORDER BY level, order_index
  `).all();
  return result.results.map((r) => rowToGrammarPoint(r as any));
}

export async function getGrammarPoint(db: D1Database, id: string): Promise<GrammarPoint | null> {
  const r = await db.prepare(`
    SELECT id, level, title, pattern, explanation, cgw_url, seed_examples, order_index
    FROM grammar_points WHERE id = ?
  `).bind(id).first();
  return r ? rowToGrammarPoint(r as any) : null;
}

export interface GrammarProgressRow {
  grammar_point_id: string;
  status: 'new' | 'learning' | 'known';
  correct_count: number;
  attempt_count: number;
  introduced_at: string | null;
  last_practiced_at: string | null;
}

export async function getGrammarProgress(
  db: D1Database,
  userId: string,
): Promise<GrammarProgressRow[]> {
  const result = await db.prepare(`
    SELECT grammar_point_id, status, correct_count, attempt_count, introduced_at, last_practiced_at
    FROM grammar_progress WHERE user_id = ?
  `).bind(userId).all<GrammarProgressRow>();
  return result.results;
}

// ---- Lesson notes (external tutor homework as generation context) ----

export interface LessonNote {
  id: string;
  raw_text: string;
  given_at: string | null;
  created_at: string;
  files: Array<{ id: string; r2_key: string; filename: string; content_type: string | null; size: number | null }>;
}

export async function createLessonNote(
  db: D1Database,
  userId: string,
  rawText: string,
  givenAt: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO lesson_notes (id, user_id, raw_text, given_at) VALUES (?, ?, ?, ?)
  `).bind(id, userId, rawText, givenAt).run();
  return id;
}

export async function addLessonNoteFile(
  db: D1Database,
  lessonNoteId: string,
  file: { r2_key: string; filename: string; content_type: string | null; size: number | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO lesson_note_files (id, lesson_note_id, r2_key, filename, content_type, size)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, lessonNoteId, file.r2_key, file.filename, file.content_type, file.size).run();
  return id;
}

export async function listLessonNotes(
  db: D1Database,
  userId: string,
  limit = 20,
): Promise<LessonNote[]> {
  const notes = await db.prepare(`
    SELECT id, raw_text, given_at, created_at FROM lesson_notes
    WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, limit).all<{ id: string; raw_text: string; given_at: string | null; created_at: string }>();
  if (notes.results.length === 0) return [];
  const ids = notes.results.map((n) => n.id);
  const files = await db.prepare(`
    SELECT id, lesson_note_id, r2_key, filename, content_type, size FROM lesson_note_files
    WHERE lesson_note_id IN (${ids.map(() => '?').join(',')})
  `).bind(...ids).all<{ id: string; lesson_note_id: string; r2_key: string; filename: string; content_type: string | null; size: number | null }>();
  const byNote = new Map<string, LessonNote['files']>();
  for (const f of files.results) {
    const arr = byNote.get(f.lesson_note_id) ?? [];
    arr.push({ id: f.id, r2_key: f.r2_key, filename: f.filename, content_type: f.content_type, size: f.size });
    byNote.set(f.lesson_note_id, arr);
  }
  return notes.results.map((n) => ({ ...n, files: byNote.get(n.id) ?? [] }));
}

export async function lessonNoteOwnedBy(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const r = await db.prepare(`SELECT 1 FROM lesson_notes WHERE id = ? AND user_id = ?`)
    .bind(id, userId).first();
  return !!r;
}

export async function deleteLessonNote(db: D1Database, id: string, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM lesson_notes WHERE id = ? AND user_id = ?`).bind(id, userId).run();
}

export async function getRecentLessonNotesText(
  db: D1Database,
  userId: string,
  limit = 3,
): Promise<string> {
  const r = await db.prepare(`
    SELECT raw_text, given_at FROM lesson_notes
    WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, limit).all<{ raw_text: string; given_at: string | null }>();
  return r.results
    .map((n) => (n.given_at ? `[${n.given_at}]\n${n.raw_text}` : n.raw_text))
    .join('\n\n---\n\n');
}

// ---- Roleplay + daily activities ----

export async function createRoleplaySession(
  db: D1Database,
  userId: string,
  sit: { id: string; scenario: string; ai_role: string; user_role: string; goal: string },
  persona: { name: string; voice_id: string; appearance: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO roleplay_sessions
      (id, user_id, situation_id, scenario, ai_role, user_role, goal, character_prompt, voice_id, persona_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, sit.id, sit.scenario, sit.ai_role, sit.user_role, sit.goal,
    persona.appearance, persona.voice_id, persona.name,
  ).run();
  return id;
}

export async function getRoleplaySession(
  db: D1Database,
  id: string,
  userId: string,
): Promise<{ id: string; situation_id: string; scenario: string; ai_role: string; user_role: string; goal: string; character_prompt: string | null; voice_id: string | null; persona_name: string | null; completed_at: string | null } | null> {
  return await db.prepare(`
    SELECT id, situation_id, scenario, ai_role, user_role, goal, character_prompt, voice_id, persona_name, completed_at
    FROM roleplay_sessions WHERE id = ? AND user_id = ?
  `).bind(id, userId).first();
}

export async function listRoleplayMessages(
  db: D1Database,
  sessionId: string,
): Promise<Array<{ id: string; role: 'ai' | 'user'; hanzi: string; pinyin: string | null; english: string | null; chunks_json: string | null; image_url: string | null; revealed: number }>> {
  const r = await db.prepare(`
    SELECT id, role, hanzi, pinyin, english, chunks_json, image_url, revealed
    FROM roleplay_messages WHERE session_id = ? ORDER BY created_at
  `).bind(sessionId).all();
  return r.results as any;
}

export async function addRoleplayMessage(
  db: D1Database,
  sessionId: string,
  m: { role: 'ai' | 'user'; hanzi: string; pinyin?: string | null; english?: string | null; chunks_json?: string | null; image_url?: string | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO roleplay_messages (id, session_id, role, hanzi, pinyin, english, chunks_json, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, sessionId, m.role, m.hanzi, m.pinyin ?? null, m.english ?? null, m.chunks_json ?? null, m.image_url ?? null).run();
  return id;
}

export async function setRoleplayMessageImage(
  db: D1Database,
  messageId: string,
  imageUrl: string,
): Promise<void> {
  await db.prepare(`UPDATE roleplay_messages SET image_url = ? WHERE id = ?`).bind(imageUrl, messageId).run();
}

export async function markRoleplayRevealed(
  db: D1Database,
  messageId: string,
  userId: string,
): Promise<void> {
  await db.prepare(`
    UPDATE roleplay_messages SET revealed = 1
    WHERE id = ? AND session_id IN (SELECT id FROM roleplay_sessions WHERE user_id = ?)
  `).bind(messageId, userId).run();
}

export async function completeRoleplaySession(db: D1Database, id: string, userId: string): Promise<void> {
  await db.prepare(`UPDATE roleplay_sessions SET completed_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(id, userId).run();
}

export async function recordDailyActivity(
  db: D1Database,
  userId: string,
  activity: 'reader' | 'roleplay',
  refId: string | null,
): Promise<void> {
  await db.prepare(`
    INSERT INTO daily_activities (id, user_id, activity, ref_id) VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId, activity, refId).run();
}

export async function getDailyReader(
  db: D1Database,
  userId: string,
): Promise<{ reader_id: string; situation_id: string; status: string } | null> {
  const r = await db.prepare(`
    SELECT dr.reader_id, dr.situation_id, COALESCE(gr.status, 'generating') AS status
    FROM daily_readers dr
    LEFT JOIN graded_readers gr ON gr.id = dr.reader_id
    WHERE dr.user_id = ? AND dr.date = date('now')
  `).bind(userId).first<{ reader_id: string; situation_id: string; status: string }>();
  return r ?? null;
}

export async function reserveDailyReader(
  db: D1Database,
  userId: string,
  situationId: string,
): Promise<boolean> {
  const r = await db.prepare(`
    INSERT OR IGNORE INTO daily_readers (user_id, date, situation_id, reader_id)
    VALUES (?, date('now'), ?, '')
  `).bind(userId, situationId).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function setDailyReaderId(
  db: D1Database,
  userId: string,
  readerId: string,
): Promise<void> {
  await db.prepare(`
    UPDATE daily_readers SET reader_id = ? WHERE user_id = ? AND date = date('now')
  `).bind(readerId, userId).run();
}

export async function getUserDeckIds(db: D1Database, userId: string): Promise<string[]> {
  const r = await db.prepare(`SELECT id FROM decks WHERE user_id = ?`).bind(userId).all<{ id: string }>();
  return r.results.map((d) => d.id);
}

export async function getDailyActivityStatus(
  db: D1Database,
  userId: string,
): Promise<{ reader: boolean; roleplay: boolean }> {
  const r = await db.prepare(`
    SELECT activity FROM daily_activities
    WHERE user_id = ? AND date(completed_at) = date('now')
  `).bind(userId).all<{ activity: string }>();
  const set = new Set(r.results.map((x) => x.activity));
  return { reader: set.has('reader'), roleplay: set.has('roleplay') };
}

export async function practiceCompletedToday(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const r = await db.prepare(`
    SELECT 1 FROM practice_sessions
    WHERE user_id = ? AND completed_at IS NOT NULL AND date(completed_at) = date('now')
    LIMIT 1
  `).bind(userId).first();
  return !!r;
}

export async function getNextGrammarPoint(
  db: D1Database,
  userId: string,
): Promise<GrammarPoint | null> {
  // Prefer the oldest 'learning' point not practiced today; otherwise the first 'new' point by order.
  const learning = await db.prepare(`
    SELECT gp.id, gp.level, gp.title, gp.pattern, gp.explanation, gp.cgw_url, gp.seed_examples, gp.order_index
    FROM grammar_points gp
    JOIN grammar_progress p ON p.grammar_point_id = gp.id
    WHERE p.user_id = ? AND p.status = 'learning'
      AND (p.last_practiced_at IS NULL OR date(p.last_practiced_at) < date('now'))
    ORDER BY p.last_practiced_at ASC NULLS FIRST, gp.order_index ASC
    LIMIT 1
  `).bind(userId).first();
  if (learning) return rowToGrammarPoint(learning as any);

  const fresh = await db.prepare(`
    SELECT gp.id, gp.level, gp.title, gp.pattern, gp.explanation, gp.cgw_url, gp.seed_examples, gp.order_index
    FROM grammar_points gp
    LEFT JOIN grammar_progress p ON p.grammar_point_id = gp.id AND p.user_id = ?
    WHERE p.id IS NULL
    ORDER BY gp.level, gp.order_index
    LIMIT 1
  `).bind(userId).first();
  return fresh ? rowToGrammarPoint(fresh as any) : null;
}

export async function createPracticeSession(
  db: D1Database,
  userId: string,
  grammarPointId: string,
  exercisesJson: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO practice_sessions (id, user_id, grammar_point_id, exercises_json)
    VALUES (?, ?, ?, ?)
  `).bind(id, userId, grammarPointId, exercisesJson).run();
  await db.prepare(`
    INSERT INTO grammar_progress (id, user_id, grammar_point_id, status, introduced_at)
    VALUES (?, ?, ?, 'learning', datetime('now'))
    ON CONFLICT(user_id, grammar_point_id) DO NOTHING
  `).bind(crypto.randomUUID(), userId, grammarPointId).run();
  return id;
}

export async function getPracticeSession(
  db: D1Database,
  sessionId: string,
  userId: string,
): Promise<{ id: string; grammar_point_id: string; exercises_json: string; completed_at: string | null } | null> {
  return await db.prepare(`
    SELECT id, grammar_point_id, exercises_json, completed_at
    FROM practice_sessions WHERE id = ? AND user_id = ?
  `).bind(sessionId, userId).first();
}

export async function recordPracticeAttempt(
  db: D1Database,
  data: {
    sessionId: string;
    userId: string;
    grammarPointId: string;
    exerciseType: string;
    exerciseIndex: number;
    promptJson: string;
    userAnswer: string | null;
    isCorrect: boolean | null;
    feedbackJson: string | null;
  },
): Promise<void> {
  await db.prepare(`
    INSERT INTO practice_attempts
      (id, session_id, user_id, grammar_point_id, exercise_type, exercise_index, prompt_json, user_answer, is_correct, feedback_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    data.sessionId,
    data.userId,
    data.grammarPointId,
    data.exerciseType,
    data.exerciseIndex,
    data.promptJson,
    data.userAnswer,
    data.isCorrect === null ? null : data.isCorrect ? 1 : 0,
    data.feedbackJson,
  ).run();
}

export async function completePracticeSession(
  db: D1Database,
  sessionId: string,
  userId: string,
  grammarPointId: string,
  correctDelta: number,
  attemptDelta: number,
): Promise<void> {
  await db.prepare(`
    UPDATE practice_sessions SET completed_at = datetime('now') WHERE id = ? AND user_id = ?
  `).bind(sessionId, userId).run();

  // Mark known once 8 correct production attempts have accumulated.
  await db.prepare(`
    UPDATE grammar_progress
    SET correct_count = correct_count + ?,
        attempt_count = attempt_count + ?,
        last_practiced_at = datetime('now'),
        status = CASE WHEN correct_count + ? >= 8 THEN 'known' ELSE 'learning' END
    WHERE user_id = ? AND grammar_point_id = ?
  `).bind(correctDelta, attemptDelta, correctDelta, userId, grammarPointId).run();
}
