/**
 * The learner's conversation-audio preferences (docs/AUDIO.md "Conversation
 * audio"): the speed, the delivery and the voices conversation exercises are
 * spoken in. One per account (`users.conversation_audio`, `GET|PUT
 * /api/conversation-audio`, on `/api/auth/me`), cached on the device so a
 * conversation resolves the same clips offline. Edited from the ⚙︎ Audio menu
 * on every conversation exercise and Settings → Conversation voices.
 *
 * Pure; the Lab app's `ConversationAudio.kt` is parity-tested against it.
 */
import type { ConversationExerciseSpec, ConversationSpeaker } from './types';
import { conversationSeed, resolveConversationVoices, speakerGender } from './voices';
import { TTS_PROVIDERS, type TtsProviderId } from '../tts/config';
import {
  clampConversationRate,
  conversationVoiceGender,
  conversationVoiceProvider,
  isConversationDelivery,
  providerVoicePools,
  DEFAULT_CONVERSATION_RATE,
  type ConversationDelivery,
} from '../tts/conversation';

type Gender = 'female' | 'male';

export interface ConversationAudioPrefs {
  /** The provider rate lines are spoken at; null = the provider's default (admin `conversation_rate`). */
  speed: number | null;
  delivery: ConversationDelivery;
  /** Preferred voice per gender, per provider — the first speaker of that gender gets it in every conversation. */
  voices: Partial<Record<TtsProviderId, Partial<Record<Gender, string>>>>;
  /** One conversation's voices, by speaker (null = automatic), keyed `<provider>:<conversation key>`. */
  exercise_voices: Record<string, Array<string | null>>;
}

export const DEFAULT_CONVERSATION_AUDIO_PREFS: ConversationAudioPrefs = {
  speed: null,
  delivery: 'natural',
  voices: {},
  exercise_voices: {},
};

/** Most per-conversation voice choices kept (oldest dropped first). */
export const MAX_EXERCISE_VOICE_ENTRIES = 200;
const MAX_SPEAKERS = 6;

/** A conversation's key in the preferences: its seed in base 36 (stable per dialogue). */
export function conversationAudioKey(ex: Pick<ConversationExerciseSpec, 'situation' | 'lines'>): string {
  return conversationSeed(ex).toString(36);
}

export function exerciseVoicesKey(provider: TtsProviderId, key: string): string {
  return `${provider}:${key}`;
}

const EXERCISE_KEY = /^(minimax|azure|google):[0-9a-z]{1,13}$/;

function cleanPrefs(p: ConversationAudioPrefs): ConversationAudioPrefs {
  return JSON.parse(JSON.stringify(p)) as ConversationAudioPrefs;
}

/**
 * Merge a partial update into `base`, validated (the server's PUT, and the
 * stored row). `speed: null` = back to the default; `voices.<provider>.<gender>:
 * null` and `exercise_voices.<key>: null` remove one entry; everything else is
 * merged key by key, so two devices editing different conversations never
 * clobber each other.
 */
