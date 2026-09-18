import { useEffect } from 'react';
import { holdNativeOutput } from '../utils/audioPlayback';

/**
 * Keep the Android app's audio output awake while this screen is mounted.
 *
 * Study and reader screens play short clips a few seconds apart, and the
 * output drops into standby between them; the first clip after a pause then
 * starts on a cold output and pops. The app holds it open with a silent
 * stream while any screen asks (refcounted in audioPlayback), and only while
 * the app is in the foreground. No-op in a browser.
 */
export function useNativeOutputHold(): void {
  useEffect(() => holdNativeOutput(), []);
}
