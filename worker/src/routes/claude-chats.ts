/**
 * Ask-Claude history and the card hub. Mounted under /api in index.ts after
 * the auth middleware.
 *
 *   GET /me/claude-chats?limit&before&note_id                    my Ask-Claude questions, newest first
 *   GET /relationships/:relId/claude-chats?limit&before&note_id  the student's (tutor only)
 *   GET /notes/:noteId/hub                                       one of my cards: note, cards, recent reviews, questions, flags
 *   GET /relationships/:relId/notes/:noteId/hub                  the same for one of the student's cards (tutor only)
 *
 * LEGACY row shapes for installed builds from before the thread view: one row per Q&A, paged
 * keyset on asked_at (`next_cursor` back as `before`). All of it is served from the card threads
 * (services/claude-agent/card-questions.ts) — `note_questions` is frozen. The tutor's
 * (`/relationships/:relId/claude-chats` and her card hub's `questions`) only from the threads the
 * student lets her read (shared/claude/visibility.ts). Current apps read the threads themselves:
 * `/api/claude/threads?context_kind=card[&note_id=]` and `/relationships/:relId/claude-threads`.
 */

import { Hono } from 'hono';
import type { Env, Note } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';
import { listCardFlagsForNote, type CardFlag } from '../services/card-flags';
import { listCardQuestions, tutorCardQuestions, type CardQuestion } from '../services/claude-agent/card-questions';

const claudeChats = new Hono<{ Bindings: Env }>();

/** One Q&A on a card (older apps' row shape). */
export type ClaudeChatQuestion = CardQuestion;

export interface ClaudeChatsResponse {
  questions: ClaudeChatQuestion[];
  next_cursor: string | null;
  /** How many questions this user has asked in total (all cards). */
  total: number;
}

export interface NoteHubCard {
  id: string;
  card_type: string;
  queue: number;
  stability: number;
  difficulty: number;
  lapses: number;
  reps: number;
  next_review_at: string | null;
}

export interface NoteHubReview {
  id: string;
  card_id: string;
  card_type: string;
  rating: number;
  reviewed_at: string;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
}

export interface NoteHub {
  note: Note;
  deck: { id: string; name: string };
  owner: { id: string; name: string | null };
  cards: NoteHubCard[];
  recent_reviews: NoteHubReview[];
  /** "Forget this card": when a card of the note was reset to New (newest first). Never a review. */
  forgets: Array<{ id: string; card_id: string; card_type: string; forgotten_at: string }>;
  review_count: number;
  questions: ClaudeChatQuestion[];
  flags: CardFlag[];
}

class HttpError extends Error {
  constructor(public status: 403 | 404, message: string) {
    super(message);
  }
}

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  console.error('[claude-chats]', error);
  return c.json({ error: fallback }, 500);
}

/** The student's user id when `userId` is the tutor of `relId`. */
async function studentOf(db: D1Database, relId: string, userId: string): Promise<string> {
  let rel;
  try {
    rel = await verifyRelationshipAccess(db, relId, userId);
  } catch {
    throw new HttpError(404, 'Relationship not found or not active');
  }
  if (getMyRole(rel, userId) !== 'tutor') throw new HttpError(403, 'Only the tutor can view this');
  return getOtherUserId(rel, userId);
}

/** My questions (older apps' "Claude conversations" page), from my card threads. */
export function listClaudeChats(
  db: D1Database,
  ownerId: string,
  opts: { limit?: number; before?: string | null; noteId?: string | null },
): Promise<ClaudeChatsResponse> {
  return listCardQuestions(db, ownerId, opts);
}

