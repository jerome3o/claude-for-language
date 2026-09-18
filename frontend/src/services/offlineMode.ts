import { useSyncExternalStore } from 'react';

/**
 * Offline mode for study.
 *
 * Two inputs decide whether study should behave as offline (audio from the
 * IndexedDB cache or the device's speech synthesis, AI buttons disabled):
 *
 * 1. **Automatic** — `navigator.onLine` via NetworkContext. Nothing to manage.
 * 2. **Forced** — a user toggle for spotty connections (e.g. on the train),
 *    where the device still reports "online" but requests stall, queue up and
 *    then all resolve at once. Persisted in localStorage.
 *
 * The study top bar shows the resolved state ("Auto · online", "Auto · offline",
 * "Forced offline") and a tap cycles auto → forced offline → auto.
 */

const STORAGE_KEY = 'manualOfflineMode';

const listeners = new Set<() => void>();

export function getManualOfflineMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setManualOfflineMode(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage unavailable — mode just won't persist
  }
  listeners.forEach((listener) => listener());
}

export function toggleManualOfflineMode(): boolean {
  const next = !getManualOfflineMode();
  setManualOfflineMode(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * React hook for the manual offline mode flag. Re-renders when the flag
 * changes anywhere in the app.
 */
export function useManualOfflineMode(): boolean {
  return useSyncExternalStore(subscribe, getManualOfflineMode);
}

// ============ Resolution: auto vs forced ============

export type OfflineModeState = 'auto-online' | 'auto-offline' | 'forced-offline';

export interface ResolvedOfflineMode {
  state: OfflineModeState;
  /** True when study should not touch the network (audio, AI). */
  effectiveOffline: boolean;
  /** Short label for the top-bar control. */
  label: string;
  /** Longer description for the button title / aria-label. */
  description: string;
}

/**
 * Pure: combine the browser's connectivity with the user's forced flag.
 * Forced wins over "online"; when the browser itself is offline the flag is
 * moot — we're offline either way, and the label says so.
 */
export function resolveOfflineMode(input: { forced: boolean; isOnline: boolean }): ResolvedOfflineMode {
  if (input.forced) {
    return {
      state: 'forced-offline',
      effectiveOffline: true,
      label: 'Forced offline',
      description: 'Forced offline: audio plays from cache or device TTS, AI features are off. Tap to go back to automatic.',
    };
  }
  if (!input.isOnline) {
    return {
      state: 'auto-offline',
      effectiveOffline: true,
      label: 'Auto · offline',
      description: 'No connection: audio plays from cache or device TTS, AI features are off. Tap to force offline even when a connection comes back.',
    };
  }
  return {
    state: 'auto-online',
    effectiveOffline: false,
    label: 'Auto · online',
    description: 'Online: audio streams and AI features work. Tap to force offline mode for a spotty connection.',
  };
}

/** The next state when the top-bar control is tapped: auto → forced → auto. */
export function nextOfflineModeForced(current: ResolvedOfflineMode): boolean {
  return current.state !== 'forced-offline';
}

/** Tap handler for the control: flips the forced flag per `nextOfflineModeForced`. */
export function cycleOfflineMode(isOnline: boolean): ResolvedOfflineMode {
  const current = resolveOfflineMode({ forced: getManualOfflineMode(), isOnline });
  setManualOfflineMode(nextOfflineModeForced(current));
  return resolveOfflineMode({ forced: getManualOfflineMode(), isOnline });
}

/**
 * Non-React check for code paths that must not touch the network (audio
 * playback): forced offline, or the browser says it is offline.
 */
export function isEffectivelyOffline(): boolean {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  return resolveOfflineMode({ forced: getManualOfflineMode(), isOnline: online }).effectiveOffline;
}

/**
 * Whether the device has a Chinese speech-synthesis voice that works
 * offline (localService = synthesized on-device, no network needed).
 * Returns null if voices haven't loaded yet or the API is unavailable.
 */
export function hasLocalChineseVoice(): boolean | null {
  if (!('speechSynthesis' in window)) return false;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // voices not loaded yet
  return voices.some(
    (v) => (v.lang.startsWith('zh') || v.lang.includes('Chinese')) && v.localService
  );
}
