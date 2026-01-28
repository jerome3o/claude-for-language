import {
  TutorRelationship,
  TutorRelationshipWithUsers,
  MyRelationships,
  RelationshipRole,
  User,
  StudentProgress,
  CLAUDE_AI_USER_ID,
  PendingInvitation,
  PendingInvitationWithInviter,
} from '../types';

function generateId(): string {
  return crypto.randomUUID();
}

type UserSummary = Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;

// ============ Relationships ============

export async function getUserByEmail(
  db: D1Database,
  email: string
): Promise<User | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<User>();
}

async function getUserSummary(
  db: D1Database,
  userId: string
): Promise<UserSummary | null> {
  return db
    .prepare('SELECT id, email, name, picture_url FROM users WHERE id = ?')
    .bind(userId)
    .first<UserSummary>();
}

// Result type for createRelationship - can be either a relationship or pending invitation
export type CreateRelationshipResult =
  | { type: 'relationship'; data: TutorRelationshipWithUsers }
  | { type: 'invitation'; data: PendingInvitationWithInviter };

export async function createRelationship(
  db: D1Database,
  requesterId: string,
  recipientEmail: string,
  requesterRole: RelationshipRole
): Promise<CreateRelationshipResult> {
  const recipient = await getUserByEmail(db, recipientEmail);

  // If recipient doesn't exist, create a pending invitation
  if (!recipient) {
    return createPendingInvitation(db, requesterId, recipientEmail, requesterRole);
  }

  if (recipient.id === requesterId) {
    throw new Error('Cannot create a relationship with yourself');
  }

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

  const relationship = await getRelationshipById(db, id) as TutorRelationshipWithUsers;
  return { type: 'relationship', data: relationship };
}

// Create a pending invitation for a non-user
async function createPendingInvitation(
  db: D1Database,
  inviterId: string,
  recipientEmail: string,
  inviterRole: RelationshipRole
): Promise<CreateRelationshipResult> {
  // Check for existing pending invitation (same inviter + email)
  const existing = await db
    .prepare(`
      SELECT * FROM pending_invitations
      WHERE inviter_id = ? AND recipient_email = ? AND status = 'pending'
      AND expires_at > datetime('now')
    `)
    .bind(inviterId, recipientEmail)
    .first<PendingInvitation>();

  if (existing) {
    // Return existing invitation (idempotent)
    const inviter = await getUserSummary(db, inviterId);
    if (!inviter) throw new Error('Inviter not found');
    return {
      type: 'invitation',
      data: { ...existing, inviter },
    };
  }

  // Check if there's already a relationship (recipient signed up after invitation)
  // by checking if the recipient_email now belongs to a user
  const possibleUser = await getUserByEmail(db, recipientEmail);
  if (possibleUser) {
    // User exists now, create a regular relationship instead
    const relResult = await createRelationship(db, inviterId, recipientEmail, inviterRole);
    return relResult;
  }

  // Create new pending invitation (expires in 30 days)
  const id = generateId();
  await db
    .prepare(`
      INSERT INTO pending_invitations (id, inviter_id, recipient_email, inviter_role, status, expires_at)
      VALUES (?, ?, ?, ?, 'pending', datetime('now', '+30 days'))
    `)
    .bind(id, inviterId, recipientEmail, inviterRole)
    .run();

  const invitation = await db
    .prepare('SELECT * FROM pending_invitations WHERE id = ?')
    .bind(id)
    .first<PendingInvitation>();

  if (!invitation) throw new Error('Failed to create invitation');

  const inviter = await getUserSummary(db, inviterId);
  if (!inviter) throw new Error('Inviter not found');

  return {
    type: 'invitation',
    data: { ...invitation, inviter },
  };
}

// Get a pending invitation by ID
export async function getPendingInvitationById(
  db: D1Database,
  invitationId: string
): Promise<PendingInvitationWithInviter | null> {
  const invitation = await db
    .prepare('SELECT * FROM pending_invitations WHERE id = ?')
    .bind(invitationId)
    .first<PendingInvitation>();

  if (!invitation) return null;

  const inviter = await getUserSummary(db, invitation.inviter_id);
  if (!inviter) return null;

  return { ...invitation, inviter };
}

