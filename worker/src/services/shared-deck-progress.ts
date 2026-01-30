import {
  SharedDeckProgress,
  CardTypeStats,
  StrugglingWord,
  CardQueue,
  User,
  CardType,
} from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from './relationships';
import {
  computeCardState,
  DEFAULT_DECK_SETTINGS,
  type ReviewEvent,
  type ComputedCardState,
} from '@chinese-learning/shared/scheduler';

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
 * Compute card states from review events for accurate progress calculation.
 * This is needed because the cards table may have stale cached state.
 */
async function computeCardStatesFromEvents(
  db: D1Database,
  cardIds: string[],
  userId: string
): Promise<Map<string, ComputedCardState>> {
  const cardStates = new Map<string, ComputedCardState>();

  if (cardIds.length === 0) {
    return cardStates;
  }

  // Fetch all review events for these cards in one query
  const placeholders = cardIds.map(() => '?').join(',');
  const eventsResult = await db.prepare(`
    SELECT id, card_id, rating, reviewed_at
    FROM review_events
    WHERE card_id IN (${placeholders})
    AND user_id = ?
    ORDER BY reviewed_at ASC
  `).bind(...cardIds, userId).all<{
    id: string;
    card_id: string;
    rating: number;
    reviewed_at: string;
  }>();

  // Group events by card_id
  const eventsByCard = new Map<string, ReviewEvent[]>();
  for (const cardId of cardIds) {
    eventsByCard.set(cardId, []);
  }
  for (const event of (eventsResult.results || [])) {
    const events = eventsByCard.get(event.card_id);
    if (events) {
      events.push({
        id: event.id,
        card_id: event.card_id,
        rating: event.rating as 0 | 1 | 2 | 3,
        reviewed_at: event.reviewed_at,
      });
    }
  }

  // Compute state for each card
  for (const [cardId, events] of eventsByCard) {
    const state = computeCardState(events, DEFAULT_DECK_SETTINGS);
    cardStates.set(cardId, state);
  }

  return cardStates;
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

  // Track lapses by note for struggling words
  const noteData: Map<string, {
    hanzi: string;
    pinyin: string;
    english: string;
    totalLapses: number;
    cardCount: number;
  }> = new Map();

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

    // Track for struggling words (aggregate by hanzi)
    const key = card.hanzi;
    const existing = noteData.get(key);
    if (existing) {
      existing.totalLapses += card.lapses;
      existing.cardCount++;
    } else {
      noteData.set(key, {
        hanzi: card.hanzi,
        pinyin: card.pinyin,
        english: card.english,
        totalLapses: card.lapses,
        cardCount: 1,
      });
    }
  }

  // Get average ratings from recent reviews for struggling word calculation
  // A card is "struggling" if: lapses >= 3 OR avg rating < 1.5 OR in RELEARNING
  const struggleCardsResult = await db.prepare(`
    SELECT
      c.id as card_id,
      n.hanzi,
      n.pinyin,
      n.english,
      c.lapses,
      c.queue,
      (
        SELECT AVG(re.rating)
        FROM review_events re
        WHERE re.card_id = c.id
        AND re.user_id = ?
        ORDER BY re.reviewed_at DESC
        LIMIT 5
      ) as avg_rating,
      (
        SELECT MAX(re.reviewed_at)
        FROM review_events re
        WHERE re.card_id = c.id
        AND re.user_id = ?
      ) as last_reviewed_at
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
    AND (
      c.lapses >= 3
      OR c.queue = ?
    )
    ORDER BY c.lapses DESC, c.queue DESC
  `).bind(studentId, studentId, targetDeckId, CardQueue.RELEARNING).all<{
    card_id: string;
    hanzi: string;
    pinyin: string;
    english: string;
    lapses: number;
    queue: number;
    avg_rating: number | null;
    last_reviewed_at: string | null;
  }>();

  // Also get cards with low average ratings
  const lowRatingCardsResult = await db.prepare(`
    SELECT DISTINCT
      n.hanzi,
      n.pinyin,
      n.english,
      c.lapses,
      (
        SELECT AVG(re.rating)
        FROM review_events re
        WHERE re.card_id = c.id
        AND re.user_id = ?
        ORDER BY re.reviewed_at DESC
        LIMIT 5
      ) as avg_rating,
      (
        SELECT MAX(re.reviewed_at)
        FROM review_events re
        WHERE re.card_id = c.id
        AND re.user_id = ?
      ) as last_reviewed_at
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
    GROUP BY n.hanzi
    HAVING avg_rating IS NOT NULL AND avg_rating < 1.5
    ORDER BY avg_rating ASC, c.lapses DESC
    LIMIT 20
  `).bind(studentId, studentId, targetDeckId).all<{
    hanzi: string;
    pinyin: string;
    english: string;
    lapses: number;
    avg_rating: number;
    last_reviewed_at: string | null;
  }>();

  // Combine and deduplicate struggling words by hanzi
  const strugglingMap = new Map<string, StrugglingWord>();

  for (const card of (struggleCardsResult.results || [])) {
    if (!strugglingMap.has(card.hanzi)) {
      strugglingMap.set(card.hanzi, {
        hanzi: card.hanzi,
        pinyin: card.pinyin,
        english: card.english,
        lapses: card.lapses,
        avg_rating: card.avg_rating ?? 0,
        last_reviewed_at: card.last_reviewed_at,
      });
    }
  }

  for (const card of (lowRatingCardsResult.results || [])) {
    if (!strugglingMap.has(card.hanzi)) {
      strugglingMap.set(card.hanzi, {
        hanzi: card.hanzi,
        pinyin: card.pinyin,
        english: card.english,
        lapses: card.lapses,
        avg_rating: card.avg_rating,
        last_reviewed_at: card.last_reviewed_at,
      });
    }
  }

  // Sort by lapses (desc) then avg_rating (asc)
  const strugglingWords = Array.from(strugglingMap.values())
    .sort((a, b) => {
      if (b.lapses !== a.lapses) return b.lapses - a.lapses;
      return a.avg_rating - b.avg_rating;
    })
    .slice(0, 10);

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
    struggling_words: strugglingWords,
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

  // Get all cards for this deck (basic info only - state computed from events)
  const cardsResult = await db.prepare(`
    SELECT
      c.id,
      c.card_type,
      n.hanzi,
      n.pinyin,
      n.english
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE n.deck_id = ?
  `).bind(deckId).all<{
    id: string;
    card_type: CardType;
    hanzi: string;
    pinyin: string;
    english: string;
  }>();

  const cards = cardsResult.results || [];

  // Compute card states from review events (more accurate than cached card state)
  const cardIds = cards.map(c => c.id);
  const computedStates = await computeCardStatesFromEvents(db, cardIds, studentId);

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

  // Track lapses by note for struggling words
  const noteData: Map<string, {
    hanzi: string;
    pinyin: string;
    english: string;
    totalLapses: number;
    cardCount: number;
  }> = new Map();

  for (const card of cards) {
    // Use computed state from events instead of cached card state
    const state = computedStates.get(card.id);
    const queue = state?.queue ?? CardQueue.NEW;
    const stability = state?.stability ?? 0;
    const lapses = state?.lapses ?? 0;

    const mastery = getMasteryLevel(queue, stability);

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

    // Track for struggling words (aggregate by hanzi)
    const key = card.hanzi;
    const existing = noteData.get(key);
    if (existing) {
      existing.totalLapses += lapses;
      existing.cardCount++;
    } else {
      noteData.set(key, {
        hanzi: card.hanzi,
        pinyin: card.pinyin,
        english: card.english,
        totalLapses: lapses,
        cardCount: 1,
      });
    }
  }

  // Get struggling words using computed state
  // Cards with 3+ lapses or in relearning queue, or low avg rating
  const strugglingMap = new Map<string, StrugglingWord>();

  // Identify struggling cards from computed state
  for (const card of cards) {
    const state = computedStates.get(card.id);
    const lapses = state?.lapses ?? 0;
    const queue = state?.queue ?? CardQueue.NEW;

    // Skip cards that haven't been studied
    if (queue === CardQueue.NEW) {
      continue;
    }

    // Get avg rating from review events for this card
    const ratingResult = await db.prepare(`
      SELECT AVG(rating) as avg_rating, MAX(reviewed_at) as last_reviewed_at
      FROM (
        SELECT rating, reviewed_at FROM review_events
        WHERE card_id = ? AND user_id = ?
        ORDER BY reviewed_at DESC
        LIMIT 5
      )
    `).bind(card.id, studentId).first<{ avg_rating: number | null; last_reviewed_at: string | null }>();

    const avgRating = ratingResult?.avg_rating ?? 2;
    const lastReviewedAt = ratingResult?.last_reviewed_at ?? null;

    // Card is struggling if: 3+ lapses, in relearning queue, or low avg rating
    const isStruggling = lapses >= 3 || queue === CardQueue.RELEARNING || avgRating < 1.5;

    if (isStruggling && !strugglingMap.has(card.hanzi)) {
      strugglingMap.set(card.hanzi, {
        hanzi: card.hanzi,
        pinyin: card.pinyin,
        english: card.english,
        lapses: lapses,
        avg_rating: avgRating,
        last_reviewed_at: lastReviewedAt,
      });
    }
  }

  // Sort by lapses (desc) then avg_rating (asc)
  const strugglingWords = Array.from(strugglingMap.values())
    .sort((a, b) => {
      if (b.lapses !== a.lapses) return b.lapses - a.lapses;
      return a.avg_rating - b.avg_rating;
    })
    .slice(0, 10);

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
    struggling_words: strugglingWords,
    activity: {
      last_studied_at: activityResult?.last_studied_at || null,
      total_study_time_ms: activityResult?.total_study_time_ms || 0,
      reviews_last_7_days: activityResult?.reviews_last_7_days || 0,
    },
  };
}
