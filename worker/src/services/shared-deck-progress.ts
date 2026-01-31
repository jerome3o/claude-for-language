import {
  SharedDeckProgress,
  DeckProgress,
  CardTypeStats,
  NoteProgress,
  CardQueue,
  User,
  CardType,
} from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from './relationships';

type UserSummary = Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;

async function getUserSummary(
  db: D1Database,
  userId: string
): Promise<UserSummary | null> {
  return db
    .prepare('SELECT id, email, name, picture_url FROM users WHERE id = ?')
    .bind(userId)
    .first<UserSummary>();
}

/**
 * Get a shared deck by its ID
 */
async function getSharedDeckById(
  db: D1Database,
  sharedDeckId: string
): Promise<{
  id: string;
  relationship_id: string;
  source_deck_id: string;
  target_deck_id: string;
  shared_at: string;
} | null> {
  return db
    .prepare('SELECT * FROM shared_decks WHERE id = ?')
    .bind(sharedDeckId)
    .first();
}

/**
 * Classify a card into a tutor-friendly mastery level.
 * Based on FSRS stability values but presented without jargon.
 *
 * - NEW: queue == NEW (never seen)
 * - LEARNING: queue == LEARNING/RELEARNING, or stability <= 7 days
 * - FAMILIAR: stability > 7 and <= 21 days
 * - MASTERED: stability > 21 days
 */
function getMasteryLevel(
  queue: CardQueue,
  stability: number
): 'new' | 'learning' | 'familiar' | 'mastered' {
  if (queue === CardQueue.NEW) {
    return 'new';
  }

  if (queue === CardQueue.LEARNING || queue === CardQueue.RELEARNING) {
    return 'learning';
  }

  // For review cards, use stability to determine mastery
  if (stability <= 7) {
    return 'learning';
  } else if (stability <= 21) {
    return 'familiar';
  } else {
    return 'mastered';
  }
}

/**
 * Build notes array with mastery info and recent ratings.
 * Shared helper used by all progress functions.
 */
async function buildNotesProgress(
  db: D1Database,
  deckId: string,
  userId: string,
  cards: Array<{
    id: string;
    hanzi: string;
    pinyin: string;
    english: string;
    stability: number;
  }>
): Promise<NoteProgress[]> {
  // Group cards by note (hanzi) and calculate average stability
  const noteMap = new Map<string, {
    hanzi: string;
    pinyin: string;
    english: string;
    totalStability: number;
    cardCount: number;
  }>();

  for (const card of cards) {
    const key = card.hanzi;
    const existing = noteMap.get(key);
    if (existing) {
      existing.totalStability += card.stability || 0;
      existing.cardCount++;
    } else {
      noteMap.set(key, {
        hanzi: card.hanzi,
        pinyin: card.pinyin,
        english: card.english,
        totalStability: card.stability || 0,
        cardCount: 1,
      });
    }
  }

  // Get recent review ratings for all cards in this deck, grouped by card type
  const recentRatingsResult = await db.prepare(`
    SELECT
      n.hanzi,
      c.card_type,
      re.rating
    FROM review_events re
    JOIN cards c ON re.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
    AND re.user_id = ?
    ORDER BY re.reviewed_at DESC
  `).bind(deckId, userId).all<{
    hanzi: string;
    card_type: CardType;
    rating: number;
  }>();

  // Group ratings by note (hanzi) and card type, keeping last 8 ratings per type
  const ratingsByNote = new Map<string, {
    hanzi_to_meaning: number[];
    meaning_to_hanzi: number[];
    audio_to_hanzi: number[];
  }>();
  for (const row of (recentRatingsResult.results || [])) {
    let noteRatings = ratingsByNote.get(row.hanzi);
    if (!noteRatings) {
      noteRatings = {
        hanzi_to_meaning: [],
        meaning_to_hanzi: [],
        audio_to_hanzi: [],
      };
      ratingsByNote.set(row.hanzi, noteRatings);
    }
    const typeRatings = noteRatings[row.card_type as keyof typeof noteRatings];
    if (typeRatings && typeRatings.length < 8) {
      typeRatings.push(row.rating);
    }
  }

  // Build final notes array with mastery percent
  // Mastery is based on average stability: 0 days = 0%, 30+ days = 100%
  const notes: NoteProgress[] = Array.from(noteMap.values()).map(note => {
    const avgStability = note.cardCount > 0 ? note.totalStability / note.cardCount : 0;
    const masteryPercent = Math.min(100, Math.round((avgStability / 30) * 100));
    const recentRatings = ratingsByNote.get(note.hanzi) || {
      hanzi_to_meaning: [],
      meaning_to_hanzi: [],
      audio_to_hanzi: [],
    };

    return {
      hanzi: note.hanzi,
      pinyin: note.pinyin,
      english: note.english,
      mastery_percent: masteryPercent,
      recent_ratings: recentRatings,
    };
  });

  // Sort by mastery descending (most mastered first)
  notes.sort((a, b) => b.mastery_percent - a.mastery_percent);

  return notes;
}

