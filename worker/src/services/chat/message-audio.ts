/**
 * The read-aloud clip of a chat message (docs/CHAT.md "Listening mode"): made
 * once in the background when a Chinese message is sent or edited, stored in
 * R2 (`chat-tts/<conv>/<msg>-<hash>.mp3`, the hash covering text + voice +
 * speed) and remembered in `messages.audio_key`, so listening mode's tap and
 * Read aloud play at once — and the devices can prefetch it for offline.
 *
 * `messageVoice` is the one place that decides the voice; everything else
 * only stores and serves.
 */

import type { Env } from '../../types';
import { DEFAULT_MINIMAX_VOICE, DEFAULT_TTS_SPEED, generateConversationTTS } from '../audio';
import { hasHan } from '@shared/chats/listening';

export interface MessageClipInput {
  id: string;
  conversation_id: string;
  content: string;
  deleted_at?: string | null;
  attachment?: { kind: string } | null;
}

export interface MessageVoice {
  voiceId: string;
  speed: number;
}

export type MessageTts = (env: Env, text: string, voice: MessageVoice) => Promise<{ bytes: Uint8Array; contentType: string } | null>;

const defaultTts: MessageTts = async (env, text, voice) => {
  const result = await generateConversationTTS(env, text, { voiceId: voice.voiceId, speed: voice.speed });
  if (!result) return null;
  const bin = atob(result.audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: result.contentType };
};

/** The voice a message is read in: the conversation's own voice (Claude role-play chats), else the default. */
export async function messageVoice(env: Pick<Env, 'DB'>, conversationId: string): Promise<MessageVoice> {
  const conv = await env.DB
    .prepare('SELECT voice_id, voice_speed FROM conversations WHERE id = ?')
    .bind(conversationId)
    .first<{ voice_id: string | null; voice_speed: number | null }>();
  return { voiceId: conv?.voice_id || DEFAULT_MINIMAX_VOICE, speed: conv?.voice_speed ?? DEFAULT_TTS_SPEED };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** R2 key of a message's clip for this text and voice. */
export async function messageClipKey(msg: Pick<MessageClipInput, 'id' | 'conversation_id' | 'content'>, voice: MessageVoice): Promise<string> {
  const hash = (await sha256Hex(`${msg.content}\n${voice.voiceId}\n${voice.speed}`)).slice(0, 16);
  return `chat-tts/${msg.conversation_id}/${msg.id}-${hash}.mp3`;
}

/** A message worth a clip: not deleted, a plain text message with Chinese. */
export function wantsClip(msg: MessageClipInput): boolean {
  return !msg.deleted_at && !msg.attachment && hasHan(msg.content) && msg.content.length <= 2000;
}

/**
 * The clip's key, made if missing (stored in R2 + `messages.audio_key`, only
 * while the text is still the one it was made from). null when TTS failed.
 */
export async function ensureMessageClip(env: Env, msg: MessageClipInput, tts: MessageTts = defaultTts): Promise<string | null> {
  const voice = await messageVoice(env, msg.conversation_id);
  const key = await messageClipKey(msg, voice);
  const existing = await env.AUDIO_BUCKET.head(key);
  if (!existing) {
    const clip = await tts(env, msg.content, voice);
    if (!clip) return null;
    await env.AUDIO_BUCKET.put(key, clip.bytes, { httpMetadata: { contentType: clip.contentType } });
  }
  await env.DB
    .prepare('UPDATE messages SET audio_key = ? WHERE id = ? AND content = ? AND (audio_key IS NULL OR audio_key != ?)')
    .bind(key, msg.id, msg.content, key)
    .run();
  return key;
}

/** Background pre-generation after a send / edit. Never throws. */
export async function pregenerateMessageClip(env: Env, msg: MessageClipInput, tts?: MessageTts): Promise<void> {
  if (!wantsClip(msg)) return;
  try {
    // Claude role-play chats speak their replies already.
    const conv = await env.DB.prepare('SELECT is_ai_conversation FROM conversations WHERE id = ?').bind(msg.conversation_id).first<{ is_ai_conversation: number | null }>();
    if (conv?.is_ai_conversation) return;
    await ensureMessageClip(env, msg, tts);
  } catch (err) {
    console.error('[chat] pre-generating the clip failed for', msg.id, err instanceof Error ? err.message : err);
  }
}
