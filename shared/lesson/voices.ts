/**
 * TTS voices for conversation exercises.
 *
 * A conversation is only a listening exercise if the learner can tell the
 * speakers apart, so every speaker gets a DIFFERENT MiniMax voice. Specs say
 * only "female" / "male" (or nothing); this module turns that into concrete
 * voice ids deterministically, so the device that prefetches the clips and
 * the device that plays them agree on the cache keys.
 *
 * Which voices may be used is curated per account (Settings → Conversation
 * voices, `/api/conversation-voices`): the catalogue below lists every
 * candidate with the attributes the settings page filters on, `default_on`
 * is the app's shipped selection, and the admin's own selection is the
 * default for everyone who hasn't customised theirs.
 *
 * The worker's /api/practice/tts accepts only ids from LESSON_VOICE_IDS, so a
 * spec can never make it call MiniMax with an arbitrary voice.
 */

import type { ConversationExerciseSpec, ConversationSpeaker, LessonVoice } from './types';

/** The app's default voice (Radio Host — Jerome's pick for clarity). Kept in
 * sync with DEFAULT_MINIMAX_VOICE in the worker and frontend. */
export const DEFAULT_LESSON_VOICE = 'Chinese (Mandarin)_Radio_Host';

/** Speaking rate for conversation lines, relative to MiniMax's natural 1.0.
 * Conversations are a listening exercise at close to real pace; every other
 * lesson clip keeps the app-wide slow default (0.6). Baked into the audio at
 * TTS time and part of the clip's cache key, so a change here regenerates
 * clips lazily (on the next prefetch or play). */
export const CONVERSATION_TTS_SPEED = 0.9;

/** Pause between two lines when a conversation plays through: a natural
 * turn-taking beat, not a wait. */
export const CONVERSATION_LINE_GAP_MS = 200;

export type VoiceAge = 'child' | 'young' | 'adult' | 'senior';
export type VoiceAccent = 'standard' | 'southern' | 'hong_kong';
/** How the voice sounds. Only newsreader / neutral / warm voices ship on;
 * youthful, soft and character voices are off by default. */
export type VoiceStyle = 'newsreader' | 'neutral' | 'warm' | 'youthful' | 'soft' | 'character';
/** MiniMax's two system-voice series: the named "Chinese (Mandarin)_…"
 * voices and the older classic ids (presenter_…, audiobook_…, female-…). */
export type VoiceFamily = 'mandarin' | 'classic';

export interface ConversationVoice {
  id: string;
  name: string;
  gender: LessonVoice;
  age: VoiceAge;
  accent: VoiceAccent;
  style: VoiceStyle;
  family: VoiceFamily;
  /** On in the app's shipped selection. */
  default_on: boolean;
  /** Why it is on / off by default, shown under the name. */
  note: string;
}

const M = 'Chinese (Mandarin)_';

function v(
  id: string, name: string, gender: LessonVoice, age: VoiceAge, style: VoiceStyle,
  default_on: boolean, note: string, accent: VoiceAccent = 'standard',
): ConversationVoice {
  return { id, name, gender, age, accent, style, family: id.startsWith(M) ? 'mandarin' : 'classic', default_on, note };
}

/** Every voice a conversation may be spoken in, female first, clearest first.
 * MiniMax publishes an id and a name per system voice; gender, age, accent and
 * style are our reading of the name (and the sample), for filtering. */