/**
 * Get detailed progress for a deck shared with a student.
 * Only the tutor can call this.
 */
export async function getSharedDeckProgress(
  db: D1Database,
  relationshipId: string,
  sharedDeckId: string,
  userId: string
): Promise<SharedDeckProgress> {
  // Verify user has access to this relationship
  const rel = await verifyRelationshipAccess(db, relationshipId, userId);

  // Only tutors can view this
  const myRole = getMyRole(rel, userId);
  if (myRole !== 'tutor') {
    throw new Error('Only tutors can view shared deck progress');
  }

  // Get the shared deck record
  const sharedDeck = await getSharedDeckById(db, sharedDeckId);
  if (!sharedDeck) {
    throw new Error('Shared deck not found');
  }

  // Verify the shared deck belongs to this relationship
  if (sharedDeck.relationship_id !== relationshipId) {
    throw new Error('Shared deck does not belong to this relationship');
  }

  // Get the target deck (the student's copy)
  const targetDeckId = sharedDeck.target_deck_id;
  const studentId = getOtherUserId(rel, userId);

  // Get deck name
  const deck = await db
    .prepare('SELECT name FROM decks WHERE id = ?')
    .bind(targetDeckId)
    .first<{ name: string }>();

  if (!deck) {
    throw new Error('Deck not found');
  }

  // Get student info
  const student = await getUserSummary(db, studentId);
  if (!student) {
    throw new Error('Student not found');
  }

  // Get all cards for this deck with their state
  const cardsResult = await db.prepare(`
    SELECT
      c.id,
      c.card_type,
      c.queue,
      c.stability,
      c.lapses,
      n.hanzi,
      n.pinyin,
      n.english
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
  `).bind(targetDeckId).all<{
    id: string;
    card_type: CardType;
    queue: number;
    stability: number;
    lapses: number;
    hanzi: string;
    pinyin: string;
    english: string;
  }>();

  const cards = cardsResult.results || [];

  // Calculate completion stats
  const totalCards = cards.length;
  let cardsSeen = 0;
  let cardsMastered = 0;

  // Initialize card type breakdown
  const cardTypeBreakdown: SharedDeckProgress['card_type_breakdown'] = {
    hanzi_to_meaning: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
    meaning_to_hanzi: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
    audio_to_hanzi: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
  };

  for (const card of cards) {
    const mastery = getMasteryLevel(card.queue as CardQueue, card.stability);

    // Count seen and mastered
    if (mastery !== 'new') {
      cardsSeen++;
    }
    if (mastery === 'mastered') {
      cardsMastered++;
    }

    // Update card type breakdown
    const typeStats = cardTypeBreakdown[card.card_type as keyof typeof cardTypeBreakdown];
    if (typeStats) {
      typeStats.total++;
      typeStats[mastery]++;
    }
  }

  // Build notes array with mastery info and recent ratings
  const notes = await buildNotesProgress(db, targetDeckId, studentId, cards);

  // Get activity stats
  const activityResult = await db.prepare(`
    SELECT
      MAX(re.reviewed_at) as last_studied_at,
      SUM(re.time_spent_ms) as total_study_time_ms,
      SUM(CASE WHEN re.reviewed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as reviews_last_7_days
    FROM review_events re
    JOIN cards c ON re.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
    AND re.user_id = ?
  `).bind(targetDeckId, studentId).first<{
    last_studied_at: string | null;
    total_study_time_ms: number | null;
    reviews_last_7_days: number;
  }>();

  return {
    deck_name: deck.name,
    shared_at: sharedDeck.shared_at,
    student,
    completion: {
      total_cards: totalCards,
      cards_seen: cardsSeen,
      cards_mastered: cardsMastered,
      percent_seen: totalCards > 0 ? Math.round((cardsSeen / totalCards) * 100) : 0,
      percent_mastered: totalCards > 0 ? Math.round((cardsMastered / totalCards) * 100) : 0,
    },
    card_type_breakdown: cardTypeBreakdown,
    notes,
    activity: {
      last_studied_at: activityResult?.last_studied_at || null,
      total_study_time_ms: activityResult?.total_study_time_ms || 0,
      reviews_last_7_days: activityResult?.reviews_last_7_days || 0,
    },
  };
}

