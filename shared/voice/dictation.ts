/**
 * Voice-first text input (docs/STUDY_SESSION.md "Voice-first text boxes"): the rules every "say it, or type it" box follows —
 * the web's `VoiceTextInput` (frontend/src/components/voice/) and the Lab's `VoiceTextField`
 * (android-lab ui/kit/VoiceTextField.kt; this file is ported to core/…/VoiceDictation.kt and
 * parity-tested via android-lab/parity/fixtures/voice-dictation.ts).
 *
 * The flow is the typing study cards' "Say the answer" (docs/STUDY_SESSION.md), generalised:
 * - `voice` mode (the default): idle = ✏️ Type · wide 🎤 Say it; listening = ✕ Cancel · ⏹ Stop with the
 *   live transcript streaming in; then the REVIEW: what was heard, 🔁 Retry · ✏️ Edit · ✓ Submit —
 *   no keyboard until Edit / Type. A take that gave nothing: ✏️ Type · 🔁 Retry (+ "Couldn't
 *   transcribe — tap to retry" for the same take when the transcriber failed, never silent).
 * - `type` mode: the normal box with a 🎤 to go back to speaking, and Submit.
 * - Speaking unavailable (offline, no microphone, permission denied…) → typing, with a short reason.
 *   Never a dead end. The default is ALWAYS voice (Jerome: "the default should be speaking") —
 *   nothing remembers that he typed last time.
 *
 * Pure: no recorder, no transcriber. The transcription itself is the study cards' controller
 * (frontend/src/services/spokenAnswer.ts; Lab StudyViewModel's spoken answer / VoiceDictationController).
 */

export type DictationMode = 'voice' | 'type';
/** The voice side's phase (the spoken-answer controller's, minus the study card's say-again `editing`). */
export type DictationPhase = 'idle' | 'listening' | 'finishing' | 'review' | 'failed';
/** Why a take gave no text: the transcriber failed / went offline (the same take can be retried) or nothing was heard. */
/** signed_out = the upload got 401 (shared/auth/session.ts: "Signed out — sign in again"; Retry works after signing in). */
export type DictationFailure = 'failed' | 'offline' | 'empty' | 'signed_out';
/** Why speaking is off right now: the box shows typing with this reason. */
export type VoiceBlock = 'offline' | 'denied' | 'no_mic' | 'unsupported' | 'mic_error';

export const VOICE_BLOCKS: readonly VoiceBlock[] = ['offline', 'denied', 'no_mic', 'unsupported', 'mic_error'];

export interface DictationState {
  mode: DictationMode;
  phase: DictationPhase;
  failure: DictationFailure | null;
  /** Speaking is unavailable (typing is shown with `voiceBlockReason(blocked)`). */
  blocked: VoiceBlock | null;
}

/** Where the submitted text came from: said and submitted as heard, said then edited, or typed. */
export type DictationSource = 'spoken' | 'edited' | 'typed';

/**
 * One control in the box's bottom row, left to right. `retry_upload` = the "Couldn't transcribe —
 * tap to retry" box (the same take again); `mic` = the small 🎤 next to the typing box.
 */
export type DictationControl =
  | 'type'
  | 'say'
  | 'cancel'
  | 'stop'
  | 'finishing'
  | 'retake'
  | 'edit'
  | 'submit'
  | 'retry_upload'
  | 'mic'
  | 'submit_typed';

/** The mode a box opens in: voice unless the caller asked for typing or speaking is unavailable. */
export function initialDictationMode(defaultMode: DictationMode | null | undefined, blocked: VoiceBlock | null): DictationMode {
  if (blocked) return 'type';
  return defaultMode === 'type' ? 'type' : 'voice';
}

/** The small 🎤 beside the typing box: hidden while offline / unsupported (the reason says why), shown otherwise. */
export function voiceButtonShown(blocked: VoiceBlock | null): boolean {
  return blocked !== 'offline' && blocked !== 'unsupported';
}

/** What the row shows, left to right. */
export function dictationControls(state: DictationState): DictationControl[] {
  if (state.mode === 'type' || state.blocked) {
    return voiceButtonShown(state.blocked) ? ['mic', 'submit_typed'] : ['submit_typed'];
  }
  switch (state.phase) {
    case 'idle':
      return ['type', 'say'];
    case 'listening':
      return ['cancel', 'stop'];
    case 'finishing':
      return ['cancel', 'finishing'];
    case 'review':
      return ['retake', 'edit', 'submit'];
    case 'failed':
      return state.failure === 'empty' ? ['type', 'retake'] : ['retry_upload', 'type', 'retake'];
  }
}

