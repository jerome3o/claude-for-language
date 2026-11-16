/**
 * The take lock (docs/STUDY_SESSION.md "While a take is recording"): while a voice take is recording,
 * nothing on the screen may advance, submit, rate, close or navigate.
 *
 * Jerome kept starting a 🎤 take, then tapping what he thought ended it — but it was the screen's Next /
 * Continue / Submit / rating button sitting in the same place, so the app moved on and the take was lost.
 * The rule everywhere a take can be made:
 *
 * - while it RECORDS, the primary action in the footer becomes a red "■ Stop recording" in the same place,
 *   ratings and other advancing buttons are disabled, and back / ✕ / swipe stop the take instead of leaving;
 * - while the stopped take is being CHECKED (transcribed, judged), those controls stay held — a tap does
 *   nothing — until the result shows; then everything comes back as usual.
 *
 * It generalises the two places that already did this: the sentence rows' pinned bar (`sentenceStopBar`,
 * shared/study/sentencePractise.ts) and the graded reader's read-aloud lock (`readAloudLocksPage`,
 * shared/reader/readAloud.ts) — both now answer from here.
 *
 * Each app keeps ONE registry of the takes on screen (web `services/takeLock.ts`, Lab `ui/kit/TakeLock.kt`):
 * every recorder reports its phase, the screen reads the merged phase. Lab port: core `voice/TakeLock.kt`,
 * parity-tested (android-lab/parity/fixtures/take-lock.ts).
 */

/** idle = nothing under way; recording = the microphone is open; checking = stopped, being transcribed / judged. */
export type TakeLockPhase = 'idle' | 'recording' | 'checking';

/**
 * Any recorder's own phase → the lock's. The dictation / spoken-answer / read-aloud phases
 * (`listening`, `finishing`), the recorders' (`recording`, `starting`) and the checks' (`checking`,
 * `transcribing`) all map here; anything else (idle, review, editing, failed, done, '') is idle.
 */
export function takeLockPhase(phase: string | null | undefined): TakeLockPhase {
  switch ((phase ?? '').trim()) {
    case 'listening':
    case 'recording':
    case 'starting':
      return 'recording';
    case 'finishing':
    case 'checking':
    case 'transcribing':
      return 'checking';
    default:
      return 'idle';
  }
}

/** Several takes on one screen: recording wins over checking, checking over idle. */
export function mergeTakePhases(phases: Iterable<string | null | undefined>): TakeLockPhase {
  let out: TakeLockPhase = 'idle';
  for (const p of phases) {
    const lock = takeLockPhase(p);
    if (lock === 'recording') return 'recording';
    if (lock === 'checking') out = 'checking';
  }
  return out;
}

/** The screen is locked around a take (recording, or stopped and being checked). */
export function takeLocked(phase: string | null | undefined): boolean {
  return takeLockPhase(phase) !== 'idle';
}

/**
 * What sits where the footer's primary action was: 'stop' = the red "■ Stop recording" while recording,
 * 'checking' = a held "Checking what you said…" while the take is judged, null = the footer as usual.
 */
export function takeFooter(phase: string | null | undefined): 'stop' | 'checking' | null {
  const lock = takeLockPhase(phase);
  return lock === 'recording' ? 'stop' : lock === 'checking' ? 'checking' : null;
}

/**
 * What a tap on an advancing control (Next, Continue, Check, Submit, a rating, Got it, Finish, ✕, back,
 * Cancel on a sheet, Skip …) does: 'run' it as usual, 'stop' the take instead (and do nothing else), or
 * 'wait' — do nothing while the stopped take is checked.
 */
export type TakeGuard = 'run' | 'stop' | 'wait';

export function takeGuard(phase: string | null | undefined): TakeGuard {
  const lock = takeLockPhase(phase);
  return lock === 'recording' ? 'stop' : lock === 'checking' ? 'wait' : 'run';
}

/** The footer button's words (the reader's and the sentence rows' bar say the same). */
export const TAKE_STOP_RECORDING = 'Stop recording';
export const TAKE_CHECKING = 'Checking what you said…';
/** Under a disabled control while recording (screen readers / a tooltip). */
export const TAKE_LOCKED_HINT = 'Stop the recording first';
