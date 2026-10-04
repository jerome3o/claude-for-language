/**
 * TTS providers and the admin's audio settings (docs/AUDIO.md "Providers").
 *
 * Three providers can speak: MiniMax (the house voice), Azure Speech (the
 * permanent backup) and Google (live playback only, unless an admin puts it in
 * the stored order). The admin page (/admin/audio) and the MCP tools
 * `audio_settings_get` / `audio_settings_update` edit ONE `TtsConfig`, stored in
 * D1 (`tts_settings`, migration 0107) and read by the worker
 * (`services/tts/config.ts`, cached briefly). Defaults = the behaviour before
 * providers existed: MiniMax only for stored clips, Google as the live fallback.
 *
 * Pure: validation + the voice catalogues + speed mapping, shared by the worker
 * and the admin page.
 */

export type TtsProviderId = 'minimax' | 'azure' | 'google';
export const TTS_PROVIDERS: readonly TtsProviderId[] = ['minimax', 'azure', 'google'];
export const TTS_PROVIDER_NAMES: Record<TtsProviderId, string> = { minimax: 'MiniMax', azure: 'Azure Speech', google: 'Google' };

/** What a clip is spoken for: the app's own voice, or a speaker of a gender (chat / conversations). */
export type TtsVoiceRole = 'default' | 'female' | 'male';
export const TTS_VOICE_ROLES: readonly TtsVoiceRole[] = ['default', 'female', 'male'];

export interface TtsProviderConfig {
  enabled: boolean;
  /** Hard cap on requests per minute; the limiter learns the real rate below it. */
  max_rpm: number;
  voices: Record<TtsVoiceRole, string>;
  /**
   * How the app's speed (0.6 cards, 0.9 conversations; MiniMax's scale) maps to
   * this provider: rate = 1 + (speed − 1) × factor. 1 = the same number.
   */
  speed_factor: number;
}

export interface TtsConfig {
  /** Providers tried, in order, for clips that are KEPT (R2 + both apps' caches). */
  stored_order: TtsProviderId[];
  /** Providers tried, in order, for live playback nobody keeps (chat read-aloud fallback, role-play replies). */
  live_order: TtsProviderId[];
  /** When the first stored provider is available again, the backfill remakes clips a backup provider made. */
  upgrade_backup_clips: boolean;
  providers: Record<TtsProviderId, TtsProviderConfig>;
}

export interface TtsVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  note?: string;
  /** Azure HD voices take no <prosody>: they speak at their own pace (speed ignored). */
  fixed_rate?: boolean;
}

/** The MiniMax voices offered per role (the full lesson catalogue stays in shared/lesson/voices.ts). */
export const MINIMAX_VOICES: readonly TtsVoiceOption[] = [
  { id: 'Chinese (Mandarin)_Radio_Host', name: 'Radio Host', gender: 'male', note: 'The app’s voice since Oct 2026' },
  { id: 'Chinese (Mandarin)_News_Anchor', name: 'News Anchor', gender: 'female' },
  { id: 'presenter_female', name: 'Presenter (female)', gender: 'female' },
  { id: 'audiobook_female_1', name: 'Audiobook narrator (female)', gender: 'female' },
  { id: 'Chinese (Mandarin)_Male_Announcer', name: 'Male Announcer', gender: 'male' },
  { id: 'presenter_male', name: 'Presenter (male)', gender: 'male' },
  { id: 'audiobook_male_1', name: 'Audiobook narrator (male)', gender: 'male' },
];

/**
 * Azure zh-CN voices (learn.microsoft.com language-support + high-definition-voices,
 * Oct 2026). The HD (DragonHD / DragonHDFlash) voices exist only in some regions
 * (eastus, westeurope, southeastasia…) and ignore <prosody rate>.
 */
