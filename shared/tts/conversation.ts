/**
 * How a conversation exercise's lines are spoken, per TTS provider
 * (docs/AUDIO.md "Conversation audio"): the speed, the voices a learner may
 * pick, and the "delivery" (a provider's speaking style / emotion) — the
 * pure part shared by the worker, the web app and (ported, parity-tested)
 * the Lab app.
 *
 * A conversation speed is the PROVIDER's own rate (1 = its natural pace),
 * clamped to the part of its range that still sounds natural
 * (PROVIDER_RATE_RANGE). Card clips keep the app speed + `speed_factor`
 * mapping (config.ts) — nothing here touches them.
 */
import {
  AZURE_VOICES,
  GOOGLE_VOICES,
  PROVIDER_RATE_RANGE,
  TTS_PROVIDERS,
  type TtsProviderId,
  type TtsVoiceOption,
} from './config';
import { CONVERSATION_VOICES } from '../lesson/voices';

/** The learner's speed choices in the Audio menu (clamped to the provider's good range). */
export const CONVERSATION_SPEED_STEPS: readonly number[] = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1];

/** When nothing better is known (no server answer yet): a slow-but-natural pace. */
export const DEFAULT_CONVERSATION_RATE = 0.8;

/** A conversation speed → what `provider` is asked for: clamped to its good range, 0.01 steps. */
export function clampConversationRate(provider: TtsProviderId, speed: number): number {
  const r = PROVIDER_RATE_RANGE[provider] ?? PROVIDER_RATE_RANGE.minimax;
  const n = Number.isFinite(speed) ? speed : DEFAULT_CONVERSATION_RATE;
  return Math.round(Math.min(r.good_max, Math.max(r.good_min, n)) * 100) / 100;
}

/** The speed steps a provider offers (those inside its good range). */
export function conversationSpeedSteps(provider: TtsProviderId): number[] {
  const r = PROVIDER_RATE_RANGE[provider] ?? PROVIDER_RATE_RANGE.minimax;
  return CONVERSATION_SPEED_STEPS.filter((s) => s >= r.good_min && s <= r.good_max);
}

// ---------- Voices ----------

export interface ConversationProviderVoice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  note: string;
}

/**
 * The voices a conversation may be spoken in, per provider. MiniMax = the
 * lesson catalogue (shared/lesson/voices.ts); Azure / Google = their curated
 * catalogues minus HD voices (they ignore the speed and exist only in some regions).
 */
export function conversationProviderVoices(provider: TtsProviderId): ConversationProviderVoice[] {
  if (provider === 'minimax') {
    return CONVERSATION_VOICES.map((v) => ({ id: v.id, name: v.name, gender: v.gender, note: v.note }));
  }
  const list: readonly TtsVoiceOption[] = provider === 'azure' ? AZURE_VOICES : GOOGLE_VOICES;
  return list.filter((v) => !v.fixed_rate).map((v) => ({ id: v.id, name: v.name, gender: v.gender, note: v.note ?? '' }));
}

const OWNER = new Map<string, { provider: TtsProviderId; gender: 'female' | 'male' }>();
for (const p of TTS_PROVIDERS) {
  for (const v of conversationProviderVoices(p)) if (!OWNER.has(v.id)) OWNER.set(v.id, { provider: p, gender: v.gender });
}

/** Which provider a conversation voice id belongs to (null = not a conversation voice). */
export function conversationVoiceProvider(id: string): TtsProviderId | null {
  return OWNER.get(id)?.provider ?? null;
}

export function conversationVoiceGender(id: string): 'female' | 'male' | null {
  return OWNER.get(id)?.gender ?? null;
}

/** The voices of one gender a provider rotates through for automatic picks (catalogue order).
 * MiniMax's pools come from the account's enabled selection instead (voices.ts). */
export function providerVoicePools(provider: TtsProviderId): Record<'female' | 'male', string[]> {
  const all = conversationProviderVoices(provider);
  return {
    female: all.filter((v) => v.gender === 'female').map((v) => v.id),
    male: all.filter((v) => v.gender === 'male').map((v) => v.id),
  };
}

