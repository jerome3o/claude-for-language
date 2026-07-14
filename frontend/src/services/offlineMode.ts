import { useSyncExternalStore } from 'react';

/**
 * Manual offline mode: a user-controlled toggle for studying on spotty
 * connections (e.g. on the train). When enabled, audio playback never
 * touches the network — it plays from the IndexedDB cache if available,
 * otherwise falls back to the device's speech synthesis (which works
 * offline when a local Chinese voice pack is installed).
 *
 * This is separate from navigator.onLine: a spotty connection reports
 * "online" but requests stall, queue up, and then all resolve at once.
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
