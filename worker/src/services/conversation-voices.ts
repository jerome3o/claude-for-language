/**
 * Which voices an account's conversation exercises are spoken in.
 *
 * Per account (users.conversation_voices, a JSON array of catalogue ids). An
 * account that hasn't customised plays the admin's own selection — the admin
 * curates for everyone (tutor accounts included) — else the shipped defaults
 * (`default_on` in shared/lesson/voices.ts). The client resolves voices from
 * this list on the device, so it travels on /api/auth/me and is cached there
 * for offline study.
 */
import {
  CONVERSATION_TTS_SPEED,
  DEFAULT_CONVERSATION_VOICE_IDS,
  LESSON_VOICE_IDS,
  VOICE_SAMPLE_TEXT,
  validateConversationVoiceSelection,
} from '@shared/lesson';
import type { Env } from '../types';
import { bytesToBase64, generateMiniMaxTTS } from './audio';

export interface ConversationVoiceSettings {
  /** The voices this account's conversations use. */
  enabled: string[];
  /** True when the account has its own selection. */
  customised: boolean;
  /** What "Reset" goes back to: the admin's selection, or the shipped one. */
  default_enabled: string[];
  default_source: 'admin' | 'app';
}

/** A stored selection, cleaned (unknown ids dropped); null when unusable. */
export function parseStoredVoices(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const { enabled, problems } = validateConversationVoiceSelection(JSON.parse(raw));
    // Unknown ids (a voice retired from the catalogue) are just dropped; a
    // selection left without both genders falls back rather than failing.
    const missingGender = problems.some(p => p.startsWith('Keep at least'));
    return enabled.length >= 2 && !missingGender ? enabled : null;
  } catch {
    return null;
  }
}

async function adminDefault(db: D1Database): Promise<string[] | null> {
  const row = await db
    .prepare(
      `SELECT conversation_voices FROM users
        WHERE is_admin = 1 AND conversation_voices IS NOT NULL
        ORDER BY conversation_voices_updated_at DESC LIMIT 1`,
    )
    .first<{ conversation_voices: string | null }>();
  return parseStoredVoices(row?.conversation_voices);
}

/** An admin's own default is the shipped selection (theirs IS everyone's default). */
export async function getConversationVoiceSettings(db: D1Database, userId: string): Promise<ConversationVoiceSettings> {
  const own = await db
    .prepare('SELECT conversation_voices, is_admin FROM users WHERE id = ?')
    .bind(userId)
    .first<{ conversation_voices: string | null; is_admin: number | null }>();
  const mine = parseStoredVoices(own?.conversation_voices);
  const admin = own?.is_admin ? null : await adminDefault(db);
  const defaults = admin ?? [...DEFAULT_CONVERSATION_VOICE_IDS];
  return {
    enabled: mine ?? defaults,
    customised: mine !== null,
    default_enabled: defaults,
    default_source: admin ? 'admin' : 'app',
  };
}

/** Save a validated selection, or null to go back to the default. */
export async function setConversationVoices(db: D1Database, userId: string, enabled: string[] | null): Promise<void> {
  await db
    .prepare('UPDATE users SET conversation_voices = ?, conversation_voices_updated_at = ? WHERE id = ?')
    .bind(enabled ? JSON.stringify(enabled) : null, new Date().toISOString(), userId)
    .run();
}

/** Bump when VOICE_SAMPLE_TEXT or the sample speed changes, so samples regenerate. */
export const VOICE_SAMPLE_VERSION = 1;

export function voiceSampleKey(voiceId: string): string {
  const slug = voiceId.replace(/[^A-Za-z0-9_-]+/g, '_');
  return `voice-samples/v${VOICE_SAMPLE_VERSION}/${slug}.mp3`;
}

export type VoiceSampleResult =
  | { ok: true; audioBase64: string; contentType: string; cached: boolean }
  | { ok: false; status: 400 | 502; error: string };

/**
 * The sample line in one voice: made once with MiniMax (never a fallback
 * voice) at the conversation speed, kept in R2 and reused for every account.
 */
export async function getVoiceSample(env: Env, voiceId: string): Promise<VoiceSampleResult> {
  if (!LESSON_VOICE_IDS.has(voiceId)) return { ok: false, status: 400, error: 'Unknown voice' };
  const key = voiceSampleKey(voiceId);
  const stored = await env.AUDIO_BUCKET.get(key);
  if (stored) {
    const bytes = new Uint8Array(await stored.arrayBuffer());
    return { ok: true, audioBase64: bytesToBase64(bytes), contentType: 'audio/mpeg', cached: true };
  }
  const bytes = await generateMiniMaxTTS(env, VOICE_SAMPLE_TEXT, CONVERSATION_TTS_SPEED, voiceId);
  if (!bytes) return { ok: false, status: 502, error: 'This voice could not be generated right now' };
  await env.AUDIO_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
  return { ok: true, audioBase64: bytesToBase64(bytes), contentType: 'audio/mpeg', cached: false };
}
