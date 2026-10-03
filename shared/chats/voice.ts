/**
 * Which voice reads a chat message aloud.
 *
 * Every chat read-aloud (the message menu's "Read aloud" on the web and in
 * the Lab app) goes through the same MiniMax TTS and the same account voice
 * selection as the lesson exercises (Settings → Conversation voices,
 * shared/lesson/voices.ts) — never a device default and never the legacy
 * `conversations.voice_id` column (its DEFAULT 'female-yujie' is a sultry
 * role-play voice that every human chat used to read in).
 *
 * The voice follows the SENDER's `users.voice_gender` (Profile → "Your voice
 * when your messages are read aloud"):
 *   male   → the listener's first enabled male conversation voice
 *   female → the listener's first enabled female conversation voice
 *   other / not set → the app's voice (DEFAULT_LESSON_VOICE, the one every
 *            card and word clip is spoken in)
 * The pools are in catalogue order (clearest first), so a listener who turned
 * a family or style off never hears it here either. Claude's lines in a
 * role-play chat keep the persona voice picked in that chat's Voice settings.
 *
 * Ported to the Lab app (`core/…/ChatVoice.kt`, parity-tested).
 */
import { DEFAULT_LESSON_VOICE, LESSON_VOICE_IDS, conversationVoicePools } from '../lesson/voices';

export type VoiceGender = 'male' | 'female' | 'other';

export const VOICE_GENDERS: readonly VoiceGender[] = ['male', 'female', 'other'];

/** The Profile choice, in display order (null = not set). */
export const VOICE_GENDER_OPTIONS: ReadonlyArray<{ value: VoiceGender | null; label: string }> = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: null, label: 'Not set' },
];

/** Heading + hint for the Profile row (web + Lab). */
export const VOICE_GENDER_TITLE = 'Your voice when your messages are read aloud';
export const VOICE_GENDER_HINT = 'Male or Female picks a matching voice from the listener’s conversation voices; Other or Not set uses the app’s usual voice.';

/** A stored / sent value → a known gender or null (anything else = not set). */
export function parseVoiceGender(v: unknown): VoiceGender | null {
  return v === 'male' || v === 'female' || v === 'other' ? v : null;
}

/** Validate a request body value: undefined = leave alone, null / '' = clear. */
export function pickVoiceGender(v: unknown): { value?: VoiceGender | null; problem?: string } {
  if (v === undefined) return {};
  if (v === null || v === '') return { value: null };
  const g = parseVoiceGender(v);
  return g ? { value: g } : { problem: 'voice_gender must be male, female, other or null' };
}

/** Read-aloud speed for chat messages: the card clips' slow default. */
export const CHAT_READ_ALOUD_SPEED = 0.6;

export interface ChatVoiceInput {
  /** The sender's users.voice_gender. */
  senderGender: VoiceGender | null | undefined;
  /** The LISTENER's enabled conversation voices (null = the shipped defaults). */
  enabled?: readonly string[] | null;
  /** The message is Claude's line in a role-play chat. */
  fromAi?: boolean;
  /** That chat's persona voice (conversations.voice_id; only used for Claude's lines). */
  personaVoice?: string | null;
}

/** The MiniMax voice id one chat message is read in. */
export function chatReadAloudVoice(input: ChatVoiceInput): string {
  if (input.fromAi && input.personaVoice && LESSON_VOICE_IDS.has(input.personaVoice)) return input.personaVoice;
  const pools = conversationVoicePools(input.enabled);
  const g = parseVoiceGender(input.senderGender);
  if (g === 'male') return pools.male[0] ?? DEFAULT_LESSON_VOICE;
  if (g === 'female') return pools.female[0] ?? DEFAULT_LESSON_VOICE;
  return DEFAULT_LESSON_VOICE;
}

/** Speed for one chat message: a role-play chat's own setting for Claude's lines, else the card speed. */
export function chatReadAloudSpeed(input: { fromAi?: boolean; personaSpeed?: number | null }): number {
  const s = input.personaSpeed;
  if (input.fromAi && typeof s === 'number' && Number.isFinite(s) && s >= 0.5 && s <= 2) return s;
  return CHAT_READ_ALOUD_SPEED;
}
