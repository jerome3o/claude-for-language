import {
  Deck,
  Note,
  Card,
  StudySession,
  CardReview,
  NoteWithCards,
  DeckWithNotes,
  CardWithNote,
} from '../types';
import { generateId, CARD_TYPES } from '../services/cards';

// ============ Decks ============

export async function getAllDecks(db: D1Database): Promise<Deck[]> {
  const result = await db.prepare('SELECT * FROM decks ORDER BY updated_at DESC').all<Deck>();
  return result.results;
}

export async function getDeckById(db: D1Database, id: string): Promise<Deck | null> {
  return db.prepare('SELECT * FROM decks WHERE id = ?').bind(id).first<Deck>();
}

export async function getDeckWithNotes(db: D1Database, id: string): Promise<DeckWithNotes | null> {
  const deck = await getDeckById(db, id);
  if (!deck) return null;

  const notes = await db
    .prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at DESC')
    .bind(id)
    .all<Note>();

  return { ...deck, notes: notes.results };
}

export async function createDeck(
  db: D1Database,
  name: string,
  description?: string
): Promise<Deck> {
  const id = generateId();
  await db
    .prepare('INSERT INTO decks (id, name, description) VALUES (?, ?, ?)')
    .bind(id, name, description || null)
    .run();

  const deck = await getDeckById(db, id);
  if (!deck) throw new Error('Failed to create deck');
  return deck;
}

export async function updateDeck(
  db: D1Database,
  id: string,
  name?: string,
  description?: string
): Promise<Deck | null> {
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
    return getDeckById(db, id);
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  await db
    .prepare(`UPDATE decks SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getDeckById(db, id);
}

export async function deleteDeck(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM decks WHERE id = ?').bind(id).run();
}

// ============ Notes ============

export async function getNoteById(db: D1Database, id: string): Promise<Note | null> {
  return db.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first<Note>();
}

export async function getNoteWithCards(db: D1Database, id: string): Promise<NoteWithCards | null> {
  const note = await getNoteById(db, id);
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

  const result = await getNoteWithCards(db, noteId);
  if (!result) throw new Error('Failed to create note');
  return result;
}

export async function updateNote(
  db: D1Database,
  id: string,
  updates: {
    hanzi?: string;
    pinyin?: string;
    english?: string;
    audioUrl?: string;
    funFacts?: string;
  }
): Promise<Note | null> {
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (updates.hanzi !== undefined) {
    fields.push('hanzi = ?');
    values.push(updates.hanzi);
  }
  if (updates.pinyin !== undefined) {
    fields.push('pinyin = ?');
    values.push(updates.pinyin);
  }
  if (updates.english !== undefined) {
    fields.push('english = ?');
    values.push(updates.english);
  }
  if (updates.audioUrl !== undefined) {
    fields.push('audio_url = ?');
    values.push(updates.audioUrl);
  }
  if (updates.funFacts !== undefined) {
    fields.push('fun_facts = ?');
    values.push(updates.funFacts);
  }

  if (fields.length === 0) {
    return getNoteById(db, id);
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

export async function deleteNote(db: D1Database, id: string): Promise<void> {
  const note = await getNoteById(db, id);
  await db.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();

  // Update deck's updated_at
  if (note) {
    await db
      .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
      .bind(note.deck_id)
      .run();
  }
}

// ============ Cards ============

export async function getCardById(db: D1Database, id: string): Promise<Card | null> {
  return db.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first<Card>();
}

export async function getCardWithNote(db: D1Database, id: string): Promise<CardWithNote | null> {
  const card = await getCardById(db, id);
  if (!card) return null;

  const note = await getNoteById(db, card.note_id);
  if (!note) return null;

  return { ...card, note };
}

export async function getDueCards(
  db: D1Database,
  deckId?: string,
  includeNew: boolean = true,
  limit: number = 20
): Promise<CardWithNote[]> {
  let query = `
    SELECT c.*, n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts, n.deck_id
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
  `;

  const params: (string | number)[] = [];

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
    ease_factor: row.ease_factor as number,
    interval: row.interval as number,
    repetitions: row.repetitions as number,
    next_review_at: row.next_review_at as string | null,
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
  deckId?: string
): Promise<StudySession> {
  const id = generateId();
  await db
    .prepare('INSERT INTO study_sessions (id, deck_id) VALUES (?, ?)')
    .bind(id, deckId || null)
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
  id: string
): Promise<StudySession | null> {
  return db
    .prepare('SELECT * FROM study_sessions WHERE id = ?')
    .bind(id)
    .first<StudySession>();
}

export async function completeStudySession(
  db: D1Database,
  id: string
): Promise<StudySession | null> {
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

  return getStudySession(db, id);
}

export async function getSessionWithReviews(
  db: D1Database,
  sessionId: string
): Promise<StudySession & { reviews: (CardReview & { card: CardWithNote })[] } | null> {
  const session = await getStudySession(db, sessionId);
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
      ease_factor: row.ease_factor as number,
      interval: row.interval as number,
      repetitions: row.repetitions as number,
      next_review_at: null,
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
  noteId: string
): Promise<NoteReviewHistory[] | null> {
  // First verify note exists
  const note = await db
    .prepare('SELECT id FROM notes WHERE id = ?')
    .bind(noteId)
    .first();

  if (!note) return null;

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

  return Object.entries(byCardType).map(([card_type, reviews]) => ({
    card_type,
    reviews,
  }));
}

// ============ Statistics ============

export async function getOverviewStats(db: D1Database): Promise<{
  total_cards: number;
  cards_due_today: number;
  cards_studied_today: number;
  total_decks: number;
}> {
  const [totalCards, cardsDue, studiedToday, totalDecks] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM cards').first<{ count: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) as count FROM cards WHERE next_review_at IS NULL OR next_review_at <= datetime('now')"
      )
      .first<{ count: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) as count FROM card_reviews WHERE date(reviewed_at) = date('now')"
      )
      .first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM decks').first<{ count: number }>(),
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
  deckId: string
): Promise<{
  total_notes: number;
  total_cards: number;
  cards_due: number;
  cards_mastered: number;
} | null> {
  const deck = await getDeckById(db, deckId);
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
