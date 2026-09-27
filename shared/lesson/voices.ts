/**
 * TTS voices for conversation exercises.
 *
 * A conversation is only a listening exercise if the learner can tell the
 * speakers apart, so every speaker gets a DIFFERENT MiniMax voice. Specs say
 * only "female" / "male" (or nothing); this module turns that into concrete
 * voice ids deterministically, so the device that prefetches the clips and
 * the device that plays them agree on the cache keys.
 *
 * The worker's /api/practice/tts accepts only ids from LESSON_VOICE_IDS, so a
 * spec can never make it call MiniMax with an arbitrary voice.
 */

import type { ConversationSpeaker, LessonVoice } from './types';

/** The app's default voice (Radio Host — Jerome's pick for clarity). Kept in
 * sync with DEFAULT_MINIMAX_VOICE in the worker and frontend. */
export const DEFAULT_LESSON_VOICE = 'Chinese (Mandarin)_Radio_Host';

/** Voice pools, clearest first. Radio Host (the default voice used by every
 * other exercise) is deliberately absent so conversations sound different
 * from the rest of the lesson. */
export const LESSON_VOICE_POOLS: Record<LessonVoice, string[]> = {
  female: [
    'Chinese (Mandarin)_Wise_Women',
    'Chinese (Mandarin)_Warm_Bestie',
    'Chinese (Mandarin)_Sweet_Lady',
  ],
  male: [
    'Chinese (Mandarin)_Gentleman',
    'Chinese (Mandarin)_Sincere_Adult',
    'Chinese (Mandarin)_Male_Announcer',
  ],
};

/** Every voice id a lesson may ask the TTS endpoint for. */
export const LESSON_VOICE_IDS: ReadonlySet<string> = new Set([
  DEFAULT_LESSON_VOICE,
  ...LESSON_VOICE_POOLS.female,
  ...LESSON_VOICE_POOLS.male,
]);

/** Default gender by speaker position when the spec leaves it out:
 * alternate so a two-person dialogue is always one female, one male voice. */
function defaultVoice(index: number): LessonVoice {
  return index % 2 === 0 ? 'female' : 'male';
}

/**
 * A distinct voice id per speaker, in speaker order. Two speakers of the same
 * gender get different voices from that gender's pool.
 */
export function resolveConversationVoices(speakers: ConversationSpeaker[]): string[] {
  const used: Record<LessonVoice, number> = { female: 0, male: 0 };
  return speakers.map((speaker, i) => {
    const gender: LessonVoice = speaker.voice === 'male' || speaker.voice === 'female' ? speaker.voice : defaultVoice(i);
    const pool = LESSON_VOICE_POOLS[gender];
    const id = pool[used[gender] % pool.length];
    used[gender]++;
    return id;
  });
}