export function mergeConversationAudioPrefs(
  base: ConversationAudioPrefs,
  input: unknown,
): { prefs: ConversationAudioPrefs; problems: string[] } {
  const problems: string[] = [];
  const prefs = cleanPrefs(base);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { prefs, problems: ['preferences must be an object'] };
  }
  const o = input as Record<string, unknown>;
  if (o.speed !== undefined) {
    if (o.speed === null) prefs.speed = null;
    else if (typeof o.speed !== 'number' || !Number.isFinite(o.speed) || o.speed < 0.5 || o.speed > 1.2) {
      problems.push('speed must be between 0.5 and 1.2 (or null for the default)');
    } else prefs.speed = Math.round(o.speed * 100) / 100;
  }
  if (o.delivery !== undefined) {
    if (!isConversationDelivery(o.delivery)) problems.push(`Unknown delivery: ${String(o.delivery)}`);
    else prefs.delivery = o.delivery;
  }
  if (o.voices !== undefined) {
    if (o.voices === null || typeof o.voices !== 'object' || Array.isArray(o.voices)) problems.push('voices must be an object');
    else {
      for (const [provider, raw] of Object.entries(o.voices as Record<string, unknown>)) {
        if (!(TTS_PROVIDERS as readonly string[]).includes(provider)) {
          problems.push(`voices: unknown provider "${provider}"`);
          continue;
        }
        const pid = provider as TtsProviderId;
        if (raw === null) {
          delete prefs.voices[pid];
          continue;
        }
        if (typeof raw !== 'object' || Array.isArray(raw)) {
          problems.push(`voices.${pid} must be an object`);
          continue;
        }
        const next = { ...(prefs.voices[pid] ?? {}) };
        for (const [gender, voice] of Object.entries(raw as Record<string, unknown>)) {
          if (gender !== 'female' && gender !== 'male') {
            problems.push(`voices.${pid}: unknown gender "${gender}"`);
            continue;
          }
          if (voice === null) delete next[gender];
          else if (typeof voice !== 'string' || conversationVoiceProvider(voice) !== pid || conversationVoiceGender(voice) !== gender) {
            problems.push(`voices.${pid}.${gender}: "${String(voice)}" is not a ${gender} ${pid} conversation voice`);
          } else next[gender] = voice;
        }
        if (Object.keys(next).length) prefs.voices[pid] = next;
        else delete prefs.voices[pid];
      }
    }
  }
  if (o.exercise_voices !== undefined) {
    if (o.exercise_voices === null || typeof o.exercise_voices !== 'object' || Array.isArray(o.exercise_voices)) {
      problems.push('exercise_voices must be an object');
    } else {
      for (const [key, raw] of Object.entries(o.exercise_voices as Record<string, unknown>)) {
        if (!EXERCISE_KEY.test(key)) {
          problems.push(`exercise_voices: bad key "${key}"`);
          continue;
        }
        if (raw === null) {
          delete prefs.exercise_voices[key];
          continue;
        }
        const provider = key.slice(0, key.indexOf(':')) as TtsProviderId;
        if (!Array.isArray(raw) || raw.length > MAX_SPEAKERS) {
          problems.push(`exercise_voices.${key} must be a list of up to ${MAX_SPEAKERS} voices`);
          continue;
        }
        const bad = raw.find((v) => v !== null && (typeof v !== 'string' || conversationVoiceProvider(v) !== provider));
        if (bad !== undefined) {
          problems.push(`exercise_voices.${key}: "${String(bad)}" is not a ${provider} conversation voice`);
          continue;
        }
        delete prefs.exercise_voices[key]; // re-inserted last = newest
        if (raw.some((v) => v !== null)) prefs.exercise_voices[key] = raw as Array<string | null>;
      }
      const keys = Object.keys(prefs.exercise_voices);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_EXERCISE_VOICE_ENTRIES))) delete prefs.exercise_voices[k];
    }
  }
  return { prefs, problems };
}

/** A stored row → usable preferences (bad parts dropped, never throws). */
export function parseConversationAudioPrefs(raw: string | null | undefined): ConversationAudioPrefs {
  if (!raw) return cleanPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Field by field, so one bad part doesn't lose the rest.
    let prefs = cleanPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS);
    for (const field of ['speed', 'delivery', 'voices', 'exercise_voices']) {
      if (parsed && parsed[field] !== undefined) {
        const r = mergeConversationAudioPrefs(prefs, { [field]: parsed[field] });
        if (!r.problems.length || field === 'voices' || field === 'exercise_voices') prefs = r.prefs;
      }
    }
    return prefs;
  } catch {
    return cleanPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS);
  }
}

/** Where conversation clips come from right now, as the server reports it (`/api/auth/me` → `conversation_audio`). */
export interface ConversationAudioContext {
  /** The provider that speaks conversation clips now (the first available in the stored order). */
  provider: TtsProviderId;
  /** That provider's default conversation rate (admin setting). */
  default_speed: number;
  /** The account's enabled MiniMax voices (Settings → Conversation voices); null = defaults. */
  enabled?: readonly string[] | null;
  prefs?: ConversationAudioPrefs | null;
}

export interface ResolvedConversationAudio {
  /** The conversation's key in `exercise_voices` (without the provider). */
  key: string;
  provider: TtsProviderId;
  /** One voice per speaker (distinct), in speaker order. */
  voices: string[];
  /** What each speaker would get with no choice made (the menu's "Automatic"). */
  auto_voices: string[];
  /** Which speakers' voices were chosen by the learner (this conversation or the gender preference). */
  chosen: boolean[];
  speed: number;
  delivery: ConversationDelivery;
}

/**
 * The voices, speed and delivery one conversation plays in. Per speaker: this
 * conversation's own choice, else (for the first speaker of a gender) the
 * learner's preferred voice for that gender, else the automatic rotation —
 * never the same voice twice while the pools allow it.
 */
