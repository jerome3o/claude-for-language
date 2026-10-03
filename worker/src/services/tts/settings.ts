/**
 * The ONE set of TTS settings every stored clip is made with (docs/AUDIO.md),
 * and the signature recorded with each clip so the backfill can tell a clip
 * made with an older voice, model, speed or text from a current one.
 */

/** MiniMax model for every call (stored clips, conversation lines, chat read-aloud, voice samples). */
export const TTS_MODEL = 'speech-2.8-hd';
/** Radio Host: the clear "theatre" voice Jerome's tutor likes. */
export const TTS_VOICE = 'Chinese (Mandarin)_Radio_Host';
/** Slow, learner speed. MiniMax accepts 0.5–2. */
export const TTS_SPEED = 0.6;
/** The encode is part of the settings: a service-side default change is very audible. */
export const TTS_AUDIO_SETTING = { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 } as const;

export interface TtsSettings {
  model: string;
  voice: string;
  speed: number;
  /** Short hash of everything above + the encode: `s<8 hex>`. */
  hash: string;
}

/** 32-bit FNV-1a as 8 hex chars. Deterministic everywhere, no async crypto. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function settingsHash(model: string, voice: string, speed: number): string {
  const a = TTS_AUDIO_SETTING;
  return 's' + fnv1a(`${model}|${voice}|${speed}|${a.format}|${a.sample_rate}|${a.bitrate}|${a.channel}`);
}

/**
 * Current settings. `TTS_SPEED_OVERRIDE` (wrangler var) lets the perceived speed be
 * matched if a model change speaks faster or slower at the same number; changing it
 * changes the hash, so the backfill regenerates every clip at the new speed.
 */
export function ttsSettings(env: { TTS_SPEED_OVERRIDE?: string } = {}): TtsSettings {
  const override = Number(env.TTS_SPEED_OVERRIDE);
  const speed = Number.isFinite(override) && override >= 0.5 && override <= 2 ? override : TTS_SPEED;
  return { model: TTS_MODEL, voice: TTS_VOICE, speed, hash: settingsHash(TTS_MODEL, TTS_VOICE, speed) };
}

/** What a stored clip records: `<settings hash>.<text hash>`. A changed text or setting = stale. */
export function clipSignature(settings: Pick<TtsSettings, 'hash'>, text: string): string {
  return `${settings.hash}.${fnv1a(text.trim())}`;
}

/** Was this clip made with the current settings (whatever its text)? SQL uses `LIKE '<hash>.%'` for the same test. */
export function signatureHasSettings(signature: string | null | undefined, settings: Pick<TtsSettings, 'hash'>): boolean {
  return !!signature && signature.startsWith(`${settings.hash}.`);
}
