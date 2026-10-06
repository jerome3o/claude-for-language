/**
 * The admin's audio settings at run time (docs/AUDIO.md "Providers"): read from
 * D1 (`tts_settings`, one row) and cached per isolate for a short while, plus
 * the decisions that follow from them:
 * - `providerVoice`: which voice + rate a provider speaks a request in (a
 *   MiniMax catalogue voice is mapped by its gender through another provider's
 *   voices);
 * - `storedClipPolicy`: which providers' clips count as CURRENT for stored
 *   clips — the first usable provider's always; the backups' too while it is
 *   unavailable (account paused) or when "upgrade backup clips" is off.
 */
import type { Env } from '../../types';
import {
  DEFAULT_TTS_CONFIG,
  cloneTtsConfig,
  isFixedRateVoice,
  parseStoredTtsConfig,
  providerRate,
  usableOrder,
  clampConversationRate,
  conversationVoiceGender,
  conversationVoiceProvider,
  deliveryParams,
  type ConversationDelivery,
  type TtsConfig,
  type TtsProviderId,
  type TtsVoiceRole,
} from '@shared/tts';
import { conversationVoice } from '@shared/lesson/voices';
import { configuredProviders, AZURE_OUTPUT_FORMAT } from './providers';
import { houseSpeed, otherProviderHash, settingsHash, TTS_MODEL } from './settings';
import type { AccountProblem } from './account';

export const TTS_CONFIG_CACHE_MS = 30_000;

let cached: { at: number; config: TtsConfig } | null = null;

/** Tests / a save: forget the cached settings (this isolate). */
export function clearTtsConfigCache(): void {
  cached = null;
  cachedAccounts = null;
}

export async function loadTtsConfig(env: Pick<Env, 'DB'>, now = Date.now()): Promise<TtsConfig> {
  if (cached && now - cached.at < TTS_CONFIG_CACHE_MS) return cached.config;
  let config: TtsConfig;
  try {
    const row = env.DB ? await env.DB.prepare('SELECT settings FROM tts_settings WHERE id = 1').first<{ settings: string }>() : null;
    config = parseStoredTtsConfig(row?.settings ?? null);
  } catch {
    // No table yet (a migration not applied) or a blip: the defaults = today's behaviour.
    config = cloneTtsConfig(DEFAULT_TTS_CONFIG);
  }
  cached = { at: now, config };
  return config;
}

export async function saveTtsConfig(db: D1Database, config: TtsConfig, userId: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tts_settings (id, settings, updated_at, updated_by) VALUES (1, ?, datetime('now'), ?)
       ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(JSON.stringify(config), userId)
    .run();
  clearTtsConfigCache();
}

export async function ttsSettingsUpdatedAt(db: D1Database): Promise<{ updated_at: string | null; updated_by: string | null }> {
  try {
    const row = await db.prepare('SELECT updated_at, updated_by FROM tts_settings WHERE id = 1').first<{ updated_at: string; updated_by: string | null }>();
    return { updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null };
  } catch {
    return { updated_at: null, updated_by: null };
  }
}

// ---------- Voices ----------

/** The role a requested MiniMax voice plays: the app's own voice, or a speaker of a gender. */
export function voiceRole(requested: string | undefined, config: TtsConfig): TtsVoiceRole {
  if (!requested || requested === config.providers.minimax.voices.default) return 'default';
  return conversationVoice(requested)?.gender ?? (/female/i.test(requested) ? 'female' : /male/i.test(requested) ? 'male' : 'default');
}

/**
 * The voice + rate `provider` speaks a request in. MiniMax keeps a requested
 * catalogue voice as it is (and its speed); another provider maps it through
 * its voice for that role, and its rate through `speed_factor`.
 */
export function providerVoice(
  provider: TtsProviderId,
  config: TtsConfig,
  req: { voiceId?: string; speed: number },
): { voice: string; rate: number } {
  if (provider === 'minimax') return { voice: req.voiceId ?? config.providers.minimax.voices.default, rate: req.speed };
  const p = config.providers[provider];
  const voice = p.voices[voiceRole(req.voiceId, config)];
  return { voice, rate: providerRate(p, req.speed) };
}

/**
 * The voice, rate and style `provider` speaks a CONVERSATION line in
 * (docs/AUDIO.md "Conversation audio"). The device resolves the voice in the
 * active provider's own catalogue (shared/lesson/conversationAudio.ts); a
 * voice of another provider — a fallback, or a clip asked for before the
 * provider changed — is mapped through this provider's voice for its gender.
 * The rate is the provider's own (clamped to its natural-sounding range);
 * `speed` undefined = the provider's admin `conversation_rate`.
 */