// Cancel a pending invitation
export async function cancelPendingInvitation(
  db: D1Database,
  invitationId: string,
  userId: string
): Promise<void> {
  const invitation = await db
    .prepare('SELECT * FROM pending_invitations WHERE id = ?')
    .bind(invitationId)
    .first<PendingInvitation>();

  if (!invitation) {
    throw new Error('Invitation not found');
  }

  if (invitation.inviter_id !== userId) {
    throw new Error('Not authorized to cancel this invitation');
  }

  if (invitation.status !== 'pending') {
    throw new Error('Invitation is not pending');
  }

  await db
    .prepare(`UPDATE pending_invitations SET status = 'cancelled' WHERE id = ?`)
    .bind(invitationId)
    .run();
}

// Process pending invitations when a new user signs up
// This creates active relationships for all pending invitations to this email
export async function processPendingInvitations(
  db: D1Database,
  newUser: User
): Promise<number> {
  if (!newUser.email) return 0;

  // Find all pending, non-expired invitations for this email
  const invitations = await db
    .prepare(`
      SELECT * FROM pending_invitations
      WHERE recipient_email = ? AND status = 'pending'
      AND expires_at > datetime('now')
    `)
    .bind(newUser.email)
    .all<PendingInvitation>();

  let connectionsCreated = 0;

  for (const invitation of invitations.results) {
    try {
      // Create the relationship with status 'active' (auto-accepted)
      const id = generateId();
      await db
        .prepare(`
          INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status, accepted_at)
          VALUES (?, ?, ?, ?, 'active', datetime('now'))
        `)
        .bind(id, invitation.inviter_id, newUser.id, invitation.inviter_role)
        .run();

      // Mark invitation as accepted
      await db
        .prepare(`
          UPDATE pending_invitations
          SET status = 'accepted', accepted_at = datetime('now')
          WHERE id = ?
        `)
        .bind(invitation.id)
        .run();

      connectionsCreated++;
      console.log(`[PendingInvitations] Created relationship from invitation ${invitation.id} for user ${newUser.id}`);
    } catch (error) {
      console.error(`[PendingInvitations] Failed to process invitation ${invitation.id}:`, error);
    }
  }

  return connectionsCreated;
}

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

export async function getMyRelationships(
  db: D1Database,
  userId: string
): Promise<MyRelationships> {
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

  const userIds = new Set<string>();
  for (const rel of relationships) {
    userIds.add(rel.requester_id);
    userIds.add(rel.recipient_id);
  }

  const userMap = new Map<string, UserSummary>();
  for (const uid of userIds) {
    const user = await getUserSummary(db, uid);
    if (user) userMap.set(uid, user);
  }

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

  // Get pending invitations (invitations to non-users)
  const invitationsResult = await db
    .prepare(`
      SELECT * FROM pending_invitations
      WHERE inviter_id = ? AND status = 'pending'
      AND expires_at > datetime('now')
      ORDER BY created_at DESC
    `)
    .bind(userId)
    .all<PendingInvitation>();

  const pendingInvitations: PendingInvitationWithInviter[] = [];
  const inviter = await getUserSummary(db, userId);

  if (inviter) {
    for (const inv of invitationsResult.results) {
      pendingInvitations.push({ ...inv, inviter });
    }
  }

  return {
    tutors,
    students,
    pending_incoming: pendingIncoming,
    pending_outgoing: pendingOutgoing,
    pending_invitations: pendingInvitations,
  };
}

