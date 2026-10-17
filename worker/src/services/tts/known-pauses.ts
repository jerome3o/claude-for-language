/**
 * Account pauses this isolate has been told about (no credit / bad key;
 * services/tts/account.ts), so a paused provider is skipped WITHOUT a limiter call
 * on every clip. MiniMax was out of credit from 4 Oct 2026, and every clip asked
 * its Durable Object first only to hear "paused" before Azure got a go.
 *
 * Remembered for at most KNOWN_PAUSE_MAX_MS, so the probe after a pause — or an
 * admin's "retry now" — still happens within a couple of minutes.
 */
import type { TtsProviderId } from '@shared/tts';

export const KNOWN_PAUSE_MAX_MS = 2 * 60_000;

const knownPauses = new Map<TtsProviderId, { until: number; code: number | string }>();

export function noteKnownPause(provider: TtsProviderId, code: number | string, ms: number | undefined, now = Date.now()): void {
  knownPauses.set(provider, { code, until: now + Math.min(KNOWN_PAUSE_MAX_MS, Math.max(1_000, ms ?? KNOWN_PAUSE_MAX_MS)) });
}

export function clearKnownPause(provider: TtsProviderId): void {
  knownPauses.delete(provider);
}

/** Tests / a settings save / admin "retry now": forget every remembered pause. */
export function forgetKnownAccountPauses(): void {
  knownPauses.clear();
}

export function knownAccountPause(provider: TtsProviderId, now = Date.now()): { until: number; code: number | string } | null {
  const p = knownPauses.get(provider);
  if (!p) return null;
  if (now >= p.until) {
    knownPauses.delete(provider);
    return null;
  }
  return p;
}
