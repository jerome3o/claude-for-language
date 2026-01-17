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
} from '../types';
import { generateId, CARD_TYPES } from '../services/cards';
import { DeckSettings, DEFAULT_DECK_SETTINGS, parseLearningSteps, SchedulerResult } from '../services/anki-scheduler';

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
    funFacts?: string;
  },
  updates?: {
    hanzi?: string;
    pinyin?: string;
    english?: string;
    audioUrl?: string;
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
    SELECT c.*, n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts, n.deck_id
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
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
      fun_facts: row.fun_facts as string | null,
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
              n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts, n.deck_id
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
        fun_facts: row.fun_facts as string | null,
        created_at: '',
        updated_at: '',
      },
    },
  }));

  return { ...session, reviews: mappedReviews };
}

// ============ Card Reviews ============

export async function createCardReview(
  db: D1Database,
  sessionId: string,
  cardId: string,
  rating: number,
  timeSpentMs?: number,
  userAnswer?: string,
  recordingUrl?: string
): Promise<CardReview> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO card_reviews (id, session_id, card_id, rating, time_spent_ms, user_answer, recording_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      sessionId,
      cardId,
      rating,
      timeSpentMs || null,
      userAnswer || null,
      recordingUrl || null
    )
    .run();

  const review = await db
    .prepare('SELECT * FROM card_reviews WHERE id = ?')
    .bind(id)
    .first<CardReview>();

  if (!review) throw new Error('Failed to create review');
  return review;
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

  // Get all reviews for all cards of this note
  const reviews = await db
    .prepare(`
      SELECT cr.id, cr.rating, cr.time_spent_ms, cr.user_answer, cr.recording_url, cr.reviewed_at, c.card_type
      FROM card_reviews cr
      JOIN cards c ON cr.card_id = c.id
      WHERE c.note_id = ?
      ORDER BY cr.reviewed_at DESC
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
      WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
    `).bind(userId).first<{ count: number }>(),
    db.prepare(`
      SELECT COUNT(*) as count FROM card_reviews cr
      JOIN study_sessions ss ON cr.session_id = ss.id
      WHERE ss.user_id = ? AND date(cr.reviewed_at) = date('now')
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
         WHERE n.deck_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))`
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

  // Get review cards count (due today)
  const reviewQuery = `
    SELECT COUNT(*) as count FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue = 2
    AND c.next_review_at <= datetime('now')
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
    n.id as n_id, n.deck_id, n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts
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

  // Priority 2: Review cards due today
  const reviewQuery = `
    SELECT ${selectFields} FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? ${deckFilter}
    AND c.queue = 2
    AND c.next_review_at <= datetime('now')
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
      fun_facts: row.fun_facts as string | null,
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
    relearning_steps: DEFAULT_DECK_SETTINGS.relearning_steps,
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
