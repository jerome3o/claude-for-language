/**
 * Conversation audio on this device (docs/AUDIO.md "Conversation audio"): the
 * account's preferences + which provider speaks clips now, cached from
 * `/api/auth/me` so a conversation resolves the same voices / speed / delivery
 * — and so the same cached clips — offline. The ⚙︎ Audio menu writes here
 * at once and PUTs the change.
 */
import {
  DEFAULT_CONVERSATION_AUDIO_PREFS,
  mergeConversationAudioPrefs,
  resolveConversationAudio,
  type ConversationAudioPrefs,
  type ConversationExerciseSpec,
  type ResolvedConversationAudio,
} from '@shared/lesson';
import { TTS_PROVIDERS, DEFAULT_TTS_CONFIG } from '@shared/tts';
import type { ConversationAudioState } from '../types';
import { readConversationVoices } from './conversationVoices';

const KEY = 'conversationAudio';
const listeners = new Set<() => void>();

const FALLBACK: ConversationAudioState = {
  prefs: DEFAULT_CONVERSATION_AUDIO_PREFS,
  // Before the server has said anything: MiniMax's defaults.
  provider: 'minimax',
  default_speed: DEFAULT_TTS_CONFIG.providers.minimax.conversation_rate,
};

export function readConversationAudio(): ConversationAudioState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return FALLBACK;
    const parsed = JSON.parse(raw) as Partial<ConversationAudioState>;
    const provider = (TTS_PROVIDERS as readonly string[]).includes(parsed.provider as string) ? parsed.provider! : FALLBACK.provider;
    const prefs = mergeConversationAudioPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS, parsed.prefs ?? {}).prefs;
    const default_speed = typeof parsed.default_speed === 'number' ? parsed.default_speed : DEFAULT_TTS_CONFIG.providers[provider].conversation_rate;
    return { prefs, provider, default_speed, provider_name: parsed.provider_name };
  } catch {
    return FALLBACK;
  }
}

export function writeConversationAudio(state: ConversationAudioState | null | undefined): void {
  if (!state || !state.prefs || !state.provider) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

/** Apply a partial update locally (the same merge as the server), returning the new state. */
export function applyConversationAudioUpdate(update: Record<string, unknown>): ConversationAudioState {
  const current = readConversationAudio();
  const { prefs } = mergeConversationAudioPrefs(current.prefs, update);
  const next = { ...current, prefs };
  writeConversationAudio(next);
  return next;
}

export function onConversationAudioChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function currentConversationPrefs(): ConversationAudioPrefs {
  return readConversationAudio().prefs;
}

/** The voices, speed and delivery one conversation plays in on this device. */
export function audioForConversation(ex: Pick<ConversationExerciseSpec, 'situation' | 'lines' | 'speakers'>): ResolvedConversationAudio {
  const state = readConversationAudio();
  return resolveConversationAudio(ex, {
    provider: state.provider,
    default_speed: state.default_speed,
    enabled: readConversationVoices(),
    prefs: state.prefs,
  });
}
