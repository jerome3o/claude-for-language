/**
 * Ask-Claude history and the card hub. Mounted under /api in index.ts after
 * the auth middleware.
 *
 *   GET /me/claude-chats?limit&before&note_id                    my Ask-Claude questions, newest first
 *   GET /relationships/:relId/claude-chats?limit&before&note_id  the student's (tutor only)
 *   GET /notes/:noteId/hub                                       one of my cards: note, cards, recent reviews, questions, flags
 *   GET /relationships/:relId/notes/:noteId/hub                  the same for one of the student's cards (tutor only)
 *
 * Questions are one row per Q&A (`note_questions`); the client groups them
 * into threads with `groupQuestionThreads` (shared/chats). Paging is keyset
 * on asked_at: pass the response's `next_cursor` back as `before`.
 */

import { Hono } from 'hono';
import { sqliteToIso } from '@shared/chats';
import type { Env, Note } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';
import { listCardFlagsForNote, type CardFlag } from '../services/card-flags';

const claudeChats = new Hono<{ Bindings: Env }>();

export interface ClaudeChatQuestion {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

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

const QUESTION_SELECT = `
  SELECT nq.id, nq.note_id, nq.question, nq.answer, nq.asked_at,
         n.hanzi, n.pinyin, n.english, d.id AS deck_id, d.name AS deck_name
  FROM note_questions nq
  JOIN notes n ON n.id = nq.note_id
  JOIN decks d ON d.id = n.deck_id`;

function normalizeQuestion(q: ClaudeChatQuestion): ClaudeChatQuestion {
  return { ...q, asked_at: sqliteToIso(q.asked_at) };
}

export async function listClaudeChats(
  db: D1Database,
  ownerId: string,
  opts: { limit?: number; before?: string | null; noteId?: string | null }
): Promise<ClaudeChatsResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const conditions = ['d.user_id = ?'];
  const params: unknown[] = [ownerId];
  if (opts.noteId) {
    conditions.push('nq.note_id = ?');
    params.push(opts.noteId);
  }
  if (opts.before) {
    // Cursor is ISO; rows are stored as datetime('now') text. Compare in the stored format.
    conditions.push('nq.asked_at < ?');
    params.push(opts.before.replace('T', ' ').replace(/(\.\d+)?Z$/, ''));
  }
  const res = await db
    .prepare(`${QUESTION_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY nq.asked_at DESC, nq.id DESC LIMIT ?`)
    .bind(...params, limit + 1)
    .all<ClaudeChatQuestion>();
  const rows = (res.results || []).map(normalizeQuestion);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM note_questions nq JOIN notes n ON n.id = nq.note_id JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?`)
    .bind(ownerId)
    .first<{ n: number }>();
  return {
    questions: page,
    next_cursor: hasMore ? page[page.length - 1].asked_at : null,
    total: totalRow?.n ?? page.length,
  };
}

export async function loadNoteHub(db: D1Database, ownerId: string, noteId: string): Promise<NoteHub | null> {
  const note = await db
    .prepare('SELECT n.*, d.name AS deck_name FROM notes n JOIN decks d ON d.id = n.deck_id WHERE n.id = ? AND d.user_id = ?')
    .bind(noteId, ownerId)
    .first<Note & { deck_name: string }>();
  if (!note) return null;
  const { deck_name, ...noteRow } = note;

  const [owner, cards, reviews, reviewCount, questions, flags] = await Promise.all([
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
    db.prepare(`${QUESTION_SELECT} WHERE nq.note_id = ? ORDER BY nq.asked_at DESC LIMIT 200`).bind(noteId).all<ClaudeChatQuestion>(),
    listCardFlagsForNote(db, noteId, ownerId),
  ]);

  return {
    note: noteRow as Note,
    deck: { id: note.deck_id, name: deck_name },
    owner: { id: ownerId, name: owner?.name ?? null },
    cards: cards.results || [],
    recent_reviews: reviews.results || [],
    review_count: reviewCount?.n ?? 0,
    questions: (questions.results || []).map(normalizeQuestion),
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
    return c.json(await listClaudeChats(c.env.DB, studentId, pagingOpts(c)));
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
    const hub = await loadNoteHub(c.env.DB, studentId, c.req.param('noteId'));
    if (!hub) return c.json({ error: 'Card not found' }, 404);
    // The tutor sees the flags on this card; they are scoped to the relationship's parties already.
    return c.json(hub);
  } catch (error) {
    return errorResponse(c, error, "Failed to load the student's card");
  }
});

export default claudeChats;