export function resolveConversationAudio(
  ex: Pick<ConversationExerciseSpec, 'situation' | 'lines' | 'speakers'>,
  ctx: ConversationAudioContext,
): ResolvedConversationAudio {
  const provider = ctx.provider;
  const prefs = ctx.prefs ?? DEFAULT_CONVERSATION_AUDIO_PREFS;
  const key = conversationAudioKey(ex);
  const pools = provider === 'minimax' ? undefined : providerVoicePools(provider);
  const auto = resolveConversationVoices(ex.speakers, { enabled: ctx.enabled, seed: conversationSeed(ex), pools });
  const n = ex.speakers.length;
  const voices: Array<string | null> = new Array(n).fill(null);
  const chosen: boolean[] = new Array(n).fill(false);
  const used = new Set<string>();
  const valid = (v: unknown): v is string => typeof v === 'string' && conversationVoiceProvider(v) === provider;

  const own = prefs.exercise_voices[exerciseVoicesKey(provider, key)] ?? [];
  for (let i = 0; i < n; i++) {
    const v = own[i];
    if (valid(v) && !used.has(v)) {
      voices[i] = v;
      chosen[i] = true;
      used.add(v);
    }
  }
  const preferred = prefs.voices[provider] ?? {};
  for (const g of ['female', 'male'] as const) {
    const v = preferred[g];
    if (!valid(v) || used.has(v)) continue;
    const i = ex.speakers.findIndex((_, j) => voices[j] === null && speakerGender(ex.speakers, j) === g);
    if (i < 0) continue;
    // Only the FIRST speaker of the gender takes the preference.
    const first = ex.speakers.findIndex((_, j) => speakerGender(ex.speakers, j) === g);
    if (i !== first) continue;
    voices[i] = v;
    chosen[i] = true;
    used.add(v);
  }
  const fallbackPools = pools ?? null;
  for (let i = 0; i < n; i++) {
    if (voices[i] !== null) continue;
    let v = auto[i];
    if (used.has(v)) {
      const g = speakerGender(ex.speakers, i);
      const pool = fallbackPools ? fallbackPools[g] : [];
      const all = [...pool, ...auto, ...(fallbackPools ? [...fallbackPools.female, ...fallbackPools.male] : [])];
      v = all.find((x) => !used.has(x)) ?? v;
    }
    voices[i] = v;
    used.add(v);
  }
  return {
    key,
    provider,
    voices: voices as string[],
    auto_voices: auto,
    chosen,
    speed: clampConversationRate(provider, prefs.speed ?? ctx.default_speed ?? DEFAULT_CONVERSATION_RATE),
    delivery: prefs.delivery ?? 'natural',
  };
}

/**
 * The preference change for "speaker i speaks in `voice`" (null = back to
 * automatic): this conversation's choice, and — for the first speaker of a
 * gender — the learner's preferred voice for that gender, so the choice
 * carries to every conversation. Returns the PARTIAL update to PUT (and to
 * merge locally with mergeConversationAudioPrefs).
 */
export function speakerVoiceUpdate(
  current: ResolvedConversationAudio,
  speakers: ConversationSpeaker[],
  index: number,
  voice: string | null,
  prefs: ConversationAudioPrefs = DEFAULT_CONVERSATION_AUDIO_PREFS,
): Record<string, unknown> {
  const exKey = exerciseVoicesKey(current.provider, current.key);
  const existing = prefs.exercise_voices[exKey] ?? [];
  const list: Array<string | null> = speakers.map((_, i) => existing[i] ?? null);
  list[index] = voice;
  const update: Record<string, unknown> = {
    exercise_voices: { [exKey]: list.some((v) => v !== null) ? list : null },
  };
  const g = speakerGender(speakers, index);
  const first = speakers.findIndex((_, j) => speakerGender(speakers, j) === g);
  if (first === index) update.voices = { [current.provider]: { [g]: voice } };
  return update;
}

/** Every conversation line a lesson plays, in its speaker's voice at the resolved speed / delivery (offline prefetch). */
export function lessonConversationClips(
  spec: { sections: Array<{ exercises: Array<{ type: string }> }> },
  resolve: (ex: ConversationExerciseSpec) => Pick<ResolvedConversationAudio, 'voices' | 'speed' | 'delivery'>,
): Array<{ text: string; voice: string; speed: number; delivery: ConversationDelivery }> {
  const clips: Array<{ text: string; voice: string; speed: number; delivery: ConversationDelivery }> = [];
  for (const section of spec.sections) {
    for (const raw of section.exercises) {
      if (raw.type !== 'conversation') continue;
      const ex = raw as unknown as ConversationExerciseSpec;
      const audio = resolve(ex);
      for (const line of ex.lines) clips.push({ text: line.hanzi, voice: audio.voices[line.speaker], speed: audio.speed, delivery: audio.delivery });
    }
  }
  return clips;
}
