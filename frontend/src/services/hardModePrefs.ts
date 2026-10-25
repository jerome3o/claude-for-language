/**
 * Hard mode (shared/study/hardMode.ts; docs/STUDY_SESSION.md "Hard mode"): Off · Red cards only · All
 * cards, per device like the other study switches (Lab `StudyPrefs.hardMode`). Switched from the study
 * session's header chip or Settings → Study; both read `useHardMode`, so a change shows at once.
 *
 * Stored under the key of the switch it replaces ("Sentence round before the answer", '1' / '0'):
 * a phone that had it on reads All cards (`parseHardMode`).
 */
import { useEffect, useState } from 'react';
import { parseHardMode, type HardMode } from '@shared/study/hardMode';

const KEY = 'sentence-gate-v1';
const EVENT = 'hard-mode-change';

export function readHardMode(): HardMode {
  try {
    return parseHardMode(localStorage.getItem(KEY));
  } catch {
    return 'off';
  }
}

export function writeHardMode(mode: HardMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: the default stays */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
  } catch {
    /* no window (tests) */
  }
}

/** The setting, live: the header chip and Settings change it under an open card. */
export function useHardMode(): HardMode {
  const [mode, setMode] = useState(readHardMode);
  useEffect(() => {
    const update = () => setMode(readHardMode());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return mode;
}