// ---------- Delivery (speaking style / emotion) ----------

export type ConversationDelivery = 'natural' | 'chat' | 'calm' | 'cheerful';
export const CONVERSATION_DELIVERIES: readonly ConversationDelivery[] = ['natural', 'chat', 'calm', 'cheerful'];
export const DELIVERY_LABELS: Record<ConversationDelivery, string> = {
  natural: 'Natural',
  chat: 'Conversational',
  calm: 'Calm',
  cheerful: 'Cheerful',
};

/** Azure `mstts:express-as` styles per zh-CN voice (learn.microsoft.com language-support, Oct 2026). */
export const AZURE_VOICE_STYLES: Record<string, readonly string[]> = {
  'zh-CN-XiaoxiaoNeural': ['affectionate', 'angry', 'assistant', 'calm', 'chat', 'chat-casual', 'cheerful', 'customerservice', 'disgruntled', 'excited', 'fearful', 'friendly', 'gentle', 'lyrical', 'newscast', 'poetry-reading', 'sad', 'serious', 'sorry', 'whispering'],
  'zh-CN-XiaochenNeural': ['livecommercial'],
  'zh-CN-XiaoyiNeural': ['affectionate', 'angry', 'cheerful', 'disgruntled', 'embarrassed', 'fearful', 'gentle', 'sad', 'serious'],
  'zh-CN-YunxiNeural': ['angry', 'assistant', 'chat', 'cheerful', 'depressed', 'disgruntled', 'embarrassed', 'fearful', 'narration-relaxed', 'newscast', 'sad', 'serious'],
  'zh-CN-YunjianNeural': ['angry', 'cheerful', 'depressed', 'disgruntled', 'documentary-narration', 'narration-relaxed', 'sad', 'serious', 'sports-commentary', 'sports-commentary-excited'],
  'zh-CN-YunyangNeural': ['customerservice', 'narration-professional', 'newscast-casual'],
};

/** Per delivery, the Azure styles that give it, best first (a voice takes the first it supports). */
const AZURE_DELIVERY_STYLES: Record<Exclude<ConversationDelivery, 'natural'>, readonly string[]> = {
  chat: ['chat', 'chat-casual'],
  calm: ['calm', 'narration-relaxed', 'gentle'],
  cheerful: ['cheerful'],
};

/** MiniMax `voice_setting.emotion` per delivery (speech-2.8: happy / sad / angry / fearful / disgusted / surprised / calm). */
const MINIMAX_DELIVERY_EMOTION: Partial<Record<ConversationDelivery, string>> = {
  calm: 'calm',
  cheerful: 'happy',
};

export interface DeliveryParams {
  /** Azure `<mstts:express-as style>`. */
  azure_style?: string;
  /** MiniMax `voice_setting.emotion`. */
  minimax_emotion?: string;
}

/**
 * What a delivery means for one provider + voice. Null = this voice speaks it
 * naturally (unsupported — never an error: the line is still spoken).
 */
export function deliveryParams(provider: TtsProviderId, voice: string, delivery: ConversationDelivery): DeliveryParams | null {
  if (delivery === 'natural') return null;
  if (provider === 'azure') {
    const styles = AZURE_VOICE_STYLES[voice] ?? [];
    const style = AZURE_DELIVERY_STYLES[delivery].find((s) => styles.includes(s));
    return style ? { azure_style: style } : null;
  }
  if (provider === 'minimax') {
    const emotion = MINIMAX_DELIVERY_EMOTION[delivery];
    return emotion ? { minimax_emotion: emotion } : null;
  }
  return null;
}

/** The deliveries a voice can actually give (natural always). */
export function supportedDeliveries(provider: TtsProviderId, voice: string): ConversationDelivery[] {
  return CONVERSATION_DELIVERIES.filter((d) => d === 'natural' || deliveryParams(provider, voice, d) !== null);
}

export function isConversationDelivery(v: unknown): v is ConversationDelivery {
  return typeof v === 'string' && (CONVERSATION_DELIVERIES as readonly string[]).includes(v);
}
