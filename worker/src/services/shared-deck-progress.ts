import {
  SharedDeckProgress,
  CardTypeStats,
  StrugglingWord,
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
