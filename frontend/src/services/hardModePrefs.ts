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
import { parsePassHardMode } from '@shared/homework/pass-angles';

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

// --- Hard mode in the homework pass (shared/homework/pass-angles.ts; docs/HOMEWORK.md §3d) ---------
// Its own per-device setting, so the session's stays as he set it: a one-off pass is the only time he
// sees those words for a while, so it is All unless he chose otherwise (Lab `StudyPrefs.passHardMode`).

const PASS_KEY = 'pass-hard-mode-v1';
const PASS_EVENT = 'pass-hard-mode-change';

export function readPassHardMode(): HardMode {
  try {
    return parsePassHardMode(localStorage.getItem(PASS_KEY));
  } catch {
    return parsePassHardMode(null);
  }
}

export function writePassHardMode(mode: HardMode): void {
  try {
    localStorage.setItem(PASS_KEY, mode);
  } catch {
    /* private mode: the default stays */
  }
  try {
    window.dispatchEvent(new CustomEvent(PASS_EVENT, { detail: mode }));
  } catch {
    /* no window (tests) */
  }
}

/** The pass's setting, live (its header chip and Settings change it under an open word). */
export function usePassHardMode(): HardMode {
  const [mode, setMode] = useState(readPassHardMode);
  useEffect(() => {
    const update = () => setMode(readPassHardMode());
    window.addEventListener(PASS_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PASS_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return mode;
}
