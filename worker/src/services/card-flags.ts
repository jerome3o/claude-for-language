/**
 * Card flags: a student flags one card for their tutor with a short note,
 * the tutor replies (or just resolves it), and the student sees the reply
 * once on the back of that card. Rows live in `card_flags`; each write is
 * also mirrored into the relationship's chat so the other side's usual
 * unread badge / notification fires. The ids are client-generated so a flag
 * queued offline can be re-posted safely.
 */

import { sqliteToIso } from '@shared/chats';
import type { TutorRelationship } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from './relationships';
import { createConversation, sendMessage } from './conversations';
import { fetchLastConversationId } from '../db/tutor-dashboard-queries';

export type CardFlagStatus = 'open' | 'resolved';

export interface CardFlagRow {
  id: string;
  relationship_id: string;
  student_id: string;
  tutor_id: string;
  note_id: string;
  card_id: string | null;
  message: string;
  status: CardFlagStatus;
  tutor_reply: string | null;
  replied_at: string | null;
  student_seen_reply_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** A flag with the card it points at, as both the student page and the tutor page show it. */
export interface CardFlag extends CardFlagRow {
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  card_type: string | null;
  student_name: string | null;
  tutor_name: string | null;
}

export interface CreateCardFlagInput {
  /** Client id (uuid) so an offline-queued flag can be re-sent; server makes one when missing. */
  id?: string;
  relationship_id: string;
  note_id: string;
  card_id?: string | null;
  message: string;
  /** When the student wrote it (offline queue); defaults to now. */
  created_at?: string;
}

export class CardFlagError extends Error {
  constructor(public status: 400 | 403 | 404, message: string) {
    super(message);
  }
}

export const MAX_FLAG_MESSAGE = 2000;

const FLAG_SELECT = `
  SELECT f.*, n.hanzi, n.pinyin, n.english, d.id AS deck_id, d.name AS deck_name,
         c.card_type, su.name AS student_name, tu.name AS tutor_name
  FROM card_flags f
  JOIN notes n ON n.id = f.note_id
  JOIN decks d ON d.id = n.deck_id
  LEFT JOIN cards c ON c.id = f.card_id
  LEFT JOIN users su ON su.id = f.student_id
  LEFT JOIN users tu ON tu.id = f.tutor_id`;

function normalize(row: CardFlag): CardFlag {
  return {
    ...row,
    created_at: sqliteToIso(row.created_at),
    replied_at: row.replied_at ? sqliteToIso(row.replied_at) : null,
    resolved_at: row.resolved_at ? sqliteToIso(row.resolved_at) : null,
    student_seen_reply_at: row.student_seen_reply_at ? sqliteToIso(row.student_seen_reply_at) : null,
  };
}

export async function getCardFlag(db: D1Database, id: string): Promise<CardFlag | null> {
  const row = await db.prepare(`${FLAG_SELECT} WHERE f.id = ?`).bind(id).first<CardFlag>();
  return row ? normalize(row) : null;
}

async function requireActiveRelationship(db: D1Database, relId: string, userId: string): Promise<TutorRelationship> {
  try {
    return await verifyRelationshipAccess(db, relId, userId);
  } catch {
    throw new CardFlagError(404, 'Relationship not found or not active');
  }
}

/** Post a line into the relationship's most recent chat (created if none) as `senderId`. Best effort. */
async function mirrorToChat(db: D1Database, relId: string, senderId: string, content: string): Promise<void> {
  try {
    let conversationId = await fetchLastConversationId(db, relId);
    if (!conversationId) conversationId = (await createConversation(db, relId, senderId, {})).id;
    await sendMessage(db, conversationId, senderId, content);
  } catch (err) {
    console.error('[card-flags] chat mirror failed:', err);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function validIso(value: string | undefined): string {
  if (!value) return isoNow();
  const t = Date.parse(value);
  if (Number.isNaN(t) || t > Date.now() + 5 * 60_000) return isoNow();
  return new Date(t).toISOString();
}

/** What the tutor sees in the chat when a flag arrives. */
export function flagChatMessage(flag: Pick<CardFlag, 'hanzi' | 'pinyin' | 'english' | 'message'>): string {
  return `🚩 Flagged ${flag.hanzi} (${flag.pinyin} · ${flag.english}): ${flag.message}`;
}

/** What the student sees in the chat when the tutor replies. */
export function replyChatMessage(flag: Pick<CardFlag, 'hanzi'>, reply: string): string {
  return `🚩 About ${flag.hanzi}: ${reply}`;
}

/**
 * Student → tutor. Idempotent by `id`: re-posting a queued flag returns the
 * existing row without a second chat message.
 */
export async function createCardFlag(
  db: D1Database,
  studentId: string,
  input: CreateCardFlagInput
): Promise<{ flag: CardFlag; created: boolean }> {
  const message = (input.message || '').trim();
  if (!message) throw new CardFlagError(400, 'Write a note for your tutor first');
  if (message.length > MAX_FLAG_MESSAGE) throw new CardFlagError(400, `Keep the note under ${MAX_FLAG_MESSAGE} characters`);
  if (!input.relationship_id || !input.note_id) throw new CardFlagError(400, 'relationship_id and note_id are required');

  if (input.id) {
    const existing = await getCardFlag(db, input.id);
    if (existing) {
      if (existing.student_id !== studentId) throw new CardFlagError(403, 'Not your flag');
      return { flag: existing, created: false };
    }
  }

  const rel = await requireActiveRelationship(db, input.relationship_id, studentId);
  if (getMyRole(rel, studentId) !== 'student') throw new CardFlagError(403, 'Only the student can flag a card for the tutor');
  const tutorId = getOtherUserId(rel, studentId);

  const note = await db
    .prepare('SELECT n.id FROM notes n JOIN decks d ON d.id = n.deck_id WHERE n.id = ? AND d.user_id = ?')
    .bind(input.note_id, studentId)
    .first<{ id: string }>();
  if (!note) throw new CardFlagError(404, 'Card not found');

  let cardId: string | null = null;
  if (input.card_id) {
    const card = await db
      .prepare('SELECT id FROM cards WHERE id = ? AND note_id = ?')
      .bind(input.card_id, input.note_id)
      .first<{ id: string }>();
    cardId = card?.id ?? null;
  }

  const id = input.id || crypto.randomUUID();
  await db
    .prepare(
      `INSERT OR IGNORE INTO card_flags (id, relationship_id, student_id, tutor_id, note_id, card_id, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    )
    .bind(id, rel.id, studentId, tutorId, input.note_id, cardId, message, validIso(input.created_at))
    .run();

  const flag = await getCardFlag(db, id);
  if (!flag) throw new Error('Failed to create the flag');
  await mirrorToChat(db, rel.id, studentId, flagChatMessage(flag));
  return { flag, created: true };
}

/** Flags in a relationship, newest first; either party may read them. */
export async function listCardFlags(
  db: D1Database,
  relId: string,
  userId: string,
  opts: { status?: CardFlagStatus | 'all'; limit?: number } = {}
): Promise<CardFlag[]> {
  await requireActiveRelationship(db, relId, userId);
  const status = opts.status ?? 'all';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const where = status === 'all' ? '' : ' AND f.status = ?';
  const stmt = db.prepare(`${FLAG_SELECT} WHERE f.relationship_id = ?${where} ORDER BY f.created_at DESC LIMIT ?`);
  const res = status === 'all' ? await stmt.bind(relId, limit).all<CardFlag>() : await stmt.bind(relId, status, limit).all<CardFlag>();
  return (res.results || []).map(normalize);
}

/** Flags on one note, newest first, for the card hub; scoped to a party of the flag. */
export async function listCardFlagsForNote(db: D1Database, noteId: string, userId: string): Promise<CardFlag[]> {
  const res = await db
    .prepare(`${FLAG_SELECT} WHERE f.note_id = ? AND (f.student_id = ? OR f.tutor_id = ?) ORDER BY f.created_at DESC LIMIT 100`)
    .bind(noteId, userId, userId)
    .all<CardFlag>();
  return (res.results || []).map(normalize);
}

export async function countOpenCardFlags(db: D1Database, relId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM card_flags WHERE relationship_id = ? AND status = 'open'`)
    .bind(relId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Tutor → student. Sets the reply, resolves the flag, mirrors the reply into the chat. */
export async function replyToCardFlag(db: D1Database, flagId: string, tutorId: string, reply: string): Promise<CardFlag> {
  const text = (reply || '').trim();
  if (!text) throw new CardFlagError(400, 'Write a reply first');
  if (text.length > MAX_FLAG_MESSAGE) throw new CardFlagError(400, `Keep the reply under ${MAX_FLAG_MESSAGE} characters`);
  const flag = await getCardFlag(db, flagId);
  if (!flag) throw new CardFlagError(404, 'Flag not found');
  if (flag.tutor_id !== tutorId) throw new CardFlagError(403, 'Only the tutor can reply');
  const now = isoNow();
  await db
    .prepare(
      `UPDATE card_flags
       SET tutor_reply = ?, replied_at = ?, student_seen_reply_at = NULL, status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE id = ?`
    )
    .bind(text, now, now, flagId)
    .run();
  const updated = (await getCardFlag(db, flagId))!;
  await mirrorToChat(db, flag.relationship_id, tutorId, replyChatMessage(flag, text));
  return updated;
}

/** Either party closes a flag without a reply (or reopens it). */
export async function setCardFlagStatus(db: D1Database, flagId: string, userId: string, status: CardFlagStatus): Promise<CardFlag> {
  const flag = await getCardFlag(db, flagId);
  if (!flag) throw new CardFlagError(404, 'Flag not found');
  if (flag.tutor_id !== userId && flag.student_id !== userId) throw new CardFlagError(403, 'Not your flag');
  await db
    .prepare(`UPDATE card_flags SET status = ?, resolved_at = ? WHERE id = ?`)
    .bind(status, status === 'resolved' ? isoNow() : null, flagId)
    .run();
  return (await getCardFlag(db, flagId))!;
}

/** Student deletes a flag they sent (the mirrored chat line stays). */
export async function deleteCardFlag(db: D1Database, flagId: string, studentId: string): Promise<void> {
  const flag = await getCardFlag(db, flagId);
  if (!flag) throw new CardFlagError(404, 'Flag not found');
  if (flag.student_id !== studentId) throw new CardFlagError(403, 'Only the student who sent it can delete a flag');
  await db.prepare('DELETE FROM card_flags WHERE id = ?').bind(flagId).run();
}

/**
 * Tutor replies the student has not seen on the card back yet. Same shape
 * as the recording notes so the client shows both through one line.
 */
export interface UnseenFlagReply {
  flag_id: string;
  card_id: string | null;
  note_id: string;
  hanzi: string;
  reply: string;
  tutor_name: string | null;
  replied_at: string;
}

export async function listUnseenFlagReplies(db: D1Database, studentId: string): Promise<UnseenFlagReply[]> {
  const res = await db
    .prepare(
      `SELECT f.id AS flag_id, f.card_id, f.note_id, n.hanzi, f.tutor_reply AS reply, u.name AS tutor_name, f.replied_at
       FROM card_flags f
       JOIN notes n ON n.id = f.note_id
       LEFT JOIN users u ON u.id = f.tutor_id
       WHERE f.student_id = ? AND f.tutor_reply IS NOT NULL AND f.tutor_reply != '' AND f.student_seen_reply_at IS NULL
       ORDER BY f.replied_at DESC
       LIMIT 200`
    )
    .bind(studentId)
    .all<UnseenFlagReply>();
  return (res.results || []).map((r) => ({ ...r, replied_at: sqliteToIso(r.replied_at) }));
}

/** The student saw the reply on the card back. Returns whether a row changed. */
export async function markFlagReplySeen(db: D1Database, flagId: string, studentId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE card_flags SET student_seen_reply_at = COALESCE(student_seen_reply_at, datetime('now'))
       WHERE id = ? AND student_id = ? AND tutor_reply IS NOT NULL`
    )
    .bind(flagId, studentId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