export const CONVERSATION_VOICES: readonly ConversationVoice[] = [
  // ---- female ----
  v(`${M}News_Anchor`, 'News Anchor', 'female', 'adult', 'newsreader', true, 'Newsreader — crisp, neutral standard Mandarin'),
  v('presenter_female', 'Presenter (female)', 'female', 'adult', 'newsreader', true, 'TV host — clear and neutral'),
  v('audiobook_female_1', 'Audiobook narrator (female)', 'female', 'adult', 'neutral', true, 'Narrator — even, unhurried, teacher-like'),
  v(`${M}Kind-hearted_Antie`, 'Kind-hearted Auntie', 'female', 'adult', 'warm', true, 'Friendly middle-aged woman — good for shopkeepers, neighbours'),
  v(`${M}Wise_Women`, 'Wise Woman', 'female', 'adult', 'soft', false, 'Soft, intimate delivery — was in almost every conversation so far'),
  v(`${M}IntellectualGirl`, 'Intellectual Girl', 'female', 'young', 'youthful', false, 'Young and polished — listen before turning on'),
  v(`${M}Sweet_Lady`, 'Sweet Lady', 'female', 'adult', 'soft', false, 'Breathy, “sweet” delivery — not for lessons'),
  v(`${M}Warm_Bestie`, 'Warm Bestie', 'female', 'young', 'soft', false, 'Breathy, intimate “bestie” register — not for lessons'),
  v(`${M}Soft_Girl`, 'Soft Girl', 'female', 'young', 'soft', false, 'Whispery, soft — hard to hear, not for lessons'),
  v(`${M}Warm_Girl`, 'Warm Girl', 'female', 'young', 'youthful', false, 'Young, cutesy register'),
  v(`${M}Crisp_Girl`, 'Crisp Girl', 'female', 'young', 'youthful', false, 'Teenage girl'),
  v(`${M}Cute_Spirit`, 'Cute Spirit', 'female', 'child', 'character', false, 'Cartoon character voice'),
  v(`${M}Lyrical_Voice`, 'Lyrical Voice', 'female', 'adult', 'character', false, 'Sing-song, lyrical — a performance voice'),
  v(`${M}Mature_Woman`, 'Mature Woman', 'female', 'adult', 'soft', false, 'Low, “mature” register — listen before turning on'),
  v(`${M}HK_Flight_Attendant`, 'HK Flight Attendant', 'female', 'adult', 'neutral', false, 'Hong Kong accent', 'hong_kong'),
  v(`${M}Arrogant_Miss`, 'Arrogant Miss', 'female', 'young', 'character', false, 'Role-play character voice'),
  v('female-chengshu', 'Mature woman (classic)', 'female', 'adult', 'soft', false, 'Low, “mature” register — listen before turning on'),
  v('female-yujie', 'Big sister “yujie” (classic)', 'female', 'adult', 'character', false, '御姐 role-play archetype — sultry, not for lessons'),
  v('female-shaonv', 'Young girl (classic)', 'female', 'young', 'youthful', false, 'Teenage girl'),
  v('female-tianmei', 'Sweet woman (classic)', 'female', 'young', 'soft', false, 'Breathy, “sweet” delivery — not for lessons'),
  // ---- male ----
  v(`${M}Male_Announcer`, 'Male Announcer', 'male', 'adult', 'newsreader', true, 'Announcer — crisp, neutral standard Mandarin'),
  v('presenter_male', 'Presenter (male)', 'male', 'adult', 'newsreader', true, 'TV host — clear and neutral'),
  v(`${M}Gentleman`, 'Gentleman', 'male', 'adult', 'neutral', true, 'Formal, clear adult man'),
  v(`${M}Sincere_Adult`, 'Sincere Adult', 'male', 'adult', 'neutral', true, 'Plain, friendly adult man'),
  v('audiobook_male_1', 'Audiobook narrator (male)', 'male', 'adult', 'neutral', true, 'Narrator — even, unhurried, teacher-like'),
  v(`${M}Gentle_Youth`, 'Gentle Youth', 'male', 'young', 'neutral', true, 'Calm young man — good for students, colleagues'),
  v(`${M}Radio_Host`, 'Radio Host', 'male', 'adult', 'newsreader', false, 'The app’s voice for every other clip — off so conversations sound different'),
  v(`${M}Reliable_Executive`, 'Reliable Executive', 'male', 'adult', 'neutral', false, 'Steady, businesslike — listen before turning on'),
  v('male-qn-jingying', 'Young professional (classic)', 'male', 'young', 'neutral', false, 'Listen before turning on'),
  v('male-qn-daxuesheng', 'University student (classic)', 'male', 'young', 'youthful', false, 'Listen before turning on'),
  v(`${M}Kind-hearted_Elder`, 'Kind-hearted Elder', 'male', 'senior', 'warm', false, 'Grandfatherly — turn on for older speakers'),
  v(`${M}Gentle_Senior`, 'Gentle Senior', 'male', 'senior', 'warm', false, 'Older, slower speaker'),
  v(`${M}Humorous_Elder`, 'Humorous Elder', 'male', 'senior', 'character', false, 'Comic character voice'),
  v(`${M}Southern_Young_Man`, 'Southern Young Man', 'male', 'young', 'neutral', false, 'Southern accent', 'southern'),
  v(`${M}Unrestrained_Young_Man`, 'Unrestrained Young Man', 'male', 'young', 'character', false, 'Role-play character voice'),
  v(`${M}Stubborn_Friend`, 'Stubborn Friend', 'male', 'young', 'character', false, 'Role-play character voice'),
  v(`${M}Straightforward_Boy`, 'Straightforward Boy', 'male', 'child', 'youthful', false, 'Boy'),
  v(`${M}Pure-hearted_Boy`, 'Pure-hearted Boy', 'male', 'child', 'youthful', false, 'Boy'),
  v('male-qn-qingse', 'Shy young man (classic)', 'male', 'young', 'character', false, 'Role-play character voice'),
  v('male-qn-badao', 'Domineering young man (classic)', 'male', 'young', 'character', false, 'Role-play character voice'),
];

const BY_ID = new Map(CONVERSATION_VOICES.map(voice => [voice.id, voice]));

export function conversationVoice(id: string): ConversationVoice | undefined {
  return BY_ID.get(id);
}

/** The app's shipped selection, in catalogue order. */
export const DEFAULT_CONVERSATION_VOICE_IDS: readonly string[] = CONVERSATION_VOICES.filter(x => x.default_on).map(x => x.id);

/** Every voice id a lesson may ask the TTS endpoint for. */
export const LESSON_VOICE_IDS: ReadonlySet<string> = new Set([
  DEFAULT_LESSON_VOICE,
  ...CONVERSATION_VOICES.map(x => x.id),
]);

