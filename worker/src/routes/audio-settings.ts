/**
 * Admin: which TTS provider speaks, in what order, in which voices
 * (docs/AUDIO.md "Providers"). Behind adminMiddleware; the admin page
 * (/admin/audio) and the MCP tools `audio_settings_get` / `audio_settings_update`
 * call these.
 *
 * - GET  /api/admin/audio/settings → { settings, defaults, catalogue, providers[], effective }
 * - PUT  /api/admin/audio/settings   { …partial settings } → the same (400 + problems)
 * - POST /api/admin/audio/sample     { provider, voice?, text?, speed? } → { audio_base64, content_type, … }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import {
  DEFAULT_TTS_CONFIG,
  TTS_PROVIDERS,
  TTS_PROVIDER_NAMES,
  TTS_VOICE_CATALOGUE,
  isFixedRateVoice,
  mergeTtsConfig,
  providerRate,
  usableOrder,
  type TtsConfig,
  type TtsProviderId,
} from '@shared/tts';
import { buildStoredClipPolicy, loadTtsConfig, saveTtsConfig, ttsSettingsUpdatedAt, clearTtsConfigCache } from '../services/tts/config';
import { configuredProviders, listAzureVoices } from '../services/tts/providers';
import { limiterStub } from '../services/tts/limiter';
import { bytesToBase64, callProviderTTS } from '../services/audio';
import { houseSpeed } from '../services/tts/settings';
import type { LimiterSnapshot } from '../durable/tts-limiter';
import type { AccountProblem } from '../services/tts/account';

const routes = new Hono<{ Bindings: Env }>();
routes.use('/admin/audio/*', adminMiddleware);

export const SAMPLE_TEXT = '你好！我们今天学习新的生词。';

function iso(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function accountView(p: AccountProblem | null | undefined, now: number) {
  if (!p) return null;
  return {
    code: p.code,
    message: p.message,
    since: iso(p.since),
    errors_in_a_row: p.streak,
    paused_until: p.pausedUntil > now ? iso(p.pausedUntil) : null,
    probing: p.probeAt !== null,
  };
}

export interface ProviderStatus {
  id: TtsProviderId;
  name: string;
  configured: boolean;
  /** What's missing when not configured (secret names only, never values). */
  missing: string[];
  enabled: boolean;
  /** Configured + enabled + not account-paused. */
  available: boolean;
  account_problem: ReturnType<typeof accountView>;
  learned_rpm: number | null;
  rpm_cap: number | null;
  last_rate_limited_at: string | null;
  last_success_at: string | null;
  last_error: { at: string | null; reason: string } | null;
  last_hour: { ok: number; failed: number; rate_limited: number; denied: number } | null;
  region?: string | null;
}

function missingSecrets(env: Env, id: TtsProviderId): string[] {
  if (id === 'minimax') return env.MINIMAX_API_KEY ? [] : ['MINIMAX_API_KEY'];
  if (id === 'google') return env.GOOGLE_TTS_API_KEY ? [] : ['GOOGLE_TTS_API_KEY'];
  return [...(env.AZURE_SPEECH_KEY ? [] : ['AZURE_SPEECH_KEY']), ...(env.AZURE_SPEECH_REGION ? [] : ['AZURE_SPEECH_REGION'])];
}

async function snapshotOf(env: Env, id: TtsProviderId, config: TtsConfig): Promise<LimiterSnapshot | null> {
  const stub = limiterStub(env, id);
  if (!stub) return null;
  try {
    return await stub.snapshot({ provider: id, maxRpm: config.providers[id].max_rpm });
  } catch (err) {
    console.error('[audio-settings] snapshot failed', id, err);
    return null;
  }
}

/** Per-provider state for the admin page and `audio_backfill_status`. */
export async function providerStatuses(env: Env, config: TtsConfig, now = Date.now()): Promise<ProviderStatus[]> {
  const configured = configuredProviders(env);
  return Promise.all(
    TTS_PROVIDERS.map(async (id) => {
      const snap = await snapshotOf(env, id, config);
      const hour = snap?.minutes ?? [];
      const sum = (k: 'ok' | 'failed' | 'rateLimited' | 'denied') => hour.reduce((n, m) => n + m[k], 0);
      const enabled = config.providers[id].enabled;
      return {
        id,
        name: TTS_PROVIDER_NAMES[id],
        configured: configured[id],
        missing: missingSecrets(env, id),
        enabled,
        available: configured[id] && enabled && !snap?.account_problem,
        account_problem: accountView(snap?.account_problem, now),
        learned_rpm: snap?.learned_rpm ?? null,
        rpm_cap: snap?.rpm_cap ?? null,
        last_rate_limited_at: iso(snap?.last_rate_limited_at),
        last_success_at: iso(snap?.last_ok_at),
        last_error: snap?.last_error ? { at: iso(snap.last_error.at), reason: snap.last_error.reason } : null,
        last_hour: snap ? { ok: sum('ok'), failed: sum('failed'), rate_limited: sum('rateLimited'), denied: sum('denied') } : null,
        ...(id === 'azure' ? { region: env.AZURE_SPEECH_REGION ?? null } : {}),
      } satisfies ProviderStatus;
    }),
  );
}

