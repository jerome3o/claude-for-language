import {
  TutorRelationship,
  TutorRelationshipWithUsers,
  MyRelationships,
  RelationshipRole,
  User,
  StudentProgress,
} from '../types';

function generateId(): string {
  return crypto.randomUUID();
}

type UserSummary = Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;

// ============ Relationships ============

/**
 * Find a user by email
 */
export async function getUserByEmail(
  db: D1Database,
  email: string
): Promise<User | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<User>();
}

/**
 * Get user summary by ID
 */
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
 * Create a new relationship request
 */
export async function createRelationship(
  db: D1Database,
  requesterId: string,
  recipientEmail: string,
  requesterRole: RelationshipRole
): Promise<TutorRelationshipWithUsers> {
  // Find recipient by email
  const recipient = await getUserByEmail(db, recipientEmail);
  if (!recipient) {
    throw new Error('User not found with that email');
  }

  // Can't create relationship with yourself
  if (recipient.id === requesterId) {
    throw new Error('Cannot create a relationship with yourself');
  }

  // Check if relationship already exists (in either direction)
  const existing = await db
    .prepare(`
      SELECT * FROM tutor_relationships
      WHERE ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
      AND status != 'removed'
    `)
    .bind(requesterId, recipient.id, recipient.id, requesterId)
    .first<TutorRelationship>();

  if (existing) {
    throw new Error('A relationship already exists between these users');
  }

  const id = generateId();
  await db
    .prepare(`
      INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status)
      VALUES (?, ?, ?, ?, 'pending')
    `)
    .bind(id, requesterId, recipient.id, requesterRole)
    .run();

  return getRelationshipById(db, id) as Promise<TutorRelationshipWithUsers>;
}

/**
 * Get a relationship by ID with user details
 */
export async function getRelationshipById(
  db: D1Database,
  relationshipId: string
): Promise<TutorRelationshipWithUsers | null> {
  const rel = await db
    .prepare('SELECT * FROM tutor_relationships WHERE id = ?')
    .bind(relationshipId)
    .first<TutorRelationship>();

  if (!rel) return null;

  const [requester, recipient] = await Promise.all([
    getUserSummary(db, rel.requester_id),
    getUserSummary(db, rel.recipient_id),
  ]);

  if (!requester || !recipient) return null;

  return {
    ...rel,
    requester,
    recipient,
  };
}

/**
 * Get all relationships for a user, categorized
 */
export async function getMyRelationships(
  db: D1Database,
  userId: string
): Promise<MyRelationships> {
  // Get all relationships where user is involved
  const result = await db
    .prepare(`
      SELECT * FROM tutor_relationships
      WHERE (requester_id = ? OR recipient_id = ?)
      AND status != 'removed'
      ORDER BY created_at DESC
    `)
    .bind(userId, userId)
    .all<TutorRelationship>();

  const relationships = result.results;

  // Gather all user IDs for batch lookup
  const userIds = new Set<string>();
  for (const rel of relationships) {
    userIds.add(rel.requester_id);
    userIds.add(rel.recipient_id);
  }

  // Batch fetch user summaries
  const userMap = new Map<string, UserSummary>();
  for (const uid of userIds) {
    const user = await getUserSummary(db, uid);
    if (user) userMap.set(uid, user);
  }

  // Categorize relationships
  const tutors: TutorRelationshipWithUsers[] = [];
  const students: TutorRelationshipWithUsers[] = [];
  const pendingIncoming: TutorRelationshipWithUsers[] = [];
  const pendingOutgoing: TutorRelationshipWithUsers[] = [];

  for (const rel of relationships) {
    const requester = userMap.get(rel.requester_id);
    const recipient = userMap.get(rel.recipient_id);
    if (!requester || !recipient) continue;

    const relWithUsers: TutorRelationshipWithUsers = {
      ...rel,
      requester,
      recipient,
    };

    const iAmRequester = rel.requester_id === userId;
    const myRole = iAmRequester
      ? rel.requester_role
      : rel.requester_role === 'tutor'
        ? 'student'
        : 'tutor';

    if (rel.status === 'pending') {
      if (iAmRequester) {
        pendingOutgoing.push(relWithUsers);
      } else {
        pendingIncoming.push(relWithUsers);
      }
    } else if (rel.status === 'active') {
      if (myRole === 'student') {
        tutors.push(relWithUsers);
      } else {
        students.push(relWithUsers);
      }
    }
  }

  return {
    tutors,
    students,
    pending_incoming: pendingIncoming,
    pending_outgoing: pendingOutgoing,
  };
}

/**
 * Accept a pending relationship request
 */
