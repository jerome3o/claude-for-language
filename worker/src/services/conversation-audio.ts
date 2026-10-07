/**
 * Conversation audio preferences per account (docs/AUDIO.md "Conversation
 * audio"): `users.conversation_audio`, JSON per shared/lesson/conversationAudio.ts.
 * Read on /api/auth/me (cached on the device for offline playback), edited
 * from the ⚙︎ Audio menu on a conversation exercise and Settings → Conversation
 * voices through `GET|PUT /api/conversation-audio`.
 */
import {
  mergeConversationAudioPrefs,
  parseConversationAudioPrefs,
  type ConversationAudioPrefs,
} from '@shared/lesson';
import { TTS_PROVIDER_NAMES, type TtsProviderId } from '@shared/tts';
import type { Env } from '../types';
import { activeConversationProvider, loadTtsConfig, storedClipPolicy } from './tts/config';

export async function getConversationAudioPrefs(db: D1Database, userId: string): Promise<ConversationAudioPrefs> {
  const row = await db
    .prepare('SELECT conversation_audio FROM users WHERE id = ?')
    .bind(userId)
    .first<{ conversation_audio: string | null }>();
  return parseConversationAudioPrefs(row?.conversation_audio);
}

/** Merge a partial update (validated) and store it. */
export async function updateConversationAudioPrefs(
  db: D1Database,
  userId: string,
  update: unknown,
): Promise<{ prefs: ConversationAudioPrefs; problems: string[] }> {
  const current = await getConversationAudioPrefs(db, userId);
  const { prefs, problems } = mergeConversationAudioPrefs(current, update);
  if (problems.length) return { prefs: current, problems };
  await db.prepare('UPDATE users SET conversation_audio = ? WHERE id = ?').bind(JSON.stringify(prefs), userId).run();
  return { prefs, problems };
}

export interface ConversationAudioSource {
  provider: TtsProviderId;
  provider_name: string;
  /** The provider's default conversation rate (admin `conversation_rate`). */
  default_speed: number;
}

/** Which provider speaks conversation clips now, and its default speed. */
export async function conversationAudioSource(env: Env): Promise<ConversationAudioSource> {
  const [config, policy] = await Promise.all([loadTtsConfig(env), storedClipPolicy(env)]);
  const provider = activeConversationProvider(policy);
  return { provider, provider_name: TTS_PROVIDER_NAMES[provider], default_speed: config.providers[provider].conversation_rate };
}