async function settingsView(env: Env) {
  const now = Date.now();
  const config = await loadTtsConfig(env, now);
  const providers = await providerStatuses(env, config, now);
  const configured = configuredProviders(env);
  const problems = Object.fromEntries(providers.map((p) => [p.id, p.account_problem ? ({ code: p.account_problem.code } as unknown as AccountProblem) : null]));
  const policy = buildStoredClipPolicy(config, configured, problems, env);
  const meta = await ttsSettingsUpdatedAt(env.DB);
  const speed = houseSpeed(env);
  return {
    settings: config,
    defaults: DEFAULT_TTS_CONFIG,
    catalogue: TTS_VOICE_CATALOGUE,
    providers,
    effective: {
      // What actually runs now: the order minus disabled / unconfigured providers.
      stored_order: policy.order,
      live_order: usableOrder(config.live_order, config, configured),
      stored_primary: policy.primary,
      primary_unavailable: policy.primaryUnavailable,
      current_providers: policy.acceptable,
      // The rate each provider speaks the card speed (0.6) and conversations (its own conversation_rate) at.
      rates: Object.fromEntries(
        TTS_PROVIDERS.map((id) => [id, { cards: id === 'minimax' ? speed : providerRate(config.providers[id], speed), conversations: config.providers[id].conversation_rate }]),
      ),
    },
    updated_at: meta.updated_at,
    updated_by: meta.updated_by,
  };
}

routes.get('/admin/audio/settings', async (c) => {
  const view = await settingsView(c.env);
  // Optional: the zh-CN voices Azure offers in this region (also proves the key works; read-only).
  if (c.req.query('azure_voices') === '1') {
    return c.json({ ...view, azure_region_voices: await listAzureVoices(c.env) });
  }
  return c.json(view);
});

routes.put('/admin/audio/settings', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', problems: ['settings must be an object'] }, 400);
  }
  // `{ reset: true }` = back to the defaults.
  if (body && typeof body === 'object' && (body as { reset?: unknown }).reset === true) {
    await saveTtsConfig(c.env.DB, DEFAULT_TTS_CONFIG, c.get('user')?.id ?? null);
    return c.json(await settingsView(c.env));
  }
  clearTtsConfigCache();
  const current = await loadTtsConfig(c.env);
  const { config, problems } = mergeTtsConfig(current, body);
  if (problems.length) return c.json({ error: problems[0], problems }, 400);
  await saveTtsConfig(c.env.DB, config, c.get('user')?.id ?? null);
  // A changed max RPM reaches the limiter with the next call; push it now so the status shows it.
  await Promise.all(
    TTS_PROVIDERS.map((id) => limiterStub(c.env, id)?.snapshot({ provider: id, maxRpm: config.providers[id].max_rpm }).catch(() => null)),
  );
  console.log(JSON.stringify({ type: 'tts_settings', event: 'updated', stored_order: config.stored_order, live_order: config.live_order, upgrade: config.upgrade_backup_clips }));
  return c.json(await settingsView(c.env));
});

/**
 * ▶ on the admin page: one voice of one provider saying `text` at the card
 * speed (or `speed`), through that provider's limiter (interactive). Nothing is
 * kept.
 */
routes.post('/admin/audio/sample', async (c) => {
  let body: { provider?: unknown; voice?: unknown; text?: unknown; speed?: unknown; role?: unknown };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const provider = body.provider;
  if (provider !== 'minimax' && provider !== 'azure' && provider !== 'google') return c.json({ error: 'provider must be minimax, azure or google' }, 400);
  const config = await loadTtsConfig(c.env);
  const p = config.providers[provider];
  const role = body.role === 'female' || body.role === 'male' ? body.role : 'default';
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim().slice(0, 120) : p.voices[role];
  const { problems } = mergeTtsConfig(config, { providers: { [provider]: { voices: { default: voice } } } });
  if (problems.length) return c.json({ error: problems[0] }, 400);
  const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim().slice(0, 200) : SAMPLE_TEXT;
  const appSpeed = typeof body.speed === 'number' && body.speed >= 0.5 && body.speed <= 2 ? body.speed : houseSpeed(c.env);
  const rate = provider === 'minimax' ? appSpeed : providerRate(p, appSpeed);
  if (!configuredProviders(c.env)[provider]) {
    return c.json({ error: `${TTS_PROVIDER_NAMES[provider]} is not configured (${missingSecrets(c.env, provider).join(', ')})` }, 503);
  }
  const out = await callProviderTTS(c.env, provider, { text, voice, rate }, { priority: 'interactive', maxRpm: p.max_rpm });
  if (!out.ok) {
    return c.json({ error: out.account ? `${TTS_PROVIDER_NAMES[provider]} account problem: ${out.reason}` : out.reason, rate_limited: out.rateLimited, retry_after_ms: out.retryAfterMs ?? null }, out.rateLimited ? 503 : 502);
  }
  return c.json({
    audio_base64: bytesToBase64(out.bytes),
    content_type: out.mime,
    provider,
    voice,
    rate: isFixedRateVoice(provider, voice) ? null : rate,
    bytes: out.bytes.byteLength,
  });
});

export default routes;