export async function acceptRelationship(
  db: D1Database,
  relationshipId: string,
  userId: string
): Promise<TutorRelationshipWithUsers> {
  // Verify the relationship exists and user is the recipient
  const rel = await db
    .prepare('SELECT * FROM tutor_relationships WHERE id = ?')
    .bind(relationshipId)
    .first<TutorRelationship>();

  if (!rel) {
    throw new Error('Relationship not found');
  }

  if (rel.recipient_id !== userId) {
    throw new Error('Only the recipient can accept this request');
  }

  if (rel.status !== 'pending') {
    throw new Error('This request has already been processed');
  }

  await db
    .prepare(`
      UPDATE tutor_relationships
      SET status = 'active', accepted_at = datetime('now')
      WHERE id = ?
    `)
    .bind(relationshipId)
    .run();

  return getRelationshipById(db, relationshipId) as Promise<TutorRelationshipWithUsers>;
}

/**
 * Remove a relationship (either party can do this)
 */
export async function removeRelationship(
  db: D1Database,
  relationshipId: string,
  userId: string
): Promise<void> {
  const rel = await db
    .prepare('SELECT * FROM tutor_relationships WHERE id = ?')
    .bind(relationshipId)
    .first<TutorRelationship>();

  if (!rel) {
    throw new Error('Relationship not found');
  }

  if (rel.requester_id !== userId && rel.recipient_id !== userId) {
    throw new Error('Not authorized to remove this relationship');
  }

  await db
    .prepare(`UPDATE tutor_relationships SET status = 'removed' WHERE id = ?`)
    .bind(relationshipId)
    .run();
}

/**
 * Verify user is part of a relationship and return the relationship
 */
export async function verifyRelationshipAccess(
  db: D1Database,
  relationshipId: string,
  userId: string
): Promise<TutorRelationship> {
  const rel = await db
    .prepare(`
      SELECT * FROM tutor_relationships
      WHERE id = ? AND (requester_id = ? OR recipient_id = ?) AND status = 'active'
    `)
    .bind(relationshipId, userId, userId)
    .first<TutorRelationship>();

  if (!rel) {
    throw new Error('Relationship not found or not active');
  }

  return rel;
}

/**
 * Get the other user in a relationship
 */
export function getOtherUserId(rel: TutorRelationship, myId: string): string {
  return rel.requester_id === myId ? rel.recipient_id : rel.requester_id;
}

/**
 * Get the current user's role in a relationship
 */
export function getMyRole(rel: TutorRelationship, myId: string): RelationshipRole {
  const iAmRequester = rel.requester_id === myId;
  if (iAmRequester) return rel.requester_role;
  return rel.requester_role === 'tutor' ? 'student' : 'tutor';
}

// ============ Daily Progress Types ============

export interface DailyActivitySummary {
  student: {
    id: string;
    name: string | null;
    email: string | null;
    picture_url: string | null;
  };
  summary: {
    total_reviews_30d: number;
    total_days_active: number;
    average_accuracy: number;
    total_time_ms: number;
  };
  days: Array<{
    date: string;
    reviews_count: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  }>;
}

export interface DayCardsDetail {
  date: string;
  summary: {
    total_reviews: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  };
  cards: Array<{
    card_id: string;
    card_type: string;
    note: {
      id: string;
      hanzi: string;
      pinyin: string;
      english: string;
    };
    review_count: number;
    ratings: number[];
    average_rating: number;
    total_time_ms: number;
    has_answers: boolean;
    has_recordings: boolean;
  }>;
}

export interface CardReviewsDetail {
  card: {
    id: string;
    card_type: string;
    note: {
      id: string;
      hanzi: string;
      pinyin: string;
      english: string;
      audio_url: string | null;
    };
  };
  reviews: Array<{
    id: string;
    reviewed_at: string;
    rating: number;
    time_spent_ms: number | null;
    user_answer: string | null;
    recording_url: string | null;
  }>;
}

/**
 * Get daily activity summary for a student (last 30 days)
 */
