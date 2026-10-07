/**
 * One clip of an audio lesson through the TTS providers (docs/AUDIO_LESSONS.md
 * "Speaking"): every call goes through `callProviderTTS` (the provider's limiter
 * + account pause), in the lesson MP3 format (24 kHz mono), and the answer is
 * checked frame by frame before it is kept — a clip in another format could not
 * be joined into the lesson file.
 */
import type { Env } from '../../types';
import { SLEEP_ZH_PROVIDER_RATE, type ScriptSpeaker, type VoiceRole } from '@shared/audio-lesson';
import { providerRate, usableOrder, type TtsConfig, type TtsProviderId } from '@shared/tts';
import { callProviderTTS, combineProviderFailures, shouldTryNextProvider, type ProviderCallOutcome } from '../audio';
import { configuredProviders } from '../tts/providers';
import type { TtsPriority } from '../tts/bucket';
import { checkClipFormat, parseMp3Frames } from './mp3';
import { ENGLISH_ORDER, roleVoice } from './voices';
import { fakeClip } from './fake';

export interface ClipRequest {
  lang: 'zh' | 'en';
  voice: VoiceRole;
  /** The app's speed scale (MiniMax's). */
  rate: number;
  text: string;
}

export type ClipOutcome =
  | { ok: true; bytes: Uint8Array; provider: TtsProviderId; voice: string }
  /** Try again later (rate limit, account pause): nothing is wrong with the clip. */
  | { ok: false; wait: true; retryAfterMs: number; reason: string }
  | { ok: false; wait: false; permanent: boolean; reason: string };

/**
 * The rate a provider is asked for. The sleep voice's Chinese goes at that provider's own slowest
 * natural rate (`SLEEP_ZH_PROVIDER_RATE`: MiniMax 0.5, Azure 0.6, Google 0.6); everything else is
 * the app-scale rate mapped per provider (`providerRate`; MiniMax's scale IS the app's).
 */
export function lessonClipRate(provider: TtsProviderId, clip: Pick<ClipRequest, 'lang' | 'voice' | 'rate'>, config: TtsConfig): number {
  if (clip.voice === 'sleep' && clip.lang === 'zh') return SLEEP_ZH_PROVIDER_RATE[provider];
  return provider === 'minimax' ? clip.rate : providerRate(config.providers[provider], clip.rate);
}

/** The providers a clip may use: the pinned one, else the stored order (Chinese) / English order. */
export function clipOrder(env: Env, config: TtsConfig, lang: 'zh' | 'en', pinned: TtsProviderId | null): TtsProviderId[] {
  const configured = configuredProviders(env);
  if (lang === 'en') return usableOrder(ENGLISH_ORDER, config, configured);
  if (pinned) return usableOrder([pinned], config, configured);
  return usableOrder(config.stored_order, config, configured);
}

export async function speakClip(
  env: Env,
  config: TtsConfig,
  clip: ClipRequest,
  speakers: ScriptSpeaker[],
  pinned: TtsProviderId | null,
  opts: { priority: TtsPriority; maxWaitMs: number },
): Promise<ClipOutcome> {
  if (env.E2E_TEST_MODE === 'true') return { ok: true, bytes: fakeClip(clip.text, clip.rate), provider: 'azure', voice: 'fake' };
  const order = clipOrder(env, config, clip.lang, pinned);
  const attempts: Array<{ provider: TtsProviderId; outcome: Exclude<ProviderCallOutcome, { ok: true }> }> = [];
  for (const provider of order) {
    const rv = roleVoice(provider, clip.voice, speakers, config);
    if (!rv) continue;
    const rate = lessonClipRate(provider, clip, config);
    const out = await callProviderTTS(
      env,
      provider,
      { text: clip.text, voice: rv.voice, rate, lang: rv.lang, style: rv.style, lessonFormat: true },
      { priority: opts.priority, maxWaitMs: opts.maxWaitMs, maxRpm: config.providers[provider].max_rpm },
    );
    if (out.ok) {
      const parsed = parseMp3Frames(out.bytes);
      const problem = checkClipFormat(parsed);
      if (!problem) return { ok: true, bytes: out.bytes, provider, voice: rv.voice };
      console.error('[audio-lesson] unusable clip from', provider, problem);
      attempts.push({ provider, outcome: { ok: false, permanent: false, rateLimited: false, reason: `${provider} ${problem}` } });
      continue;
    }
    attempts.push({ provider, outcome: out });
    if (!shouldTryNextProvider(out, opts.priority)) break;
  }
  if (attempts.length === 0) {
    return { ok: false, wait: false, permanent: true, reason: clip.lang === 'en' ? 'No English voice is configured (Azure or Google)' : 'No Chinese voice is configured' };
  }
  const combined = combineProviderFailures(attempts);
  if (combined.rateLimited) return { ok: false, wait: true, retryAfterMs: combined.retryAfterMs ?? 60_000, reason: combined.reason };
  return { ok: false, wait: false, permanent: combined.permanent, reason: combined.reason };
}
