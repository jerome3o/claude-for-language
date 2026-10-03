/**
 * Pre-generated read-aloud clips for chat messages (docs/CHAT.md "Listening
 * mode"). There is ONE chat TTS path (shared/chats/voice.ts + services/tts-cache.ts):
 * a message is read in a voice from the LISTENER's conversation voices that
 * matches the SENDER's voice_gender, and the clip is kept in R2 by
 * (text, voice, speed). This module only warms that cache ahead of time — when
 * a Chinese message is sent, forwarded or edited, for the person who will hear
 * it — so listening mode's tap and Read aloud are instant, and lists the clips
 * a device should prefetch.
 */

import type { Env } from '../../types';
import { CLAUDE_AI_USER_ID } from '../../types';
import { chatReadAloudSpeed, chatReadAloudVoice, parseVoiceGender } from '@shared/chats/voice';
import { hasHan, LISTENING_PREFETCH_COUNT } from '@shared/chats/listening';
import { cachedConversationTTS } from '../tts-cache';
import { getConversationVoiceSettings } from '../conversation-voices';
import { getConversationParticipants, otherParticipant } from './reads';

export interface MessageClipInput {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  deleted_at?: string | null;
  attachment?: { kind: string } | null;
}

export interface ReadAloud {
  voiceId: string;
  speed: number;
}

export type ClipMaker = (env: Env, text: string, voice: ReadAloud) => Promise<unknown>;

const defaultMaker: ClipMaker = (env, text, voice) => cachedConversationTTS(env, text, { voiceId: voice.voiceId, speed: voice.speed });

/** A message worth a clip: not deleted, a plain text message with Chinese. */
export function wantsClip(msg: Pick<MessageClipInput, 'content' | 'deleted_at' | 'attachment'>): boolean {
  return !msg.deleted_at && !msg.attachment && hasHan(msg.content) && msg.content.length <= 2000;
}

async function listenerVoices(env: Pick<Env, 'DB'>, listenerId: string): Promise<readonly string[] | null> {
  return (await getConversationVoiceSettings(env.DB, listenerId).catch(() => null))?.enabled ?? null;
}

/** What `listenerId` hears for a message from `senderGender` in a chat with a person (same rule as Read aloud). */
export function readAloudFor(senderGender: string | null | undefined, enabled: readonly string[] | null): ReadAloud {
  return {
    voiceId: chatReadAloudVoice({ senderGender: parseVoiceGender(senderGender), enabled }),
    speed: chatReadAloudSpeed({}),
  };
}

/**
 * Background pre-generation after a send / forward / edit: the clip the other
 * person will hear, in the shared TTS cache. Claude role-play chats are skipped
 * (their replies are spoken already). Never throws.
 */
export async function pregenerateMessageClip(env: Env, msg: MessageClipInput, make: ClipMaker = defaultMaker): Promise<void> {
  if (!wantsClip(msg)) return;
  try {
    const participants = await getConversationParticipants(env.DB, msg.conversation_id);
    if (!participants || participants.is_ai) return;
    const listener = otherParticipant(participants, msg.sender_id);
    if (!listener || listener === msg.sender_id || listener === CLAUDE_AI_USER_ID) return;
    const sender = await env.DB.prepare('SELECT voice_gender FROM users WHERE id = ?').bind(msg.sender_id).first<{ voice_gender: string | null }>();
    await make(env, msg.content, readAloudFor(sender?.voice_gender, await listenerVoices(env, listener)));
  } catch (err) {
    console.error('[chat] pre-generating the clip failed for', msg.id, err instanceof Error ? err.message : err);
  }
}

export interface ChatClip {
  message_id: string;
  conversation_id: string;
  text: string;
  voice_id: string;
  speed: number;
}

/**
 * The newest Chinese text messages from the other person in each of my chats
 * with people, with the voice I hear them in — what a device prefetches
 * (POST /api/practice/tts, cached by text + voice + speed) so a tap plays offline.
 */
export async function chatClipsFor(env: Pick<Env, 'DB'>, userId: string, perConversation = LISTENING_PREFETCH_COUNT): Promise<ChatClip[]> {
  const rows = await env.DB
    .prepare(
      `SELECT message_id, conversation_id, content, voice_gender FROM (
         SELECT m.id AS message_id, m.conversation_id, m.content, u.voice_gender,
                ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC) AS rn
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           JOIN conversations cv ON cv.id = m.conversation_id AND COALESCE(cv.is_ai_conversation, 0) = 0
           JOIN tutor_relationships r ON r.id = cv.relationship_id AND r.status = 'active' AND (r.requester_id = ?1 OR r.recipient_id = ?1)
          WHERE m.sender_id != ?1 AND m.sender_id != ?3 AND m.deleted_at IS NULL AND m.attachment IS NULL
       ) WHERE rn <= ?2`,
    )
    .bind(userId, perConversation * 3, CLAUDE_AI_USER_ID)
    .all<{ message_id: string; conversation_id: string; content: string; voice_gender: string | null }>();
  const enabled = await listenerVoices(env, userId);
  const count = new Map<string, number>();
  const out: ChatClip[] = [];
  for (const r of rows.results ?? []) {
    if (!wantsClip({ content: r.content })) continue;
    const n = count.get(r.conversation_id) ?? 0;
    if (n >= perConversation) continue;
    count.set(r.conversation_id, n + 1);
    const v = readAloudFor(r.voice_gender, enabled);
    out.push({ message_id: r.message_id, conversation_id: r.conversation_id, text: r.content, voice_id: v.voiceId, speed: v.speed });
  }
  return out;
}