export async function getStudentDailyProgress(
  db: D1Database,
  relationshipId: string,
  tutorId: string
): Promise<DailyActivitySummary> {
  const rel = await verifyRelationshipAccess(db, relationshipId, tutorId);

  // Verify tutor is actually the tutor in this relationship
  const myRole = getMyRole(rel, tutorId);
  if (myRole !== 'tutor') {
    throw new Error('Only the tutor can view student progress');
  }

  const studentId = getOtherUserId(rel, tutorId);
  const student = await getUserSummary(db, studentId);
  if (!student) {
    throw new Error('Student not found');
  }

  // Get daily activity for last 30 days
  const dailyResult = await db.prepare(`
    SELECT
      date(cr.reviewed_at) as date,
      COUNT(*) as reviews_count,
      COUNT(DISTINCT cr.card_id) as unique_cards,
      AVG(CASE WHEN cr.rating >= 2 THEN 1.0 ELSE 0.0 END) * 100 as accuracy,
      SUM(cr.time_spent_ms) as time_spent_ms
    FROM card_reviews cr
    JOIN study_sessions ss ON cr.session_id = ss.id
    WHERE ss.user_id = ?
      AND cr.reviewed_at >= datetime('now', '-30 days')
    GROUP BY date(cr.reviewed_at)
    ORDER BY date DESC
  `).bind(studentId).all<{
    date: string;
    reviews_count: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  }>();

  const days = dailyResult.results || [];

  // Calculate summary stats
  const totalReviews30d = days.reduce((sum, d) => sum + d.reviews_count, 0);
  const totalDaysActive = days.length;
  const totalTimeMs = days.reduce((sum, d) => sum + (d.time_spent_ms || 0), 0);
  const avgAccuracy = days.length > 0
    ? Math.round(days.reduce((sum, d) => sum + d.accuracy, 0) / days.length)
    : 0;

  return {
    student: {
      id: student.id,
      name: student.name,
      email: student.email,
      picture_url: student.picture_url,
    },
    summary: {
      total_reviews_30d: totalReviews30d,
      total_days_active: totalDaysActive,
      average_accuracy: avgAccuracy,
      total_time_ms: totalTimeMs,
    },
    days: days.map(d => ({
      date: d.date,
      reviews_count: d.reviews_count,
      unique_cards: d.unique_cards,
      accuracy: Math.round(d.accuracy),
      time_spent_ms: d.time_spent_ms || 0,
    })),
  };
}

/**
 * Get cards reviewed on a specific day
 */
export async function getStudentDayCards(
  db: D1Database,
  relationshipId: string,
  tutorId: string,
  date: string
): Promise<DayCardsDetail> {
  const rel = await verifyRelationshipAccess(db, relationshipId, tutorId);

  const myRole = getMyRole(rel, tutorId);
  if (myRole !== 'tutor') {
    throw new Error('Only the tutor can view student progress');
  }

  const studentId = getOtherUserId(rel, tutorId);

  // Get cards reviewed that day with aggregated stats
  const cardsResult = await db.prepare(`
    SELECT
      c.id as card_id,
      c.card_type,
      n.id as note_id,
      n.hanzi,
      n.pinyin,
      n.english,
      COUNT(*) as review_count,
      GROUP_CONCAT(cr.rating) as ratings,
      AVG(cr.rating) as avg_rating,
      SUM(cr.time_spent_ms) as total_time_ms,
      MAX(CASE WHEN cr.user_answer IS NOT NULL AND cr.user_answer != '' THEN 1 ELSE 0 END) as has_answers,
      MAX(CASE WHEN cr.recording_url IS NOT NULL AND cr.recording_url != '' THEN 1 ELSE 0 END) as has_recordings
    FROM card_reviews cr
    JOIN study_sessions ss ON cr.session_id = ss.id
    JOIN cards c ON cr.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE ss.user_id = ?
      AND date(cr.reviewed_at) = ?
    GROUP BY c.id
    ORDER BY review_count DESC, avg_rating ASC
  `).bind(studentId, date).all<{
    card_id: string;
    card_type: string;
    note_id: string;
    hanzi: string;
    pinyin: string;
    english: string;
    review_count: number;
    ratings: string;
    avg_rating: number;
    total_time_ms: number;
    has_answers: number;
    has_recordings: number;
  }>();

  const cards = (cardsResult.results || []).map(r => ({
    card_id: r.card_id,
    card_type: r.card_type,
    note: {
      id: r.note_id,
      hanzi: r.hanzi,
      pinyin: r.pinyin,
      english: r.english,
    },
    review_count: r.review_count,
    ratings: r.ratings ? r.ratings.split(',').map(Number) : [],
    average_rating: r.avg_rating,
    total_time_ms: r.total_time_ms || 0,
    has_answers: r.has_answers === 1,
    has_recordings: r.has_recordings === 1,
  }));

  // Calculate summary
  const totalReviews = cards.reduce((sum, c) => sum + c.review_count, 0);
  const allRatings = cards.flatMap(c => c.ratings);
  const accuracy = allRatings.length > 0
    ? Math.round((allRatings.filter(r => r >= 2).length / allRatings.length) * 100)
    : 0;
  const totalTimeMs = cards.reduce((sum, c) => sum + c.total_time_ms, 0);

  return {
    date,
    summary: {
      total_reviews: totalReviews,
      unique_cards: cards.length,
      accuracy,
      time_spent_ms: totalTimeMs,
    },
    cards,
  };
}

/**
 * Get review details for a specific card on a specific day
 */
