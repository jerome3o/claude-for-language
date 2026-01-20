import {
  TutorReviewRequest,
  TutorReviewRequestWithDetails,
  CreateTutorReviewRequest,
  TutorReviewRequestStatus,
  User,
  Note,
  Card,
  Deck,
  Rating,
} from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from './relationships';

function generateId(): string {
  return crypto.randomUUID();
}

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
 * Create a new tutor review request
 */
export async function createTutorReviewRequest(
  db: D1Database,
  studentId: string,
  request: CreateTutorReviewRequest
): Promise<TutorReviewRequestWithDetails> {
  // Verify relationship and that user is the student in this relationship
  const rel = await verifyRelationshipAccess(db, request.relationship_id, studentId);
  const myRole = getMyRole(rel, studentId);

  if (myRole !== 'student') {
    throw new Error('Only students can create review requests');
  }

  const tutorId = getOtherUserId(rel, studentId);

  // Verify note and card exist and belong to the student
  const card = await db.prepare(`
    SELECT c.*, n.deck_id
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE c.id = ? AND n.id = ? AND d.user_id = ?
  `).bind(request.card_id, request.note_id, studentId).first<Card & { deck_id: string }>();

  if (!card) {
    throw new Error('Card not found or does not belong to you');
  }

  // Verify review event if provided
  if (request.review_event_id) {
    const reviewEvent = await db.prepare(`
      SELECT * FROM review_events
      WHERE id = ? AND card_id = ? AND user_id = ?
    `).bind(request.review_event_id, request.card_id, studentId).first();

    if (!reviewEvent) {
      throw new Error('Review event not found or does not match the card');
    }
  }

  const id = generateId();

  await db.prepare(`
    INSERT INTO tutor_review_requests (
      id, relationship_id, student_id, tutor_id, note_id, card_id,
      review_event_id, message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    id,
    request.relationship_id,
    studentId,
    tutorId,
    request.note_id,
    request.card_id,
    request.review_event_id || null,
    request.message
  ).run();

  return getTutorReviewRequestById(db, id, studentId) as Promise<TutorReviewRequestWithDetails>;
}

/**
 * Get a tutor review request by ID with full details
 */
export async function getTutorReviewRequestById(
  db: D1Database,
  requestId: string,
  userId: string
): Promise<TutorReviewRequestWithDetails | null> {
  const request = await db.prepare(`
    SELECT * FROM tutor_review_requests WHERE id = ?
  `).bind(requestId).first<TutorReviewRequest>();

  if (!request) return null;

  // Verify user is either the student or tutor
  if (request.student_id !== userId && request.tutor_id !== userId) {
    return null;
  }

  return enrichRequestWithDetails(db, request);
}

/**
 * Enrich a tutor review request with full details (users, note, card, review event, deck)
 */
async function enrichRequestWithDetails(
  db: D1Database,
  request: TutorReviewRequest
): Promise<TutorReviewRequestWithDetails> {
  const [student, tutor, note, card, deck, reviewEvent] = await Promise.all([
    getUserSummary(db, request.student_id),
    getUserSummary(db, request.tutor_id),
    db.prepare('SELECT * FROM notes WHERE id = ?').bind(request.note_id).first<Note>(),
    db.prepare('SELECT * FROM cards WHERE id = ?').bind(request.card_id).first<Card>(),
    db.prepare(`
      SELECT d.id, d.name FROM decks d
      JOIN notes n ON n.deck_id = d.id
      WHERE n.id = ?
    `).bind(request.note_id).first<Pick<Deck, 'id' | 'name'>>(),
    request.review_event_id
      ? db.prepare(`
          SELECT id, rating, time_spent_ms, user_answer, recording_url, reviewed_at
          FROM review_events WHERE id = ?
        `).bind(request.review_event_id).first<{
          id: string;
          rating: Rating;
          time_spent_ms: number | null;
          user_answer: string | null;
          recording_url: string | null;
          reviewed_at: string;
        }>()
      : Promise.resolve(null),
  ]);

  if (!student || !tutor || !note || !card || !deck) {
    throw new Error('Failed to load request details');
  }

  return {
    ...request,
    student,
    tutor,
    note,
    card,
    deck,
    review_event: reviewEvent,
  };
}

/**
 * Get tutor's inbox (review requests sent to them)
 */
export async function getTutorReviewInbox(
  db: D1Database,
  tutorId: string,
  status?: TutorReviewRequestStatus
): Promise<TutorReviewRequestWithDetails[]> {
  let query = `
    SELECT * FROM tutor_review_requests
    WHERE tutor_id = ?
  `;
  const bindings: (string | null)[] = [tutorId];

  if (status) {
    query += ' AND status = ?';
    bindings.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const result = await db.prepare(query).bind(...bindings).all<TutorReviewRequest>();
  const requests = result.results || [];

  return Promise.all(requests.map(req => enrichRequestWithDetails(db, req)));
}

/**
 * Get student's sent review requests
 */
export async function getStudentSentRequests(
  db: D1Database,
  studentId: string,
  status?: TutorReviewRequestStatus
): Promise<TutorReviewRequestWithDetails[]> {
  let query = `
    SELECT * FROM tutor_review_requests
    WHERE student_id = ?
  `;
  const bindings: (string | null)[] = [studentId];

  if (status) {
    query += ' AND status = ?';
    bindings.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const result = await db.prepare(query).bind(...bindings).all<TutorReviewRequest>();
  const requests = result.results || [];

  return Promise.all(requests.map(req => enrichRequestWithDetails(db, req)));
}

/**
 * Respond to a tutor review request (tutor only)
 */
export async function respondToTutorReviewRequest(
  db: D1Database,
  requestId: string,
  tutorId: string,
  response: string
): Promise<TutorReviewRequestWithDetails> {
  const request = await db.prepare(`
    SELECT * FROM tutor_review_requests WHERE id = ?
  `).bind(requestId).first<TutorReviewRequest>();

  if (!request) {
    throw new Error('Review request not found');
  }

  if (request.tutor_id !== tutorId) {
    throw new Error('Only the tutor can respond to this request');
  }

  if (request.status !== 'pending') {
    throw new Error('This request has already been responded to');
  }

  await db.prepare(`
    UPDATE tutor_review_requests
    SET status = 'reviewed', tutor_response = ?, responded_at = datetime('now')
    WHERE id = ?
  `).bind(response, requestId).run();

  return getTutorReviewRequestById(db, requestId, tutorId) as Promise<TutorReviewRequestWithDetails>;
}

/**
 * Archive a tutor review request (either party can archive)
 */
export async function archiveTutorReviewRequest(
  db: D1Database,
  requestId: string,
  userId: string
): Promise<void> {
  const request = await db.prepare(`
    SELECT * FROM tutor_review_requests WHERE id = ?
  `).bind(requestId).first<TutorReviewRequest>();

  if (!request) {
    throw new Error('Review request not found');
  }

  if (request.student_id !== userId && request.tutor_id !== userId) {
    throw new Error('Not authorized to archive this request');
  }

  await db.prepare(`
    UPDATE tutor_review_requests SET status = 'archived' WHERE id = ?
  `).bind(requestId).run();
}

/**
 * Get count of pending review requests for a tutor (for badge/notification)
 */
export async function getPendingReviewRequestCount(
  db: D1Database,
  tutorId: string
): Promise<number> {
  const result = await db.prepare(`
    SELECT COUNT(*) as count FROM tutor_review_requests
    WHERE tutor_id = ? AND status = 'pending'
  `).bind(tutorId).first<{ count: number }>();

  return result?.count || 0;
}