export const AZURE_VOICES: readonly TtsVoiceOption[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao 晓晓', gender: 'female', note: 'Clear, warm — the usual default' },
  { id: 'zh-CN-XiaochenNeural', name: 'Xiaochen 晓辰', gender: 'female', note: 'Casual, relaxed' },
  { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi 晓伊', gender: 'female', note: 'Young, lively' },
  { id: 'zh-CN-YunxiNeural', name: 'Yunxi 云希', gender: 'male', note: 'Young man, clear' },
  { id: 'zh-CN-YunjianNeural', name: 'Yunjian 云健', gender: 'male', note: 'Adult man, energetic' },
  { id: 'zh-CN-YunyangNeural', name: 'Yunyang 云扬', gender: 'male', note: 'Newsreader' },
  { id: 'zh-CN-Xiaoxiao:DragonHDFlashLatestNeural', name: 'Xiaoxiao HD Flash', gender: 'female', note: 'HD — some regions only; own pace', fixed_rate: true },
  { id: 'zh-CN-Xiaochen:DragonHDFlashLatestNeural', name: 'Xiaochen HD Flash', gender: 'female', note: 'HD — some regions only; own pace', fixed_rate: true },
  { id: 'zh-CN-Yunxi:DragonHDFlashLatestNeural', name: 'Yunxi HD Flash', gender: 'male', note: 'HD — some regions only; own pace', fixed_rate: true },
  { id: 'zh-cn-Xiaochen:DragonHDLatestNeural', name: 'Xiaochen Dragon HD', gender: 'female', note: 'HD — some regions only; own pace', fixed_rate: true },
  { id: 'zh-cn-Yunfan:DragonHDLatestNeural', name: 'Yunfan Dragon HD', gender: 'male', note: 'HD — some regions only; own pace', fixed_rate: true },
];

export const GOOGLE_VOICES: readonly TtsVoiceOption[] = [
  { id: 'cmn-CN-Wavenet-C', name: 'Wavenet C', gender: 'female', note: 'The old fallback voice' },
  { id: 'cmn-CN-Wavenet-A', name: 'Wavenet A', gender: 'female' },
  { id: 'cmn-CN-Wavenet-B', name: 'Wavenet B', gender: 'male' },
  { id: 'cmn-CN-Wavenet-D', name: 'Wavenet D', gender: 'male' },
];

export const TTS_VOICE_CATALOGUE: Record<TtsProviderId, readonly TtsVoiceOption[]> = {
  minimax: MINIMAX_VOICES,
  azure: AZURE_VOICES,
  google: GOOGLE_VOICES,
};

/** A voice outside the catalogue is allowed when it looks like the provider's own ids. */
const VOICE_PATTERN: Record<TtsProviderId, RegExp> = {
  minimax: /^[A-Za-z0-9 ()_\-.]{2,80}$/,
  azure: /^[a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+(:[A-Za-z0-9]+)?Neural$/,
  google: /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]+$/,
};

export function isFixedRateVoice(provider: TtsProviderId, voice: string): boolean {
  return provider === 'azure' && voice.includes(':');
}

/** Azure F0 (free) allows 20 requests / 60 s: start well below it. */
export const AZURE_DEFAULT_MAX_RPM = 15;
export const RPM_LIMIT = 600;

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  stored_order: ['minimax'],
  live_order: ['minimax', 'google'],
  upgrade_backup_clips: true,
  providers: {
    minimax: {
      enabled: true,
      max_rpm: 55,
      voices: { default: 'Chinese (Mandarin)_Radio_Host', female: 'Chinese (Mandarin)_News_Anchor', male: 'Chinese (Mandarin)_Male_Announcer' },
      speed_factor: 1,
    },
    azure: {
      enabled: true,
      max_rpm: AZURE_DEFAULT_MAX_RPM,
      voices: { default: 'zh-CN-XiaoxiaoNeural', female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
      // MiniMax 0.6 is slow but not half speed: 0.6 → 0.7 (−30 %), 0.9 → 0.925.
      speed_factor: 0.75,
    },
    google: {
      enabled: true,
      max_rpm: 60,
      voices: { default: 'cmn-CN-Wavenet-C', female: 'cmn-CN-Wavenet-C', male: 'cmn-CN-Wavenet-B' },
      speed_factor: 1,
    },
  },
};

export function cloneTtsConfig(c: TtsConfig = DEFAULT_TTS_CONFIG): TtsConfig {
  return JSON.parse(JSON.stringify(c)) as TtsConfig;
}

/** The app's speed → this provider's rate (clamped 0.5–2, rounded to 0.01). */
export function providerRate(provider: TtsProviderConfig, speed: number): number {
  const factor = Number.isFinite(provider.speed_factor) ? provider.speed_factor : 1;
  const rate = 1 + (speed - 1) * factor;
  return Math.round(Math.min(2, Math.max(0.5, rate)) * 100) / 100;
}

/** Azure SSML `rate` attribute for a multiplier: 0.7 → "-30%". */
export function azureRateAttr(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function isProvider(v: unknown): v is TtsProviderId {
  return v === 'minimax' || v === 'azure' || v === 'google';
}

function pickOrder(v: unknown, label: string, problems: string[]): TtsProviderId[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    problems.push(`${label} must be a list of providers`);
    return undefined;
  }
  const out: TtsProviderId[] = [];
  const before = problems.length;
  for (const p of v) {
    if (!isProvider(p)) problems.push(`${label}: unknown provider "${String(p)}"`);
    else if (out.includes(p)) problems.push(`${label}: ${p} is listed twice`);
    else out.push(p);
  }
  if (out.length === 0) problems.push(`${label} needs at least one provider`);
  return problems.length === before ? out : undefined;
}

/**
 * Merge a (partial) update into `base`, validated. Unknown keys are ignored;
 * every problem is reported (the page shows them, the API answers 400).
 * Orders may name a disabled / unconfigured provider: it is skipped at run time.
 */
export function mergeTtsConfig(base: TtsConfig, input: unknown): { config: TtsConfig; problems: string[] } {
  const problems: string[] = [];
  const config = cloneTtsConfig(base);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { config, problems: ['settings must be an object'] };
  }
  const o = input as Record<string, unknown>;
  const stored = pickOrder(o.stored_order, 'stored_order', problems);
  if (stored) config.stored_order = stored;
  const live = pickOrder(o.live_order, 'live_order', problems);
  if (live) config.live_order = live;
  if (o.upgrade_backup_clips !== undefined) {
    if (typeof o.upgrade_backup_clips !== 'boolean') problems.push('upgrade_backup_clips must be true or false');
    else config.upgrade_backup_clips = o.upgrade_backup_clips;
  }
  if (o.providers !== undefined) {
    if (o.providers === null || typeof o.providers !== 'object') problems.push('providers must be an object');
    else {
      for (const [id, raw] of Object.entries(o.providers as Record<string, unknown>)) {
        if (!isProvider(id)) {
          problems.push(`providers: unknown provider "${id}"`);
          continue;
        }
        if (raw === null || typeof raw !== 'object') {
          problems.push(`providers.${id} must be an object`);
          continue;
        }
        const p = raw as Record<string, unknown>;
        const target = config.providers[id];
        if (p.enabled !== undefined) {
          if (typeof p.enabled !== 'boolean') problems.push(`providers.${id}.enabled must be true or false`);
          else target.enabled = p.enabled;
        }
        if (p.max_rpm !== undefined) {
          const n = Number(p.max_rpm);
          if (typeof p.max_rpm !== 'number' || !Number.isInteger(n) || n < 1 || n > RPM_LIMIT) problems.push(`providers.${id}.max_rpm must be a whole number 1–${RPM_LIMIT}`);
          else target.max_rpm = n;
        }
        if (p.speed_factor !== undefined) {
          const n = Number(p.speed_factor);
          if (typeof p.speed_factor !== 'number' || !Number.isFinite(n) || n < 0 || n > 2) problems.push(`providers.${id}.speed_factor must be between 0 and 2`);
          else target.speed_factor = Math.round(n * 100) / 100;
        }
        if (p.voices !== undefined) {
          if (p.voices === null || typeof p.voices !== 'object') problems.push(`providers.${id}.voices must be an object`);
          else {
            for (const [role, voice] of Object.entries(p.voices as Record<string, unknown>)) {
              if (!(TTS_VOICE_ROLES as readonly string[]).includes(role)) {
                problems.push(`providers.${id}.voices: unknown role "${role}"`);
                continue;
              }
              const v = typeof voice === 'string' ? voice.trim() : '';
              const known = TTS_VOICE_CATALOGUE[id].some((x) => x.id === v);
              if (!v || (!known && !VOICE_PATTERN[id].test(v))) problems.push(`providers.${id}.voices.${role}: "${String(voice)}" is not a ${TTS_PROVIDER_NAMES[id]} voice`);
              else target.voices[role as TtsVoiceRole] = v;
            }
          }
        }
      }
    }
  }
  return { config, problems };
}

/** A stored row → a usable config (bad or missing parts fall back to the defaults, never throw). */
export function parseStoredTtsConfig(raw: string | null | undefined): TtsConfig {
  if (!raw) return cloneTtsConfig();
  try {
    const { config, problems } = mergeTtsConfig(DEFAULT_TTS_CONFIG, JSON.parse(raw));
    if (problems.length) console.warn('[tts-config] stored settings had problems (defaults used for those parts):', problems);
    return config;
  } catch {
    return cloneTtsConfig();
  }
}

/** Which providers an order actually tries: enabled + configured, in order. */
export function usableOrder(order: readonly TtsProviderId[], config: TtsConfig, configured: Record<TtsProviderId, boolean>): TtsProviderId[] {
  return order.filter((p) => config.providers[p]?.enabled && configured[p]);
}