/** The shipped pools by gender (catalogue order). */
export const LESSON_VOICE_POOLS: Record<LessonVoice, string[]> = conversationVoicePools(null);

/**
 * The enabled voices by gender, in catalogue order. Unknown ids are dropped;
 * a missing selection, or one with fewer than two usable voices (a
 * conversation needs two distinct voices), falls back to the shipped defaults.
 */
export function conversationVoicePools(enabled?: readonly string[] | null): Record<LessonVoice, string[]> {
  const on = new Set(enabled ?? []);
  let usable = CONVERSATION_VOICES.filter(x => on.has(x.id));
  if (usable.length < 2) usable = CONVERSATION_VOICES.filter(x => x.default_on);
  return {
    female: usable.filter(x => x.gender === 'female').map(x => x.id),
    male: usable.filter(x => x.gender === 'male').map(x => x.id),
  };
}

/**
 * Checks a selection sent to `PUT /api/conversation-voices`: an array of known
 * ids with at least one female and one male voice on. Returns the cleaned
 * list (deduplicated, catalogue order) and any problems.
 */
export function validateConversationVoiceSelection(input: unknown): { enabled: string[]; problems: string[] } {
  if (!Array.isArray(input)) return { enabled: [], problems: ['"enabled" must be an array of voice ids'] };
  const problems: string[] = [];
  const on = new Set<string>();
  for (const id of input) {
    if (typeof id !== 'string' || !BY_ID.has(id)) {
      problems.push(`Unknown voice: ${typeof id === 'string' ? id : JSON.stringify(id)}`);
      continue;
    }
    on.add(id);
  }
  const enabled = CONVERSATION_VOICES.filter(x => on.has(x.id)).map(x => x.id);
  const pick = (g: LessonVoice) => enabled.some(id => BY_ID.get(id)!.gender === g);
  if (!pick('female')) problems.push('Keep at least one female voice on');
  if (!pick('male')) problems.push('Keep at least one male voice on');
  return { enabled, problems };
}

/** A stable number for one conversation (djb2 over its situation and lines),
 * so voices rotate between dialogues but a dialogue always gets the same pair. */
export function conversationSeed(ex: Pick<ConversationExerciseSpec, 'situation' | 'lines'>): number {
  const input = [ex.situation, ...ex.lines.map(l => l.hanzi)].join('\n');
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = (hash * 33 + input.charCodeAt(i)) % 4294967296;
  return hash;
}

/** Default gender by speaker position when the spec leaves it out:
 * alternate so a two-person dialogue is always one female, one male voice. */
export function speakerGender(speakers: ConversationSpeaker[], index: number): LessonVoice {
  const voice = speakers[index]?.voice;
  return voice === 'male' || voice === 'female' ? voice : index % 2 === 0 ? 'female' : 'male';
}

export interface ResolveVoicesOptions {
  /** The account's enabled voices (null / undefined = shipped defaults). */
  enabled?: readonly string[] | null;
  /** Rotation seed (conversationSeed); 0 = start of each pool. */
  seed?: number;
}

/**
 * A distinct voice id per speaker, in speaker order, from the enabled pool.
 * Each gender's pool is entered at a seed-dependent offset (random-looking
 * rotation, deterministic per dialogue). When a gender has no enabled voice
 * the other gender's pool stands in (two different voices of it); a voice is
 * reused only when there are more speakers than enabled voices.
 */
export function resolveConversationVoices(speakers: ConversationSpeaker[], options: ResolveVoicesOptions = {}): string[] {
  const pools = conversationVoicePools(options.enabled);
  const seed = Math.max(0, Math.floor(options.seed ?? 0));
  const all = [...pools.female, ...pools.male];
  const used = new Set<string>();
  const count: Record<LessonVoice, number> = { female: 0, male: 0 };
  return speakers.map((_, i) => {
    const gender = speakerGender(speakers, i);
    const own = pools[gender];
    const pool = own.length ? own : pools[gender === 'female' ? 'male' : 'female'];
    // Different digits of the seed for each gender, so the pair varies too.
    const offset = (gender === 'male' ? Math.floor(seed / 97) : seed) % pool.length;
    const n = count[gender]++;
    let id: string | undefined;
    for (let k = 0; k < pool.length && !id; k++) {
      const candidate = pool[(offset + n + k) % pool.length];
      if (!used.has(candidate)) id = candidate;
    }
    for (let k = 0; k < all.length && !id; k++) {
      const candidate = all[(seed + k) % all.length];
      if (!used.has(candidate)) id = candidate;
    }
    id ??= pool[(offset + n) % pool.length];
    used.add(id);
    return id;
  });
}

/** The voices one conversation exercise plays in, for this account's selection. */
export function conversationVoicesFor(
  ex: Pick<ConversationExerciseSpec, 'situation' | 'lines' | 'speakers'>,
  enabled?: readonly string[] | null,
): string[] {
  return resolveConversationVoices(ex.speakers, { enabled, seed: conversationSeed(ex) });
}

/** The line every voice sample says (Settings → Conversation voices). */
export const VOICE_SAMPLE_TEXT = '你好！请问，去火车站怎么走？';
