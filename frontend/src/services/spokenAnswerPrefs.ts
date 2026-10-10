/**
 * Settings → Study → "Skip the review — submit spoken answers as soon as I stop" (OFF by default):
 * on, the 🎤 on a typing card checks what was said at once; off, the transcript waits on the review
 * step (🔁 Retry · ✏️ Edit · ✓ Submit; docs/STUDY_SESSION.md "Say the answer"). Per device, like the
 * Lab app's `StudyPrefs.spokenSkipReview`.
 *
 * The key is the old "Submit spoken answers automatically" switch's (same meaning: '1' = checked at
 * once). It was only ever written when someone flipped the switch, so a device that never touched it
 * has no value and gets the new default (the review); a choice made on purpose is kept.
 */
const KEY = 'spoken-answer-auto-submit-v1';

export function readSpokenSkipReview(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSpokenSkipReview(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: the default stays */
  }
}
