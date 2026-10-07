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
 *   GET /conversation-audio           → this account's conversation-audio preferences + what the
 *                                        active provider offers (voices, speeds, deliveries)
 *   PUT /conversation-audio           → a partial update (shared/lesson/conversationAudio.ts;
 *                                        400 with `problems`) → the same view
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
import {
  CONVERSATION_DELIVERIES,
  DELIVERY_LABELS,
  PROVIDER_RATE_RANGE,
  conversationProviderVoices,
  conversationSpeedSteps,
  supportedDeliveries,
} from '@shared/tts';
import type { Env } from '../types';
import { getConversationVoiceSettings, getVoiceSample, setConversationVoices } from '../services/conversation-voices';
import { conversationAudioSource, getConversationAudioPrefs, updateConversationAudioPrefs } from '../services/conversation-audio';

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

async function audioView(env: Env, userId: string) {
  const [prefs, source, voices] = await Promise.all([
    getConversationAudioPrefs(env.DB, userId),
    conversationAudioSource(env),
    getConversationVoiceSettings(env.DB, userId).catch(() => null),
  ]);
  const p = source.provider;
  return {
    prefs,
    ...source,
    enabled: voices?.enabled ?? null,
    speed_steps: conversationSpeedSteps(p),
    speed_range: { min: PROVIDER_RATE_RANGE[p].good_min, max: PROVIDER_RATE_RANGE[p].good_max },
    voices: conversationProviderVoices(p)
      // MiniMax: the account's enabled voices (the full catalogue is on the Voices page).
      .filter((v) => p !== 'minimax' || !voices || voices.enabled.includes(v.id))
      .map((v) => ({ ...v, deliveries: supportedDeliveries(p, v.id) })),
    deliveries: CONVERSATION_DELIVERIES.map((id) => ({ id, label: DELIVERY_LABELS[id] })),
  };
}

conversationVoices.get('/conversation-audio', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(await audioView(c.env, user.id));
});

conversationVoices.put('/conversation-audio', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'JSON body required', problems: ['JSON body required'] }, 400);
  const { problems } = await updateConversationAudioPrefs(c.env.DB, user.id, body);
  if (problems.length) return c.json({ error: problems.join('; '), problems }, 400);
  return c.json(await audioView(c.env, user.id));
});

export default conversationVoices;