/**
 * Get a student-shared deck by its ID
 */
async function getStudentSharedDeckById(
  db: D1Database,
  sharedDeckId: string
): Promise<{
  id: string;
  relationship_id: string;
  deck_id: string;
  shared_at: string;
} | null> {
  return db
    .prepare('SELECT * FROM student_shared_decks WHERE id = ?')
    .bind(sharedDeckId)
    .first();
}

/**
 * Get detailed progress for a deck that a student shared with their tutor.
 * Unlike tutor-shared decks (which are copies), this views the student's actual deck directly.
 * Only the tutor can call this.
 */
export async function getStudentSharedDeckProgress(
  db: D1Database,
  relationshipId: string,
  studentSharedDeckId: string,
  userId: string
): Promise<SharedDeckProgress> {
  // Verify user has access to this relationship
  const rel = await verifyRelationshipAccess(db, relationshipId, userId);

  // Only tutors can view this
  const myRole = getMyRole(rel, userId);
  if (myRole !== 'tutor') {
    throw new Error('Only tutors can view student shared deck progress');
  }

  // Get the student-shared deck record
  const studentSharedDeck = await getStudentSharedDeckById(db, studentSharedDeckId);
  if (!studentSharedDeck) {
    throw new Error('Student shared deck not found');
  }

  // Verify the shared deck belongs to this relationship
  if (studentSharedDeck.relationship_id !== relationshipId) {
    throw new Error('Student shared deck does not belong to this relationship');
  }

  // The deck ID is the student's actual deck (no copy)
  const deckId = studentSharedDeck.deck_id;
  const studentId = getOtherUserId(rel, userId);

  // Verify the deck still belongs to the student
  const deck = await db
    .prepare('SELECT name FROM decks WHERE id = ? AND user_id = ?')
    .bind(deckId, studentId)
    .first<{ name: string }>();

  if (!deck) {
    throw new Error('Deck not found or no longer belongs to student');
  }

  // Get student info
  const student = await getUserSummary(db, studentId);
  if (!student) {
    throw new Error('Student not found');
  }

  // Get all cards for this deck with their state
  const cardsResult = await db.prepare(`
    SELECT
      c.id,
      c.card_type,
      c.queue,
      c.stability,
      c.lapses,
      n.hanzi,
      n.pinyin,
      n.english
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
  `).bind(deckId).all<{
    id: string;
    card_type: CardType;
    queue: number;
    stability: number;
    lapses: number;
    hanzi: string;
    pinyin: string;
    english: string;
  }>();

  const cards = cardsResult.results || [];

  // Calculate completion stats
  const totalCards = cards.length;
  let cardsSeen = 0;
  let cardsMastered = 0;

  // Initialize card type breakdown
  const cardTypeBreakdown: SharedDeckProgress['card_type_breakdown'] = {
    hanzi_to_meaning: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
    meaning_to_hanzi: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
    audio_to_hanzi: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
  };

  for (const card of cards) {
    const mastery = getMasteryLevel(card.queue as CardQueue, card.stability);

    // Count seen and mastered
    if (mastery !== 'new') {
      cardsSeen++;
    }
    if (mastery === 'mastered') {
      cardsMastered++;
    }

    // Update card type breakdown
    const typeStats = cardTypeBreakdown[card.card_type as keyof typeof cardTypeBreakdown];
    if (typeStats) {
      typeStats.total++;
      typeStats[mastery]++;
    }
  }

  // Build notes array with mastery info and recent ratings
  const notes = await buildNotesProgress(db, deckId, studentId, cards);

  // Get activity stats
  const activityResult = await db.prepare(`
    SELECT
      MAX(re.reviewed_at) as last_studied_at,
      SUM(re.time_spent_ms) as total_study_time_ms,
      SUM(CASE WHEN re.reviewed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as reviews_last_7_days
    FROM review_events re
    JOIN cards c ON re.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
    AND re.user_id = ?
  `).bind(deckId, studentId).first<{
    last_studied_at: string | null;
    total_study_time_ms: number | null;
    reviews_last_7_days: number;
  }>();

  return {
    deck_name: deck.name,
    shared_at: studentSharedDeck.shared_at,
    student,
    completion: {
      total_cards: totalCards,
      cards_seen: cardsSeen,
      cards_mastered: cardsMastered,
      percent_seen: totalCards > 0 ? Math.round((cardsSeen / totalCards) * 100) : 0,
      percent_mastered: totalCards > 0 ? Math.round((cardsMastered / totalCards) * 100) : 0,
    },
    card_type_breakdown: cardTypeBreakdown,
    notes,
    activity: {
      last_studied_at: activityResult?.last_studied_at || null,
      total_study_time_ms: activityResult?.total_study_time_ms || 0,
      reviews_last_7_days: activityResult?.reviews_last_7_days || 0,
    },
  };
}

