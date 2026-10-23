/**
 * A lesson's free-speaking take (oral_expression / speak, docs/STUDY_SESSION.md "Claude checks your
 * speaking"): recorded while it streams to the live transcriber, like the study card's "Say the
 * answer", but minutes long. These numbers make long takes safe on both apps (Lab port: core
 * `SpeakingTake`, parity-tested through parity/fixtures/lesson-answer-check.ts):
 * - the take stops by itself at SPEAKING_MAX_SECONDS (the worker caps a live session at 420 s);
 * - the live key must outlive the whole take, so it is only reused with that much time left;
 * - the final transcript of a long take may take a moment longer than a card's.
 */
export const SPEAKING_MAX_SECONDS = 300;

/** A cached temporary live key is reused for a speaking take only with this long left. */
export const SPEAKING_LIVE_KEY_MARGIN_MS = (SPEAKING_MAX_SECONDS + 60) * 1000;

/** How long Stop waits for the live stream's final words before uploading the take instead. */
export const SPEAKING_FINISH_TIMEOUT_MS = 8000;

/** What the transcript line says while it isn't text yet. */
export type SpeakingTakePhase = 'recording' | 'transcribing' | 'offline' | 'failed';

export function speakingTakeLine(phase: SpeakingTakePhase): string {
  switch (phase) {
    case 'recording': return 'Listening…';
    case 'transcribing': return 'Writing down what you said…';
    case 'offline': return 'Recording saved — Claude will check it when you’re online.';
    case 'failed': return 'Couldn’t transcribe — tap to retry';
  }
}

/** "1:05" for the timer (seconds → m:ss). */
export function speakingClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
