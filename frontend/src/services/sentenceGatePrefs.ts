/**
 * Settings → Study → "Get two sentences right before Good / Easy" (OFF by default, per device like
 * the other study switches; Lab `StudyPrefs.sentenceGate`). On, the reading and meaning cards keep
 * Good and Easy disabled until two example sentences were said right with the rows' 🎤 on this
 * showing of the card (shared/study/sentencePractise.ts `sentenceGate`; docs/STUDY_SESSION.md).
 */
const KEY = 'sentence-gate-v1';

export function readSentenceGateOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSentenceGateOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: the default stays */
  }
}
