/**
 * The take lock: while a voice take is RECORDING, nothing on screen may move the learner on.
 *
 * Jerome (Nov 2026, a mini lesson): "It'll start recording me and then I'll go to click what I think is the correct
 * button to finish the recording, which is actually the next button, and it just skips through the next thing … make
 * the next button become the stop recording button when it's in recording mode." He hit it on more than one exercise
 * type, so it is ONE rule for every screen that records and has a primary action (Check / Next / Continue / Done /
 * Skip):
 *
 * - **recording** → the primary action becomes the big red "■ Stop recording" (same place, same size); it can never
 *   advance or submit — tapping it stops the take (which is then checked as before).
 * - **checking** (the take stopped and is being transcribed / judged) → a quiet "Checking what you said…" there,
 *   not tappable; it lasts a moment.
 * - **idle** → the primary action as it was.
 * - Back / ✕ while recording stops the take first (the screen stays); while checking or idle they leave as before.
 *
 * Stopping a take is INTENTIONAL (the study sentence rows' rule, `sentenceStopBar` in shared/study/sentencePractise.ts;
 * the reader's `readAloudLocksPage`): a tap elsewhere never stops it, never acts as something else either.
 *
 * Used by the mini-lesson player on both apps (web components/voice/TakeLock.tsx, Lab ui/kit/TakeLock.kt; core
 * `TakeLock.kt` parity-tested by parity/fixtures/take-lock.ts). Neutral on purpose: any other surface that records can
 * report its takes into the same lock.
 */

/** Where a take stands: none / the mic open / stopped and being transcribed or checked. */
export type TakePhase = 'idle' | 'recording' | 'checking';

export const TAKE_PHASES: readonly TakePhase[] = ['idle', 'recording', 'checking'];

/** One take's phase from its recorder's flags (recording wins). */
export function takePhase(recording: boolean, checking: boolean): TakePhase {
  if (recording) return 'recording';
  return checking ? 'checking' : 'idle';
}

/** Several takes on one screen (a question box + a 🎤 Say it again row…): recording > checking > idle. */
export function combineTakePhases(phases: Iterable<TakePhase>): TakePhase {
  let out: TakePhase = 'idle';
  for (const p of phases) {
    if (p === 'recording') return 'recording';
    if (p === 'checking') out = 'checking';
  }
  return out;
}

/** What the screen's primary action shows: itself, "■ Stop recording", or "Checking what you said…". */
export type TakeLockFooter = 'proceed' | 'stop' | 'checking';

export function takeLockFooter(phase: TakePhase): TakeLockFooter {
  if (phase === 'recording') return 'stop';
  return phase === 'checking' ? 'checking' : 'proceed';
}

/** May the screen move on (advance, submit, skip) right now? Only with no take under way. */
export function takeLockMayProceed(phase: TakePhase): boolean {
  return phase === 'idle';
}

/** Back / ✕: leave, or stop the take first (the screen stays; another back then leaves). */
export type TakeLockLeave = 'leave' | 'stop_take';

export function takeLockLeave(phase: TakePhase): TakeLockLeave {
  return phase === 'recording' ? 'stop_take' : 'leave';
}

/** The footer's words (the same as the study sentence rows' pinned bar). */
export const TAKE_LOCK_STOP = 'Stop recording';
export const TAKE_LOCK_CHECKING = 'Checking what you said…';
