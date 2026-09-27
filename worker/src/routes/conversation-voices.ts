/**
 * Conversation voices (mounted under /api in index.ts; Settings → Conversation voices).
 *
 *   GET /conversation-voices          → the catalogue + this account's selection
 *   PUT /conversation-voices          → { enabled: string[] } (known ids, ≥ 1 female
 *                                        and ≥ 1 male; 400 with `problems`) or { reset: true }
 *   GET /conversation-voices/sample?voice=<id>
 *                                     → { audio_base64, content_type } — the sample line in
 *                                        that voice, generated once and kept in R2
 *
 * An account that hasn't customised plays the admin's selection (else the shipped
 * defaults) — see services/conversation-voices.ts.
 */
import { Hono } from 'hono';
import {
  CONVERSATION_TTS_SPEED,
  CONVERSATION_VOICES,
  VOICE_SAMPLE_TEXT,
  validateConversationVoiceSelection,
} from '@shared/lesson';
import type { Env } from '../types';
import { getConversationVoiceSettings, getVoiceSample, setConversationVoices } from '../services/conversation-voices';

const conversationVoices = new Hono<{ Bindings: Env }>();

async function view(db: D1Database, user: { id: string; is_admin?: number | boolean }) {
  const settings = await getConversationVoiceSettings(db, user.id);
  return {
    voices: CONVERSATION_VOICES,
    ...settings,
    is_admin: !!user.is_admin,
    speed: CONVERSATION_TTS_SPEED,
    sample_text: VOICE_SAMPLE_TEXT,
  };
}

conversationVoices.get('/conversation-voices', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(await view(c.env.DB, user));
});

conversationVoices.put('/conversation-voices', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ enabled?: unknown; reset?: unknown }>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'JSON body required', problems: ['JSON body required'] }, 400);
  if (body.reset === true) {
    await setConversationVoices(c.env.DB, user.id, null);
    return c.json(await view(c.env.DB, user));
  }
  const { enabled, problems } = validateConversationVoiceSelection(body.enabled);
  if (problems.length) return c.json({ error: problems.join('; '), problems }, 400);
  await setConversationVoices(c.env.DB, user.id, enabled);
  return c.json(await view(c.env.DB, user));
});

conversationVoices.get('/conversation-voices/sample', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const result = await getVoiceSample(c.env, c.req.query('voice') ?? '');
  if (!result.ok) return c.json({ error: result.error }, result.status);
  c.header('Cache-Control', 'private, max-age=86400');
  return c.json({ audio_base64: result.audioBase64, content_type: result.contentType, cached: result.cached });
});

export default conversationVoices;
