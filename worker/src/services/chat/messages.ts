/**
 * Changing a chat message after it was sent (docs/CHAT.md PR 2): edit, soft
 * delete, pin, reactions, the voice transcript and the background
 * translation. Every change sets `updated_at` (so `GET …/messages?since=`
 * returns the message again) and sends `message_updated` to both people's
 * ChatHubs.
 */

import type { Env, MessageWithSender } from '../../types';
import { CLAUDE_AI_USER_ID } from '../../types';
import { getMessageById, getMessageRecord, type MessageRecord } from '../conversations';
import { transcribeTake, takeProviders, type TakeProviders } from '../take-transcription';
import { broadcastToUser } from './hub';
import { getConversationParticipants } from './reads';
import { CAPTION_MAX, type StoredAttachment } from './media';
import { serializeWords, WORDS_MAX_CHARS } from './words';
import type { ReaderWord } from '@shared/reader/words';

export class ChatMessageError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 502 | 503) {
    super(message);
    this.name = 'ChatMessageError';
  }
}

const HAN = /[㐀-鿿]/;

function nowIso(): string {
  return new Date().toISOString();
}

/** A strictly later timestamp than `prev` (two changes in one millisecond still move the cursor). */
export function laterThan(prev: string | null | undefined): string {
  const now = nowIso();
  if (!prev || now > prev) return now;
  return new Date(Date.parse(prev) + 1).toISOString();
}

/**
 * The message, the conversation's participants, and whether `userId` is one of
 * them. 404 when the message doesn't exist, 403 when the caller is not in the
 * conversation's (active) relationship.
 */
export async function loadMessageForMember(db: D1Database, messageId: string, userId: string): Promise<MessageRecord & { relationship_id: string; user_ids: [string, string] }> {
  const record = await getMessageRecord(db, messageId);
  if (!record) throw new ChatMessageError('Message not found', 404);
  const participants = await getConversationParticipants(db, record.conversation_id);
  if (!participants) throw new ChatMessageError('Message not found', 404);
  if (!participants.user_ids.includes(userId) || participants.status !== 'active') {
    throw new ChatMessageError('Access denied', 403);
  }
  return { ...record, relationship_id: participants.relationship_id, user_ids: participants.user_ids };
}

/** Bump `updated_at` (after any change). */
export async function touchMessage(db: D1Database, messageId: string): Promise<void> {
  const row = await db.prepare('SELECT updated_at FROM messages WHERE id = ?').bind(messageId).first<{ updated_at: string | null }>();
  await db.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').bind(laterThan(row?.updated_at), messageId).run();
}

/**
 * `message_updated` to both participants, each with the message as they see it
 * (`has_discussion` is per viewer). Never throws.
 */
export async function broadcastMessageUpdated(env: Pick<Env, 'DB' | 'CHAT_HUB'>, messageId: string): Promise<void> {
  try {
    const record = await getMessageRecord(env.DB, messageId);
    if (!record) return;
    const participants = await getConversationParticipants(env.DB, record.conversation_id);
    if (!participants) return;
    const viewers = [...new Set(participants.user_ids)].filter((id) => id && id !== CLAUDE_AI_USER_ID);
    await Promise.all(
      viewers.map(async (viewer) => {
        const message = await getMessageById(env.DB, messageId, viewer);
        if (!message) return;
        await broadcastToUser(env, viewer, { type: 'message_updated', message, relationship_id: participants.relationship_id });
      }),
    );
  } catch (err) {
    console.error('[chat] message_updated broadcast failed for', messageId, err);
  }
}

// ---------- Edit / delete / pin ----------

/** Sender only, not deleted; text messages and photo captions (a voice message has no editable text). */
export async function editMessage(db: D1Database, messageId: string, userId: string, content: unknown): Promise<MessageWithSender> {
  const msg = await loadMessageForMember(db, messageId, userId);
  if (msg.sender_id !== userId) throw new ChatMessageError('You can only edit your own messages', 403);
  if (msg.deleted_at) throw new ChatMessageError('This message was deleted', 409);
  if (typeof content !== 'string') throw new ChatMessageError('content is required', 400);
  const kind = msg.attachment?.kind ?? null;
  if (kind === 'voice') throw new ChatMessageError('A voice message cannot be edited', 400);
  if (!kind && content.trim() === '') throw new ChatMessageError('Message content is required', 400);
  if (kind && content.length > CAPTION_MAX) throw new ChatMessageError(`A caption can be at most ${CAPTION_MAX} characters`, 400);
  const at = laterThan(await currentUpdatedAt(db, messageId));
  await db
    .prepare('UPDATE messages SET content = ?, edited_at = ?, updated_at = ?, translation = NULL, segmentation = NULL, words = NULL, audio_key = NULL WHERE id = ?')
    .bind(content, at, at, messageId)
    .run();
  return (await getMessageById(db, messageId, userId))!;
}

