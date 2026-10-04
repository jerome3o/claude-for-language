/**
 * The reader's playback speed on this device (1× · 0.75× · 0.5×,
 * shared/reader/speed.ts). Remembered in localStorage — a per-device
 * convenience, so a private window or blocked storage just starts at 1× —
 * and shared live between every reader view on the page (the scrubber, the
 * page ▶, a word's ▶ in its sheet) so one chip drives them all.
 */

import { useSyncExternalStore } from 'react';
import {
  DEFAULT_READER_SPEED,
  READER_SPEED_STORAGE_KEY,
  nextReaderSpeed,
  parseReaderSpeed,
  type ReaderSpeed,
} from '@shared/reader/speed';
import { track } from './analytics';

let current: ReaderSpeed | null = null;
const listeners = new Set<() => void>();

function load(): ReaderSpeed {
  try {
    return parseReaderSpeed(localStorage.getItem(READER_SPEED_STORAGE_KEY));
  } catch {
    return DEFAULT_READER_SPEED;
  }
}

export function getReaderSpeed(): ReaderSpeed {
  if (current === null) current = load();
  return current;
}

export function setReaderSpeed(speed: number): ReaderSpeed {
  const next = parseReaderSpeed(speed);
  current = next;
  try {
    localStorage.setItem(READER_SPEED_STORAGE_KEY, String(next));
  } catch {
    // Storage blocked: the choice still holds for this page
  }
  listeners.forEach(fn => fn());
  return next;
}

/** The chip's tap: the next speed, remembered, and recorded (`reader.speed_changed`). */
export function cycleReaderSpeed(): ReaderSpeed {
  const next = setReaderSpeed(nextReaderSpeed(getReaderSpeed()));
  track('reader.speed_changed', { speed: next });
  return next;
}

export function subscribeReaderSpeed(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current speed, re-rendering when any chip changes it. */
export function useReaderSpeed(): ReaderSpeed {
  return useSyncExternalStore(subscribeReaderSpeed, getReaderSpeed, getReaderSpeed);
}

/** Test seam: forget the in-memory value so the next read comes from storage. */
export function resetReaderSpeedForTests(): void {
  current = null;
  listeners.clear();
}