/**
 * Get detailed progress for a user's own deck.
 * This is for students viewing their own deck progress.
 */
export async function getOwnDeckProgress(
  db: D1Database,
  deckId: string,
  userId: string
): Promise<DeckProgress> {
  // Verify the deck belongs to this user
  const deck = await db
    .prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
    .bind(deckId, userId)
    .first<{ id: string; name: string }>();

  if (!deck) {
    throw new Error('Deck not found');
  }

  // Get all cards for this deck with their state
  const cardsResult = await db.prepare(`
    SELECT
      c.id,
      c.card_type,
      c.queue,
      c.stability,
      c.lapses,
      n.hanzi,
      n.pinyin,
      n.english
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
  `).bind(deckId).all<{
    id: string;
    card_type: CardType;
    queue: number;
    stability: number;
    lapses: number;
    hanzi: string;
    pinyin: string;
    english: string;
  }>();

  const cards = cardsResult.results || [];

  // Calculate completion stats
  const totalCards = cards.length;
  let cardsSeen = 0;
  let cardsMastered = 0;

  // Initialize card type breakdown
  const cardTypeBreakdown: DeckProgress['card_type_breakdown'] = {
    hanzi_to_meaning: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
    meaning_to_hanzi: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
    audio_to_hanzi: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
  };

  for (const card of cards) {
    const mastery = getMasteryLevel(card.queue as CardQueue, card.stability);

    // Count seen and mastered
    if (mastery !== 'new') {
      cardsSeen++;
    }
    if (mastery === 'mastered') {
      cardsMastered++;
    }

    // Update card type breakdown
    const typeStats = cardTypeBreakdown[card.card_type as keyof typeof cardTypeBreakdown];
    if (typeStats) {
      typeStats.total++;
      typeStats[mastery]++;
    }
  }

  // Build note progress with mastery info and recent ratings
  // Group cards by note (hanzi) and calculate average stability
  const noteMap = new Map<string, {
    hanzi: string;
    pinyin: string;
    english: string;
    totalStability: number;
    cardCount: number;
    cardIds: string[];
  }>();

  for (const card of cards) {
    const key = card.hanzi;
    const existing = noteMap.get(key);
    if (existing) {
      existing.totalStability += card.stability || 0;
      existing.cardCount++;
      existing.cardIds.push(card.id);
    } else {
      noteMap.set(key, {
        hanzi: card.hanzi,
        pinyin: card.pinyin,
        english: card.english,
        totalStability: card.stability || 0,
        cardCount: 1,
        cardIds: [card.id],
      });
    }
  }

  // Get recent review ratings for all cards in this deck, grouped by card type
  const recentRatingsResult = await db.prepare(`
    SELECT
      n.hanzi,
      c.card_type,
      re.rating
    FROM review_events re
    JOIN cards c ON re.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
    AND re.user_id = ?
    ORDER BY re.reviewed_at DESC
  `).bind(deckId, userId).all<{
    hanzi: string;
    card_type: CardType;
    rating: number;
  }>();

  // Group ratings by note (hanzi) and card type, keeping last 8 ratings per type
  const ratingsByNote = new Map<string, {
    hanzi_to_meaning: number[];
    meaning_to_hanzi: number[];
    audio_to_hanzi: number[];
  }>();
  for (const row of (recentRatingsResult.results || [])) {
    let noteRatings = ratingsByNote.get(row.hanzi);
    if (!noteRatings) {
      noteRatings = {
        hanzi_to_meaning: [],
        meaning_to_hanzi: [],
        audio_to_hanzi: [],
      };
      ratingsByNote.set(row.hanzi, noteRatings);
    }
    const typeRatings = noteRatings[row.card_type as keyof typeof noteRatings];
    if (typeRatings && typeRatings.length < 8) {
      typeRatings.push(row.rating);
    }
  }

  // Build final notes array with mastery percent
  // Mastery is based on average stability: 0 days = 0%, 30+ days = 100%
  const notes: NoteProgress[] = Array.from(noteMap.values()).map(note => {
    const avgStability = note.cardCount > 0 ? note.totalStability / note.cardCount : 0;
    const masteryPercent = Math.min(100, Math.round((avgStability / 30) * 100));
    const recentRatings = ratingsByNote.get(note.hanzi) || {
      hanzi_to_meaning: [],
      meaning_to_hanzi: [],
      audio_to_hanzi: [],
    };

    return {
      hanzi: note.hanzi,
      pinyin: note.pinyin,
      english: note.english,
      mastery_percent: masteryPercent,
      recent_ratings: recentRatings,
    };
  });

  // Sort by mastery descending (most mastered first)
  notes.sort((a, b) => b.mastery_percent - a.mastery_percent);

  // Get activity stats
  const activityResult = await db.prepare(`
    SELECT
      MAX(re.reviewed_at) as last_studied_at,
      SUM(re.time_spent_ms) as total_study_time_ms,
      SUM(CASE WHEN re.reviewed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as reviews_last_7_days
    FROM review_events re
    JOIN cards c ON re.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
    AND re.user_id = ?
  `).bind(deckId, userId).first<{
    last_studied_at: string | null;
    total_study_time_ms: number | null;
    reviews_last_7_days: number;
  }>();

  return {
    deck_name: deck.name,
    deck_id: deckId,
    completion: {
      total_cards: totalCards,
      cards_seen: cardsSeen,
      cards_mastered: cardsMastered,
      percent_seen: totalCards > 0 ? Math.round((cardsSeen / totalCards) * 100) : 0,
      percent_mastered: totalCards > 0 ? Math.round((cardsMastered / totalCards) * 100) : 0,
    },
    card_type_breakdown: cardTypeBreakdown,
    notes,
    activity: {
      last_studied_at: activityResult?.last_studied_at || null,
      total_study_time_ms: activityResult?.total_study_time_ms || 0,
      reviews_last_7_days: activityResult?.reviews_last_7_days || 0,
    },
  };
}