export function conversationProviderVoice(
  provider: TtsProviderId,
  config: TtsConfig,
  req: { voiceId?: string; speed?: number; delivery?: ConversationDelivery },
): { voice: string; rate: number; style?: string; emotion?: string } {
  const p = config.providers[provider];
  let voice: string;
  if (req.voiceId && conversationVoiceProvider(req.voiceId) === provider) voice = req.voiceId;
  else {
    const gender = (req.voiceId && conversationVoiceGender(req.voiceId)) || voiceRole(req.voiceId, config);
    voice = p.voices[gender === 'female' || gender === 'male' ? gender : 'default'];
  }
  const rate = clampConversationRate(provider, req.speed ?? p.conversation_rate);
  const params = deliveryParams(provider, voice, req.delivery ?? 'natural');
  return { voice, rate, style: params?.azure_style, emotion: params?.minimax_emotion };
}

/** The provider conversation clips come from now: the first stored provider, the next while it is paused. */
export function activeConversationProvider(policy: Pick<StoredClipPolicy, 'order' | 'primaryUnavailable'>): TtsProviderId {
  if (!policy.order.length) return 'minimax';
  return policy.primaryUnavailable && policy.order[1] ? policy.order[1] : policy.order[0];
}

/** The settings hash of a stored clip `provider` makes with its default voice at the house speed. */
export function storedClipHash(provider: TtsProviderId, config: TtsConfig, env: { TTS_SPEED_OVERRIDE?: string } = {}): string {
  const speed = houseSpeed(env);
  if (provider === 'minimax') return settingsHash(TTS_MODEL, config.providers.minimax.voices.default, speed);
  const { voice, rate } = providerVoice(provider, config, { speed });
  const fixed = isFixedRateVoice(provider, voice);
  return otherProviderHash(provider, voice, fixed ? 'own' : rate, provider === 'azure' ? AZURE_OUTPUT_FORMAT : 'mp3-24k');
}

// ---------- Which providers are available ----------

let cachedAccounts: { at: number; problems: Partial<Record<TtsProviderId, AccountProblem | null>> } | null = null;

/** Account problems per provider (the limiter DOs), cached like the config. A failed lookup = fine. */
export async function providerAccountProblems(env: Env, now = Date.now()): Promise<Partial<Record<TtsProviderId, AccountProblem | null>>> {
  if (cachedAccounts && now - cachedAccounts.at < TTS_CONFIG_CACHE_MS) return cachedAccounts.problems;
  const problems: Partial<Record<TtsProviderId, AccountProblem | null>> = {};
  if (env.TTS_LIMITER) {
    await Promise.all(
      (['minimax', 'azure', 'google'] as const).map(async (p) => {
        try {
          problems[p] = await env.TTS_LIMITER!.get(env.TTS_LIMITER!.idFromName(p)).accountStatus();
        } catch {
          problems[p] = null;
        }
      }),
    );
  }
  cachedAccounts = { at: now, problems };
  return problems;
}

export interface StoredClipPolicy {
  /** Providers tried for stored clips, in order (enabled + configured). */
  order: TtsProviderId[];
  primary: TtsProviderId | null;
  /** The first provider is account-paused (no credit / bad key). */
  primaryUnavailable: boolean;
  /** Providers whose clips (made with their current settings) count as current. */
  acceptable: TtsProviderId[];
  hashes: Record<TtsProviderId, string>;
  /** The hashes of `acceptable` — the backfill's "current" test. */
  acceptableHashes: string[];
}

/** Pure: which providers' clips are current. */
export function acceptableProviders(order: TtsProviderId[], upgradeBackupClips: boolean, primaryUnavailable: boolean): TtsProviderId[] {
  if (order.length === 0) return [];
  if (!upgradeBackupClips || primaryUnavailable) return [...order];
  return [order[0]];
}

export function buildStoredClipPolicy(
  config: TtsConfig,
  configured: Record<TtsProviderId, boolean>,
  accountProblems: Partial<Record<TtsProviderId, AccountProblem | null>>,
  env: { TTS_SPEED_OVERRIDE?: string } = {},
): StoredClipPolicy {
  const order = usableOrder(config.stored_order, config, configured);
  const primary = order[0] ?? null;
  const primaryUnavailable = !!(primary && accountProblems[primary]);
  const hashes = {
    minimax: storedClipHash('minimax', config, env),
    azure: storedClipHash('azure', config, env),
    google: storedClipHash('google', config, env),
  };
  const acceptable = acceptableProviders(order, config.upgrade_backup_clips, primaryUnavailable);
  // Nothing usable: judge clips against MiniMax's settings (the counts stay meaningful).
  const acceptableHashes = acceptable.length ? acceptable.map((p) => hashes[p]) : [hashes.minimax];
  return { order, primary, primaryUnavailable, acceptable, hashes, acceptableHashes };
}

export async function storedClipPolicy(env: Env): Promise<StoredClipPolicy> {
  const config = await loadTtsConfig(env);
  const problems = await providerAccountProblems(env);
  return buildStoredClipPolicy(config, configuredProviders(env), problems, env);
}