/**
 * The text a dictated take puts in the box when there was already some (he typed half, then spoke the
 * rest): joined straight on for Chinese, with a space between Latin words; either side empty → the other.
 */
export function joinDictation(existing: string, transcript: string): string {
  const a = existing.trim();
  const b = transcript.trim();
  if (!a) return b;
  if (!b) return a;
  const last = a[a.length - 1];
  const first = b[0];
  const latin = (c: string) => /[A-Za-z0-9À-ɏ]/.test(c);
  return latin(last) && latin(first) ? `${a} ${b}` : `${a}${b}`;
}

/**
 * Where an answer came from: `filled` is what ✏️ Edit put in the box (null = nothing was spoken).
 * Unchanged → spoken (the exercise can be lenient like a spoken study answer), changed → edited.
 */
export function dictationSource(text: string, filled: string | null): DictationSource {
  if (filled == null) return 'typed';
  return text.trim() === filled.trim() ? 'spoken' : 'edited';
}

/** The answer Submit sends, or null when there is nothing to send (Submit disabled). */
export function dictationAnswer(state: DictationState, transcript: string, typed: string, filled: string | null):
  { text: string; source: DictationSource } | null {
  if (state.mode === 'voice' && !state.blocked) {
    if (state.phase !== 'review') return null;
    const text = transcript.trim();
    return text ? { text, source: 'spoken' } : null;
  }
  const text = typed.trim();
  return text ? { text, source: dictationSource(text, filled) } : null;
}

/** A microphone error (DOMException name on the web; the Lab's own kinds) → why speaking is off. */
export function micErrorBlock(name: string | null | undefined): VoiceBlock {
  switch ((name ?? '').trim()) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
    case 'denied':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'no_mic':
      return 'no_mic';
    case 'unsupported':
    case 'NotSupportedError':
      return 'unsupported';
    default:
      return 'mic_error';
  }
}

/** The line under the box when speaking is off. */
export function voiceBlockReason(blocked: VoiceBlock): string {
  switch (blocked) {
    case 'offline':
      return 'Offline — type your answer. Speaking needs a connection.';
    case 'denied':
      return 'Microphone blocked — type your answer, or allow the microphone and tap 🎤.';
    case 'no_mic':
      return 'No microphone found — type your answer.';
    case 'unsupported':
      return 'Speaking isn’t available here — type your answer.';
    case 'mic_error':
      return 'Couldn’t open the microphone — type your answer, or tap 🎤 to try again.';
  }
}

/** The shared words of the box (both apps). */
export const DICTATION_COPY = {
  say: 'Say it',
  type: 'Type',
  cancel: 'Cancel',
  stop: 'Stop',
  finishing: 'Finishing…',
  retake: 'Retry',
  edit: 'Edit',
  submit: 'Submit',
  listening: 'Listening… say it',
  empty: 'Didn’t catch anything — tap Retry to try again, or type it.',
  failed: 'Couldn’t transcribe — tap to retry',
  failedNote: 'Or type your answer',
  offline: 'You went offline — type it, or try again when you’re back online.',
  micLabel: 'Say it instead',
} as const;

/**
 * `voice_input.used` outcome: what happened to one take or one typed answer (enums only — never the text).
 * From the controller's result: submitted / filled (✏️ Edit) / retaken / failed / empty / cancelled;
 * plus `typed` (a typed answer was submitted) and `edited` (an edited transcript was submitted).
 */
export type DictationOutcome = 'submitted' | 'edit' | 'retaken' | 'failed' | 'empty' | 'cancelled' | 'typed' | 'edited';

export function dictationOutcome(result: string): DictationOutcome | null {
  switch (result) {
    case 'submitted':
    case 'retaken':
    case 'failed':
    case 'empty':
    case 'cancelled':
      return result;
    case 'filled':
      return 'edit';
    default:
      return null;
  }
}

/** The outcome of submitting from the typing box: typed, or a transcript that was edited (an unchanged one = submitted). */
export function typedOutcome(source: DictationSource): DictationOutcome {
  return source === 'typed' ? 'typed' : source === 'edited' ? 'edited' : 'submitted';
}

/**
 * Soniox language hints for the box: Chinese first with English allowed (a learner mixes), or
 * English first for an English answer.
 */
export function dictationLanguageHints(lang: 'zh' | 'en' | null | undefined): string[] {
  return lang === 'en' ? ['en', 'zh'] : ['zh', 'en'];
}
