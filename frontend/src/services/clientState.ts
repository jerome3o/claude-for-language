/**
 * Tells the server how this device runs the app, so a tutor can see whether a
 * brand-new student actually installed it and has audio on the phone
 * (migration 0064: users.install_kind / cached_audio_count / last_opened_at).
 *
 * Called from sync, fire-and-forget, at most once per REPORT_INTERVAL_MS per
 * page load. Never throws — the report is nice-to-have, sync is not.
 */

import { reportClientState } from '../api/tutorDashboard';
import { getAudioCacheStats } from './audioCache';

export type InstallKind = 'pwa' | 'android' | 'browser';

const REPORT_INTERVAL_MS = 30 * 60 * 1000;
let lastReportedAt = 0;

/** Android app (Capacitor shell) > installed PWA > plain browser tab. */
export function detectInstallKind(): InstallKind {
  if (typeof window === 'undefined') return 'browser';
  const w = window as Window & { Capacitor?: { isNativePlatform?: () => boolean }; AndroidClipboard?: unknown };
  if (w.AndroidClipboard || (w.Capacitor && typeof w.Capacitor.isNativePlatform === 'function' && w.Capacitor.isNativePlatform())) {
    return 'android';
  }
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
    if ((navigator as Navigator & { standalone?: boolean }).standalone) return 'pwa';
  } catch {
    // matchMedia can be missing in odd webviews
  }
  return 'browser';
}

export async function reportClientStateIfDue(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastReportedAt < REPORT_INTERVAL_MS) return;
  lastReportedAt = now;
  try {
    let cached: number | null = null;
    try {
      cached = (await getAudioCacheStats()).count;
    } catch {
      cached = null;
    }
    await reportClientState({ install_kind: detectInstallKind(), cached_audio_count: cached });
  } catch (err) {
    // Not worth surfacing; try again next sync window.
    console.warn('[ClientState] report failed:', err instanceof Error ? err.message : err);
    lastReportedAt = 0;
  }
}

/** Test hook. */
export function _resetClientStateThrottle(): void {
  lastReportedAt = 0;
}
