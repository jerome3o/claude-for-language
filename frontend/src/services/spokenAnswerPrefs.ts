/**
 * Settings → Study → "Submit spoken answers automatically" (on by default): when the 🎤 on a
 * typing card has the transcript, it is checked at once like pressing Check; off = it only fills
 * the box and Enter / Check submits it (docs/STUDY_SESSION.md "Say the answer"). Per device, like
 * the Lab app's `StudyPrefs.spokenAutoSubmit`.
 */
const KEY = 'spoken-answer-auto-submit-v1';

export function readSpokenAutoSubmit(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeSpokenAutoSubmit(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: the default stays */
  }
}