/** Sender only; soft delete (content '', attachment NULL, unpinned). Returns the R2 key to remove. Idempotent. */
export async function deleteMessage(db: D1Database, messageId: string, userId: string): Promise<{ message: MessageWithSender; mediaKey: string | null; changed: boolean }> {
  const msg = await loadMessageForMember(db, messageId, userId);
  if (msg.sender_id !== userId) throw new ChatMessageError('You can only delete your own messages', 403);
  if (msg.deleted_at) return { message: (await getMessageById(db, messageId, userId))!, mediaKey: null, changed: false };
  const at = laterThan(await currentUpdatedAt(db, messageId));
  await db
    .prepare(
      `UPDATE messages SET content = '', attachment = NULL, translation = NULL, segmentation = NULL,
              words = NULL, correction = NULL, pinned_at = NULL, pinned_by = NULL, deleted_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(at, at, messageId)
    .run();
  return { message: (await getMessageById(db, messageId, userId))!, mediaKey: msg.attachment?.key ?? null, changed: true };
}

/** Either participant; a deleted message can only be unpinned. */
export async function pinMessage(db: D1Database, messageId: string, userId: string, pinned: unknown): Promise<{ message: MessageWithSender; changed: boolean }> {
  if (typeof pinned !== 'boolean') throw new ChatMessageError('pinned must be true or false', 400);
  const msg = await loadMessageForMember(db, messageId, userId);
  if (pinned && msg.deleted_at) throw new ChatMessageError('This message was deleted', 409);
  const row = await db.prepare('SELECT pinned_at, updated_at FROM messages WHERE id = ?').bind(messageId).first<{ pinned_at: string | null; updated_at: string | null }>();
  const isPinned = !!row?.pinned_at;
  if (isPinned === pinned) return { message: (await getMessageById(db, messageId, userId))!, changed: false };
  const at = laterThan(row?.updated_at);
  await db
    .prepare('UPDATE messages SET pinned_at = ?, pinned_by = ?, updated_at = ? WHERE id = ?')
    .bind(pinned ? at : null, pinned ? userId : null, at, messageId)
    .run();
  return { message: (await getMessageById(db, messageId, userId))!, changed: true };
}

export async function currentUpdatedAt(db: D1Database, messageId: string): Promise<string | null> {
  const row = await db.prepare('SELECT updated_at FROM messages WHERE id = ?').bind(messageId).first<{ updated_at: string | null }>();
  return row?.updated_at ?? null;
}

// ---------- Background work ----------

export type Translate = (text: string) => Promise<{ translation: string; segmentation: unknown }>;

function defaultTranslate(env: Pick<Env, 'ANTHROPIC_API_KEY'>): Translate | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return async (text) => {
    const { translateAndSegment } = await import('../translation');
    return translateAndSegment(env.ANTHROPIC_API_KEY, text);
  };
}

export type Segment = (text: string) => Promise<ReaderWord[]>;

/** The reader-words splitter (Haiku via structuredCall), or null without an API key. */
export function defaultSegment(env: Pick<Env, 'ANTHROPIC_API_KEY'>): Segment | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return async (text) => {
    const { segmentReaderText } = await import('../reader-words');
    return segmentReaderText(env.ANTHROPIC_API_KEY, text);
  };
}

export interface EnrichDeps {
  translate?: Translate | null;
  segment?: Segment | null;
}

/**
 * The one background step after a text message (or a photo caption) is sent
 * or edited and it has Chinese: the translation and the word chips are made
 * side by side, then written together — only while the text is still the one
 * they were made from (a later edit wins) — with `updated_at` bumped and ONE
 * `message_updated`. Either half failing leaves the other. Never throws.
 */
export async function enrichMessageInBackground(
  env: Pick<Env, 'DB' | 'CHAT_HUB' | 'ANTHROPIC_API_KEY'>,
  messageId: string,
  content: string,
  deps: EnrichDeps = {},
): Promise<void> {
  if (!HAN.test(content)) return;
  const translate = deps.translate === undefined ? defaultTranslate(env) : deps.translate;
  const segment = deps.segment === undefined ? defaultSegment(env) : deps.segment;
  if (!translate && !segment) return;
  const [translated, segmented] = await Promise.allSettled([
    translate ? translate(content) : Promise.resolve(null),
    segment && content.length <= WORDS_MAX_CHARS ? segment(content) : Promise.resolve(null),
  ]);
  if (translated.status === 'rejected') console.error('[Translation] Auto-translate failed for message', messageId, translated.reason);
  if (segmented.status === 'rejected') {
    console.error('[chat] splitting message into words failed for', messageId, segmented.reason instanceof Error ? segmented.reason.message : segmented.reason);
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (translated.status === 'fulfilled' && translated.value) {
    sets.push('translation = ?', 'segmentation = ?');
    values.push(translated.value.translation, JSON.stringify(translated.value.segmentation));
  }
  if (segmented.status === 'fulfilled' && segmented.value) {
    sets.push('words = ?');
    values.push(serializeWords('content', segmented.value));
  }
  if (sets.length === 0) return;
  try {
    const at = laterThan(await currentUpdatedAt(env.DB, messageId));
    const res = await env.DB
      .prepare(`UPDATE messages SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND content = ? AND deleted_at IS NULL`)
      .bind(...values, at, messageId, content)
      .run();
    if ((res.meta?.changes ?? 0) > 0) await broadcastMessageUpdated(env, messageId);
  } catch (err) {
    console.error('[chat] saving translation / words failed for', messageId, err);
  }
}

/** Kept for callers that only want the translation (no word chips). */
export async function translateMessageInBackground(
  env: Pick<Env, 'DB' | 'CHAT_HUB' | 'ANTHROPIC_API_KEY'>,
  messageId: string,
  content: string,
  deps: { translate?: Translate | null } = {},
): Promise<void> {
  await enrichMessageInBackground(env, messageId, content, { translate: deps.translate, segment: null });
}

export interface VoiceTranscriptionDeps {
  providers?: TakeProviders;
  translate?: Translate | null;
  segment?: Segment | null;
}

/**
 * A voice message → transcript (transcribeTake: Whisper → Soniox → Gemini) →
 * translation when it has Chinese → `transcript_status` done / failed,
 * `updated_at`, `message_updated` to both. Never throws (runs in waitUntil).
 */
export async function transcribeVoiceMessage(
  env: Env,
  messageId: string,
  bytes: Uint8Array,
  mime: string,
  deps: VoiceTranscriptionDeps = {},
): Promise<'done' | 'failed' | 'skipped'> {
  let status: 'done' | 'failed' = 'failed';
  let transcript: string | null = null;
  let translation: string | null = null;
  let words: ReaderWord[] | null = null;
  try {
    const out = await transcribeTake(deps.providers ?? takeProviders(env), bytes, mime);
    transcript = (out.text || '').trim();
    status = transcript ? 'done' : 'failed';
    if (transcript && HAN.test(transcript)) {
      const text = transcript;
      const translate = deps.translate === undefined ? defaultTranslate(env) : deps.translate;
      const segment = deps.segment === undefined ? defaultSegment(env) : deps.segment;
      // The translation and the transcript's word chips side by side.
      await Promise.all([
        translate
          ? translate(text).then(
              (r) => { translation = r.translation || null; },
              (err) => console.error('[chat] voice message translation failed for', messageId, err),
            )
          : null,
        segment && text.length <= WORDS_MAX_CHARS
          ? segment(text).then(
              (w) => { words = w; },
              (err) => console.error('[chat] splitting the voice transcript into words failed for', messageId, err instanceof Error ? err.message : err),
            )
          : null,
      ]);
    }
  } catch (err) {
    console.error('[chat] voice message transcription failed for', messageId, err instanceof Error ? err.message : err);
    status = 'failed';
  }

  try {
    const record = await getMessageRecord(env.DB, messageId);
    // Deleted meanwhile (attachment gone): nothing to write.
    if (!record || record.deleted_at || record.attachment?.kind !== 'voice') return 'skipped';
    const attachment: StoredAttachment = {
      ...record.attachment,
      transcript_status: status,
      transcript: status === 'done' ? transcript : null,
      translation: status === 'done' ? translation : null,
    };
    const at = laterThan(await currentUpdatedAt(env.DB, messageId));
    const wordsJson = status === 'done' && words ? serializeWords('transcript', words) : null;
    await env.DB
      .prepare('UPDATE messages SET attachment = ?, words = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(JSON.stringify(attachment), wordsJson, at, messageId)
      .run();
    await broadcastMessageUpdated(env, messageId);
    return status;
  } catch (err) {
    console.error('[chat] saving the voice transcript failed for', messageId, err);
    return 'failed';
  }
}