/** One card's hub; `tutor` = the student's tutor asking (only the Claude questions he lets her read). */
export async function loadNoteHub(db: D1Database, ownerId: string, noteId: string, opts: { tutor?: boolean } = {}): Promise<NoteHub | null> {
  const note = await db
    .prepare('SELECT n.*, d.name AS deck_name FROM notes n JOIN decks d ON d.id = n.deck_id WHERE n.id = ? AND d.user_id = ?')
    .bind(noteId, ownerId)
    .first<Note & { deck_name: string }>();
  if (!note) return null;
  const { deck_name, ...noteRow } = note;

  const [owner, cards, reviews, reviewCount, questions, flags, forgets] = await Promise.all([
    db.prepare('SELECT id, name FROM users WHERE id = ?').bind(ownerId).first<{ id: string; name: string | null }>(),
    db
      .prepare('SELECT id, card_type, queue, stability, difficulty, lapses, repetitions AS reps, next_review_at FROM cards WHERE note_id = ? ORDER BY card_type')
      .bind(noteId)
      .all<NoteHubCard>(),
    db
      .prepare(
        `SELECT re.id, re.card_id, c.card_type, re.rating, re.reviewed_at, re.time_spent_ms, re.user_answer, re.recording_url
         FROM review_events re JOIN cards c ON c.id = re.card_id
         WHERE c.note_id = ? AND re.user_id = ?
         ORDER BY re.reviewed_at DESC LIMIT 30`
      )
      .bind(noteId, ownerId)
      .all<NoteHubReview>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM review_events re JOIN cards c ON c.id = re.card_id WHERE c.note_id = ? AND re.user_id = ?')
      .bind(noteId, ownerId)
      .first<{ n: number }>(),
    // Older apps' "Asked Claude" (current apps list the card's threads).
    (opts.tutor ? tutorCardQuestions : listCardQuestions)(db, ownerId, { noteId, limit: 200 }),
    listCardFlagsForNote(db, noteId, ownerId),
    db
      .prepare(
        `SELECT f.id, f.card_id, c.card_type, f.forgotten_at FROM card_forgets f JOIN cards c ON c.id = f.card_id
         WHERE c.note_id = ? AND f.user_id = ? AND f.undone_at IS NULL ORDER BY f.forgotten_at DESC`
      )
      .bind(noteId, ownerId)
      .all<{ id: string; card_id: string; card_type: string; forgotten_at: string }>()
      .catch(() => ({ results: [] as Array<{ id: string; card_id: string; card_type: string; forgotten_at: string }> })),
  ]);

  return {
    note: noteRow as Note,
    deck: { id: note.deck_id, name: deck_name },
    owner: { id: ownerId, name: owner?.name ?? null },
    cards: cards.results || [],
    recent_reviews: reviews.results || [],
    forgets: forgets.results || [],
    review_count: reviewCount?.n ?? 0,
    questions: questions.questions,
    flags,
  };
}

function pagingOpts(c: { req: { query: (k: string) => string | undefined } }) {
  const limitRaw = Number(c.req.query('limit'));
  return {
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
    before: c.req.query('before') || null,
    noteId: c.req.query('note_id') || null,
  };
}

claudeChats.get('/me/claude-chats', async (c) => {
  try {
    return c.json(await listClaudeChats(c.env.DB, c.get('user').id, pagingOpts(c)));
  } catch (error) {
    return errorResponse(c, error, 'Failed to load your Claude conversations');
  }
});

claudeChats.get('/relationships/:relId/claude-chats', async (c) => {
  try {
    const studentId = await studentOf(c.env.DB, c.req.param('relId'), c.get('user').id);
    return c.json(await tutorCardQuestions(c.env.DB, studentId, pagingOpts(c)));
  } catch (error) {
    return errorResponse(c, error, "Failed to load the student's Claude conversations");
  }
});

claudeChats.get('/notes/:noteId/hub', async (c) => {
  try {
    const hub = await loadNoteHub(c.env.DB, c.get('user').id, c.req.param('noteId'));
    if (!hub) return c.json({ error: 'Card not found' }, 404);
    return c.json(hub);
  } catch (error) {
    return errorResponse(c, error, 'Failed to load the card');
  }
});

claudeChats.get('/relationships/:relId/notes/:noteId/hub', async (c) => {
  try {
    const studentId = await studentOf(c.env.DB, c.req.param('relId'), c.get('user').id);
    // The tutor sees the flags on this card (scoped to the relationship's parties already) and only the
    // Claude questions the student lets her read.
    const hub = await loadNoteHub(c.env.DB, studentId, c.req.param('noteId'), { tutor: true });
    if (!hub) return c.json({ error: 'Card not found' }, 404);
    return c.json(hub);
  } catch (error) {
    return errorResponse(c, error, "Failed to load the student's card");
  }
});

export default claudeChats;
