/**
 * Learning tools on chat messages (docs/CHAT.md PR 3): word chips made on
 * demand (`POST /api/messages/:id/words`) and the tutor's corrections
 * (`PUT|DELETE /api/messages/:id/correction`).
 */

import type { ChatCorrection, Env, MessageWithSender, TutorRelationship } from '../../types';
import type { ReaderWord } from '@shared/reader/words';
import { getMessageById } from '../conversations';
import { getMyRole } from '../relationships';
import { StructuredCallError } from '../structured-call';
import { ChatMessageError, currentUpdatedAt, defaultSegment, laterThan, loadMessageForMember, type Segment } from './messages';
import {
  CORRECTION_NOTE_MAX,
  CORRECTION_TEXT_MAX,
  parseCorrection,
  parseStoredWords,
  serializeWords,
  wordsTextOf,
  WORDS_MAX_CHARS,
  type WordsSource,
} from './words';
import { parseStoredAttachment } from './media';

// ---------- Word chips, lazily ----------

export interface MessageWordsResult {
  /** Null when the message has no Chinese to split (or a voice message not transcribed yet). */
  words: ReaderWord[] | null;
  source: WordsSource | null;
  /** True when they were already stored. */
  cached: boolean;
  /** True when this call stored new words (→ `message_updated`). */
  changed: boolean;
}

/**
 * The message's word chips, made now if missing or stale. Participants only;
 * idempotent (stored words that still match are returned as they are).
 */
export async function ensureMessageWords(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY'>,
  messageId: string,
  userId: string,
  deps: { segment?: Segment | null } = {},
): Promise<MessageWordsResult> {
  const msg = await loadMessageForMember(env.DB, messageId, userId);
  if (msg.deleted_at) throw new ChatMessageError('This message was deleted', 409);
  const row = await env.DB
    .prepare('SELECT content, attachment, words FROM messages WHERE id = ?')
    .bind(messageId)
    .first<{ content: string; attachment: string | null; words: string | null }>();
  if (!row) throw new ChatMessageError('Message not found', 404);
  const attachment = parseStoredAttachment(row.attachment);
  const target = wordsTextOf({ content: row.content, attachment });
  if (!target) return { words: null, source: null, cached: false, changed: false };

  const stored = parseStoredWords(row.words, { content: row.content, attachment });
  if (stored && stored.source === target.source) return { words: stored.words, source: stored.source, cached: true, changed: false };

  if (target.text.length > WORDS_MAX_CHARS) throw new ChatMessageError('This message is too long to split into words', 400);
  const segment = deps.segment === undefined ? defaultSegment(env) : deps.segment;
  if (!segment) throw new ChatMessageError('AI is not configured', 503);

  let words: ReaderWord[];
  try {
    words = await segment(target.text);
  } catch (err) {
    console.error('[chat] splitting message into words failed for', messageId, err instanceof Error ? err.message : err);
    const retryable = !(err instanceof StructuredCallError) || err.retryable;
    throw new ChatMessageError('Could not split this message into words just now — try again', retryable ? 503 : 502);
  }

  // Stored only while the text is still the one that was split.
  const at = laterThan(await currentUpdatedAt(env.DB, messageId));
  const res = target.source === 'content'
    ? await env.DB
        .prepare('UPDATE messages SET words = ?, updated_at = ? WHERE id = ? AND content = ? AND deleted_at IS NULL')
        .bind(serializeWords('content', words), at, messageId, row.content)
        .run()
    : await env.DB
        .prepare('UPDATE messages SET words = ?, updated_at = ? WHERE id = ? AND attachment = ? AND deleted_at IS NULL')
        .bind(serializeWords('transcript', words), at, messageId, row.attachment)
        .run();
  return { words, source: target.source, cached: false, changed: (res.meta?.changes ?? 0) > 0 };
}

// ---------- Corrections ----------

export interface CorrectionChange {
  message: MessageWithSender;
  changed: boolean;
  /** The student whose message it is (the one to notify). */
  studentId: string;
  relationshipId: string;
  correction: ChatCorrection | null;
}

/** The message, checked: the caller is the relationship's TUTOR, it is the other person's live text message. */
async function loadCorrectable(db: D1Database, messageId: string, userId: string) {
  const msg = await loadMessageForMember(db, messageId, userId);
  const rel = await db
    .prepare('SELECT id, requester_id, recipient_id, requester_role, status FROM tutor_relationships WHERE id = ?')
    .bind(msg.relationship_id)
    .first<TutorRelationship>();
  if (!rel || getMyRole(rel, userId) !== 'tutor') throw new ChatMessageError('Only the tutor can correct messages', 403);
  if (msg.sender_id === userId) throw new ChatMessageError('You can only correct the other person’s messages', 403);
  if (msg.deleted_at) throw new ChatMessageError('This message was deleted', 409);
  if (msg.attachment) throw new ChatMessageError('Only text messages can be corrected', 400);
  return msg;
}

export function validateCorrection(body: unknown): { text: string; note: string | null } {
  const o = (body && typeof body === 'object' ? body : {}) as { text?: unknown; note?: unknown };
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) throw new ChatMessageError('text is required', 400);
  if (text.length > CORRECTION_TEXT_MAX) throw new ChatMessageError(`A correction can be at most ${CORRECTION_TEXT_MAX} characters`, 400);
  if (o.note !== undefined && o.note !== null && typeof o.note !== 'string') throw new ChatMessageError('note must be text', 400);
  const note = typeof o.note === 'string' ? o.note.trim() : '';
  if (note.length > CORRECTION_NOTE_MAX) throw new ChatMessageError(`A note can be at most ${CORRECTION_NOTE_MAX} characters`, 400);
  return { text, note: note || null };
}

/** PUT: set or replace the correction. `changed` false when it was already exactly this. */
export async function setCorrection(db: D1Database, messageId: string, userId: string, body: unknown): Promise<CorrectionChange> {
  const { text, note } = validateCorrection(body);
  const msg = await loadCorrectable(db, messageId, userId);
  const row = await db.prepare('SELECT correction, updated_at FROM messages WHERE id = ?').bind(messageId).first<{ correction: string | null; updated_at: string | null }>();
  const existing = parseCorrection(row?.correction);
  if (existing && existing.text === text && existing.note === note) {
    return { message: (await getMessageById(db, messageId, userId))!, changed: false, studentId: msg.sender_id, relationshipId: msg.relationship_id, correction: existing };
  }
  const at = laterThan(row?.updated_at);
  const correction: ChatCorrection = { text, note, by: userId, at };
  await db.prepare('UPDATE messages SET correction = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(correction), at, messageId).run();
  return { message: (await getMessageById(db, messageId, userId))!, changed: true, studentId: msg.sender_id, relationshipId: msg.relationship_id, correction };
}

/** DELETE: remove the correction (idempotent). */
export async function clearCorrection(db: D1Database, messageId: string, userId: string): Promise<CorrectionChange> {
  const msg = await loadCorrectable(db, messageId, userId);
  const row = await db.prepare('SELECT correction, updated_at FROM messages WHERE id = ?').bind(messageId).first<{ correction: string | null; updated_at: string | null }>();
  const changed = !!row?.correction;
  if (changed) {
    await db.prepare('UPDATE messages SET correction = NULL, updated_at = ? WHERE id = ?').bind(laterThan(row?.updated_at), messageId).run();
  }
  return { message: (await getMessageById(db, messageId, userId))!, changed, studentId: msg.sender_id, relationshipId: msg.relationship_id, correction: null };
}
