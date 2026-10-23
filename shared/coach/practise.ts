/**
 * Sentence Coach "🎤 Practise saying it" (docs/CHAT.md "Chat ↔ Coach"): beside the big sentence of
 * a coach answer (the translation, the corrected sentence, each "Other ways to say it") the learner
 * records himself saying it — tap 🎤, tap again (or Enter, or the card) to stop — and the take is
 * checked against that sentence with the SAME rule as a spoken answer on a typing card:
 * `tidySpokenTranscript` (the recogniser's trailing 。 dropped unless the sentence has one), then
 * `checkSpokenAnswer` (punctuation ignored, homophones count by sound, other tones = close), shown
 * with the compact "You said" row (`spokenResult`, shared/cards/spoken-result.ts) — the characters
 * that differ marked. Nothing is stored: no review event, no recording kept.
 *
 * Lab port: core `CoachPractise.kt`, parity-tested (parity/fixtures/coach.ts → CoachParityTest).
 */
import { checkSpokenAnswer, tidySpokenTranscript, type AnswerVerdict } from '../cards/answer';
import { spokenResult, type SpokenResult, type SpokenResultState } from '../cards/spoken-result';
import type { VoiceBlock } from '../voice/dictation';

/** The follow-up composer's 🎤 (was "Say it" — read as "practise the sentence above"). */
export const COACH_RESPOND_LABEL = 'Respond';
/** The practise button's words (and its accessible name, with the sentence). */
export const COACH_PRACTISE_LABEL = 'Practise saying it';
export const COACH_PRACTISE_STOP = 'Stop';
export const COACH_PRACTISE_AGAIN = 'Try again';
export const COACH_PRACTISE_LISTEN = 'Listen';
export const COACH_PRACTISE_LISTENING = 'Listening… say the sentence';
export const COACH_PRACTISE_CHECKING = 'Checking…';
export const COACH_PRACTISE_OFFLINE = 'Practising needs a connection.';
export const COACH_PRACTISE_EMPTY = 'Didn’t catch that — try again.';

export interface PractisedSentence {
  /** What was said, tidied like a spoken answer (shown in the "You said" row). */
  said: string;
  verdict: AnswerVerdict;
  result: SpokenResult;
}

/** A take of the learner saying `target`, checked like a spoken answer. */
export function practiseSentence(transcript: string, target: string): PractisedSentence {
  const said = tidySpokenTranscript(transcript, target);
  const verdict = checkSpokenAnswer(said, target);
  return { said, verdict, result: spokenResult(said, target, verdict) };
}

/** `coach.practise_say { result }`: the row's state, or why there was none. */
export type PractiseOutcome = SpokenResultState | 'failed' | 'empty';

export function practiseOutcome(p: PractisedSentence | null, failure: 'failed' | 'offline' | 'empty' | null): PractiseOutcome {
  if (p) return p.result.state;
  return failure === 'empty' ? 'empty' : 'failed';
}

/** Why 🎤 can't record right now, in the practise row's words (null = it can). */
export function practiseBlockNote(blocked: VoiceBlock | null): string | null {
  switch (blocked) {
    case 'offline': return COACH_PRACTISE_OFFLINE;
    case 'denied': return 'Microphone blocked — allow the microphone and tap 🎤.';
    case 'no_mic': return 'No microphone found.';
    case 'unsupported': return 'Speaking isn’t available here.';
    case 'mic_error': return 'Couldn’t open the microphone — tap 🎤 to try again.';
    default: return null;
  }
}

/** 🎤 stays tappable unless recording can't work at all (offline, no recorder). */
export function practiseMicEnabled(blocked: VoiceBlock | null): boolean {
  return blocked !== 'offline' && blocked !== 'unsupported';
}
