import { useSyncExternalStore } from 'react';
import { setNativeCompression, setNativeKeepAwake } from '../utils/audioPlayback';

/**
 * Playback tuning for the Android app's native player (see
 * utils/audioPlayback.ts and native/.../AudioBridge.java). Both are on by
 * default and exposed in Settings so they can be A/B'd on the phone:
 *
 * - compression: a compressor + limiter on every clip, for the crackle at
 *   the top of the speaker's range.
 * - keep awake: a silent stream that holds the audio output open while a
 *   study screen is up, for the pop at the start of the first clip after a
 *   pause.
 *
 * Preferences live in localStorage; the bridge itself is told on startup
 * (applyNativeAudioPrefs) and whenever a value changes. In a browser these
 * are inert.
 */

const COMPRESSION_KEY = 'nativeAudioCompression';
const KEEP_AWAKE_KEY = 'nativeAudioKeepAwake';

const listeners = new Set<() => void>();

function read(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // localStorage unavailable — the value just won't persist
  }
  listeners.forEach((listener) => listener());
}

export function getNativeCompressionPref(): boolean {
  return read(COMPRESSION_KEY, true);
}

export function setNativeCompressionPref(on: boolean): void {
  write(COMPRESSION_KEY, on);
  setNativeCompression(on);
}

export function getNativeKeepAwakePref(): boolean {
  return read(KEEP_AWAKE_KEY, true);
}

export function setNativeKeepAwakePref(on: boolean): void {
  write(KEEP_AWAKE_KEY, on);
  setNativeKeepAwake(on);
}

/** Push the stored preferences to the bridge. Called once at startup. */
export function applyNativeAudioPrefs(): void {
  setNativeCompression(getNativeCompressionPref());
  setNativeKeepAwake(getNativeKeepAwakePref());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNativeCompressionPref(): boolean {
  return useSyncExternalStore(subscribe, getNativeCompressionPref);
}

export function useNativeKeepAwakePref(): boolean {
  return useSyncExternalStore(subscribe, getNativeKeepAwakePref);
}