export async function getStudentCardReviews(
  db: D1Database,
  relationshipId: string,
  tutorId: string,
  date: string,
  cardId: string
): Promise<CardReviewsDetail> {
  const rel = await verifyRelationshipAccess(db, relationshipId, tutorId);

  const myRole = getMyRole(rel, tutorId);
  if (myRole !== 'tutor') {
    throw new Error('Only the tutor can view student progress');
  }

  const studentId = getOtherUserId(rel, tutorId);

  // Get card with note info
  const cardResult = await db.prepare(`
    SELECT
      c.id,
      c.card_type,
      n.id as note_id,
      n.hanzi,
      n.pinyin,
      n.english,
      n.audio_url
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE c.id = ?
  `).bind(cardId).first<{
    id: string;
    card_type: string;
    note_id: string;
    hanzi: string;
    pinyin: string;
    english: string;
    audio_url: string | null;
  }>();

  if (!cardResult) {
    throw new Error('Card not found');
  }

  // Get reviews for that card on that day
  const reviewsResult = await db.prepare(`
    SELECT
      cr.id,
      cr.reviewed_at,
      cr.rating,
      cr.time_spent_ms,
      cr.user_answer,
      cr.recording_url
    FROM card_reviews cr
    JOIN study_sessions ss ON cr.session_id = ss.id
    WHERE cr.card_id = ?
      AND ss.user_id = ?
      AND date(cr.reviewed_at) = ?
    ORDER BY cr.reviewed_at ASC
  `).bind(cardId, studentId, date).all<{
    id: string;
    reviewed_at: string;
    rating: number;
    time_spent_ms: number | null;
    user_answer: string | null;
    recording_url: string | null;
  }>();

  return {
    card: {
      id: cardResult.id,
      card_type: cardResult.card_type,
      note: {
        id: cardResult.note_id,
        hanzi: cardResult.hanzi,
        pinyin: cardResult.pinyin,
        english: cardResult.english,
        audio_url: cardResult.audio_url,
      },
    },
    reviews: reviewsResult.results || [],
  };
}

/**
 * Get student progress for a tutor
 */
export async function getStudentProgress(
  db: D1Database,
  relationshipId: string,
  tutorId: string
): Promise<StudentProgress> {
  const rel = await verifyRelationshipAccess(db, relationshipId, tutorId);

  // Verify tutor is actually the tutor in this relationship
  const myRole = getMyRole(rel, tutorId);
  if (myRole !== 'tutor') {
    throw new Error('Only the tutor can view student progress');
  }

  const studentId = getOtherUserId(rel, tutorId);
  const student = await getUserSummary(db, studentId);
  if (!student) {
    throw new Error('Student not found');
  }

  // Get student stats
  const [totalCards, cardsDue, studiedToday, studiedThisWeek, avgAccuracy] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) as count FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE d.user_id = ?
    `).bind(studentId).first<{ count: number }>(),

    db.prepare(`
      SELECT COUNT(*) as count FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
    `).bind(studentId).first<{ count: number }>(),

    db.prepare(`
      SELECT COUNT(*) as count FROM card_reviews cr
      JOIN study_sessions ss ON cr.session_id = ss.id
      WHERE ss.user_id = ? AND date(cr.reviewed_at) = date('now')
    `).bind(studentId).first<{ count: number }>(),

    db.prepare(`
      SELECT COUNT(*) as count FROM card_reviews cr
      JOIN study_sessions ss ON cr.session_id = ss.id
      WHERE ss.user_id = ? AND cr.reviewed_at >= datetime('now', '-7 days')
    `).bind(studentId).first<{ count: number }>(),

    db.prepare(`
      SELECT AVG(CASE WHEN rating >= 2 THEN 1.0 ELSE 0.0 END) as avg FROM card_reviews cr
      JOIN study_sessions ss ON cr.session_id = ss.id
      WHERE ss.user_id = ?
    `).bind(studentId).first<{ avg: number | null }>(),
  ]);

  // Get deck progress
  const decksResult = await db.prepare(`
    SELECT
      d.id,
      d.name,
      (SELECT COUNT(*) FROM notes WHERE deck_id = d.id) as total_notes,
      (SELECT COUNT(*) FROM cards c JOIN notes n ON c.note_id = n.id
       WHERE n.deck_id = d.id AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))) as cards_due,
      (SELECT COUNT(*) FROM cards c JOIN notes n ON c.note_id = n.id
       WHERE n.deck_id = d.id AND c.interval > 21) as cards_mastered
    FROM decks d
    WHERE d.user_id = ?
    ORDER BY d.updated_at DESC
  `).bind(studentId).all<{
    id: string;
    name: string;
    total_notes: number;
    cards_due: number;
    cards_mastered: number;
  }>();

  return {
    user: student,
    stats: {
      total_cards: totalCards?.count || 0,
      cards_due_today: cardsDue?.count || 0,
      cards_studied_today: studiedToday?.count || 0,
      cards_studied_this_week: studiedThisWeek?.count || 0,
      average_accuracy: avgAccuracy?.avg ? Math.round(avgAccuracy.avg * 100) : 0,
    },
    decks: decksResult.results,
  };
}
