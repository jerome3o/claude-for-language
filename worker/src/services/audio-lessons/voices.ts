/**
 * Who speaks in an audio lesson, per TTS provider (docs/AUDIO_LESSONS.md "Voices").
 *
 * Chinese goes through the admin's STORED order (MiniMax → Azure today), and the
 * first provider that speaks a lesson's first Chinese clip is PINNED for the rest
 * of it, so one lesson never mixes two providers' voices. English (format A's
 * host) uses Azure, then Google — MiniMax's voices are Chinese voices.
 *
 * The two dialogue speakers get two different voices even when they share a
 * gender (a second voice of that gender), so the dialogue is always two people.
 */
import type { Gender, ScriptSpeaker, VoiceRole } from '@shared/audio-lesson';
import type { TtsConfig, TtsProviderId } from '@shared/tts';

export interface RoleVoice {
  voice: string;
  /** SSML language for Azure (and Google's languageCode comes from the voice name). */
  lang: string;
  /** Azure speaking style. */
  style?: string;
}

/** Two voices per gender: [first speaker of that gender, second]. */
const SPEAKER_VOICES: Record<TtsProviderId, Record<Gender, [string, string]>> = {
  minimax: {
    female: ['Chinese (Mandarin)_News_Anchor', 'presenter_female'],
    male: ['Chinese (Mandarin)_Male_Announcer', 'presenter_male'],
  },
  azure: {
    female: ['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaochenNeural'],
    male: ['zh-CN-YunxiNeural', 'zh-CN-YunjianNeural'],
  },
  google: {
    female: ['cmn-CN-Wavenet-A', 'cmn-CN-Wavenet-C'],
    male: ['cmn-CN-Wavenet-B', 'cmn-CN-Wavenet-D'],
  },
};

/** The calm voice of sleep lessons. */
const SLEEP_VOICES: Record<TtsProviderId, RoleVoice> = {
  minimax: { voice: 'audiobook_female_1', lang: 'zh-CN' },
  azure: { voice: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', style: 'gentle' },
  google: { voice: 'cmn-CN-Wavenet-A', lang: 'cmn-CN' },
};

/** The English host, in provider order. */
export const ENGLISH_ORDER: readonly TtsProviderId[] = ['azure', 'google'];
const NARRATOR_VOICES: Partial<Record<TtsProviderId, RoleVoice>> = {
  azure: { voice: 'en-US-AndrewNeural', lang: 'en-US' },
  google: { voice: 'en-US-Neural2-D', lang: 'en-US' },
};

/** The voice for `role` with `provider`; null = this provider does not speak this role (English on MiniMax). */
export function roleVoice(provider: TtsProviderId, role: VoiceRole, speakers: ScriptSpeaker[], config: TtsConfig): RoleVoice | null {
  if (role === 'narrator') return NARRATOR_VOICES[provider] ?? null;
  if (role === 'sleep') return SLEEP_VOICES[provider];
  if (role === 'teacher') return { voice: config.providers[provider].voices.default, lang: provider === 'google' ? 'cmn-CN' : 'zh-CN' };
  const me = speakers.find((s) => s.role === role);
  const gender: Gender = me?.gender ?? (role === 'speaker_a' ? 'male' : 'female');
  const other = speakers.find((s) => s.role !== role);
  // The second speaker of a gender takes that gender's second voice.
  const second = !!other && other.gender === gender && role === 'speaker_b';
  return { voice: SPEAKER_VOICES[provider][gender][second ? 1 : 0], lang: provider === 'google' ? 'cmn-CN' : 'zh-CN' };
}