export async function acceptRelationship(
  db: D1Database,
  relationshipId: string,
  userId: string
): Promise<TutorRelationshipWithUsers> {
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

export function getOtherUserId(rel: TutorRelationship, myId: string): string {
  return rel.requester_id === myId ? rel.recipient_id : rel.requester_id;
}

export function getMyRole(rel: TutorRelationship, myId: string): RelationshipRole {
  const iAmRequester = rel.requester_id === myId;
  if (iAmRequester) return rel.requester_role;
  return rel.requester_role === 'tutor' ? 'student' : 'tutor';
}

/**
 * Ensure the user has a relationship with Claude AI tutor.
 * Creates one if it doesn't exist (auto-accepted).
 * Returns the relationship ID.
 */
export async function ensureClaudeRelationship(
  db: D1Database,
  userId: string
): Promise<string> {
  // Don't create a relationship for Claude with itself
  if (userId === CLAUDE_AI_USER_ID) {
    throw new Error('Cannot create Claude relationship for Claude');
  }

  // Check if relationship already exists
  const existing = await db
    .prepare(`
      SELECT id FROM tutor_relationships
      WHERE ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
      AND status != 'removed'
    `)
    .bind(userId, CLAUDE_AI_USER_ID, CLAUDE_AI_USER_ID, userId)
    .first<{ id: string }>();

  if (existing) {
    return existing.id;
  }

  // Create new relationship with Claude as tutor, auto-accepted
  const id = generateId();
  await db
    .prepare(`
      INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status, accepted_at)
      VALUES (?, ?, ?, 'student', 'active', datetime('now'))
    `)
    .bind(id, userId, CLAUDE_AI_USER_ID)
    .run();

  console.log('[Relationships] Created Claude relationship for user:', userId);
  return id;
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

  const myRole = getMyRole(rel, tutorId);
  if (myRole !== 'tutor') {
    throw new Error('Only the tutor can view student progress');
  }

  const studentId = getOtherUserId(rel, tutorId);
  const student = await getUserSummary(db, studentId);
  if (!student) {
    throw new Error('Student not found');
  }

  // Get daily activity for last 30 days from review_events
  const dailyResult = await db.prepare(`
    SELECT
      date(re.reviewed_at) as date,
      COUNT(*) as reviews_count,
      COUNT(DISTINCT re.card_id) as unique_cards,
      AVG(CASE WHEN re.rating >= 2 THEN 1.0 ELSE 0.0 END) * 100 as accuracy,
      SUM(re.time_spent_ms) as time_spent_ms
    FROM review_events re
    WHERE re.user_id = ?
      AND re.reviewed_at >= datetime('now', '-30 days')
    GROUP BY date(re.reviewed_at)
    ORDER BY date DESC
  `).bind(studentId).all<{
    date: string;
    reviews_count: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  }>();

  const days = dailyResult.results || [];

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

  // Get cards reviewed that day with aggregated stats from review_events
  const cardsResult = await db.prepare(`
    SELECT
      c.id as card_id,
      c.card_type,
      n.id as note_id,
      n.hanzi,
      n.pinyin,
      n.english,
      COUNT(*) as review_count,
      GROUP_CONCAT(re.rating) as ratings,
      AVG(re.rating) as avg_rating,
      SUM(re.time_spent_ms) as total_time_ms,
      MAX(CASE WHEN re.user_answer IS NOT NULL AND re.user_answer != '' THEN 1 ELSE 0 END) as has_answers,
      MAX(CASE WHEN re.recording_url IS NOT NULL AND re.recording_url != '' THEN 1 ELSE 0 END) as has_recordings
    FROM review_events re
    JOIN cards c ON re.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE re.user_id = ?
      AND date(re.reviewed_at) = ?
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

  // Get reviews for that card on that day from review_events
  const reviewsResult = await db.prepare(`
    SELECT
      re.id,
      re.reviewed_at,
      re.rating,
      re.time_spent_ms,
      re.user_answer,
      re.recording_url
    FROM review_events re
    WHERE re.card_id = ?
      AND re.user_id = ?
      AND date(re.reviewed_at) = ?
    ORDER BY re.reviewed_at ASC
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

// ============ Self Progress (for viewing own progress) ============

/**
 * Get daily activity summary for the current user (last 30 days)
 */
export async function getMyDailyProgress(
  db: D1Database,
  userId: string
): Promise<Omit<DailyActivitySummary, 'student'> & { summary: DailyActivitySummary['summary']; days: DailyActivitySummary['days'] }> {
  // Get daily activity for last 30 days from review_events
  const dailyResult = await db.prepare(`
    SELECT
      date(re.reviewed_at) as date,
      COUNT(*) as reviews_count,
      COUNT(DISTINCT re.card_id) as unique_cards,
      AVG(CASE WHEN re.rating >= 2 THEN 1.0 ELSE 0.0 END) * 100 as accuracy,
      SUM(re.time_spent_ms) as time_spent_ms
    FROM review_events re
    WHERE re.user_id = ?
      AND re.reviewed_at >= datetime('now', '-30 days')
    GROUP BY date(re.reviewed_at)
    ORDER BY date DESC
  `).bind(userId).all<{
    date: string;
    reviews_count: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  }>();

  const days = dailyResult.results || [];

  const totalReviews30d = days.reduce((sum, d) => sum + d.reviews_count, 0);
  const totalDaysActive = days.length;
  const totalTimeMs = days.reduce((sum, d) => sum + (d.time_spent_ms || 0), 0);
  const avgAccuracy = days.length > 0
    ? Math.round(days.reduce((sum, d) => sum + d.accuracy, 0) / days.length)
    : 0;

  return {
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
 * Get cards reviewed on a specific day for the current user
 */
export async function getMyDayCards(
  db: D1Database,
  userId: string,
  date: string
): Promise<DayCardsDetail> {
  // Get cards reviewed that day with aggregated stats from review_events
  const cardsResult = await db.prepare(`
    SELECT
      c.id as card_id,
      c.card_type,
      n.id as note_id,
      n.hanzi,
      n.pinyin,
      n.english,
      COUNT(*) as review_count,
      GROUP_CONCAT(re.rating) as ratings,
      AVG(re.rating) as avg_rating,
      SUM(re.time_spent_ms) as total_time_ms,
      MAX(CASE WHEN re.user_answer IS NOT NULL AND re.user_answer != '' THEN 1 ELSE 0 END) as has_answers,
      MAX(CASE WHEN re.recording_url IS NOT NULL AND re.recording_url != '' THEN 1 ELSE 0 END) as has_recordings
    FROM review_events re
    JOIN cards c ON re.card_id = c.id
    JOIN notes n ON c.note_id = n.id
    WHERE re.user_id = ?
      AND date(re.reviewed_at) = ?
    GROUP BY c.id
    ORDER BY review_count DESC, avg_rating ASC
  `).bind(userId, date).all<{
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
 * Get review details for a specific card on a specific day for the current user
 */
export async function getMyCardReviews(
  db: D1Database,
  userId: string,
  date: string,
  cardId: string
): Promise<CardReviewsDetail> {
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

  // Get reviews for that card on that day from review_events
  const reviewsResult = await db.prepare(`
    SELECT
      re.id,
      re.reviewed_at,
      re.rating,
      re.time_spent_ms,
      re.user_answer,
      re.recording_url
    FROM review_events re
    WHERE re.card_id = ?
      AND re.user_id = ?
      AND date(re.reviewed_at) = ?
    ORDER BY re.reviewed_at ASC
  `).bind(cardId, userId, date).all<{
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

  const myRole = getMyRole(rel, tutorId);
  if (myRole !== 'tutor') {
    throw new Error('Only the tutor can view student progress');
  }

  const studentId = getOtherUserId(rel, tutorId);
  const student = await getUserSummary(db, studentId);
  if (!student) {
    throw new Error('Student not found');
  }

  // Get student stats using review_events
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
      SELECT COUNT(*) as count FROM review_events re
      WHERE re.user_id = ? AND date(re.reviewed_at) = date('now')
    `).bind(studentId).first<{ count: number }>(),

    db.prepare(`
      SELECT COUNT(*) as count FROM review_events re
      WHERE re.user_id = ? AND re.reviewed_at >= datetime('now', '-7 days')
    `).bind(studentId).first<{ count: number }>(),

    db.prepare(`
      SELECT AVG(CASE WHEN rating >= 2 THEN 1.0 ELSE 0.0 END) as avg FROM review_events re
      WHERE re.user_id = ?
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
