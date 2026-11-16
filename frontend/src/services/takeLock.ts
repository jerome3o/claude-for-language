/**
 * The APP-WIDE take lock (rules: shared/voice/takeLock.ts; docs/STUDY_SESSION.md "While a take is recording"): the
 * take lock everywhere outside a `TakeLockProvider` (components/voice/TakeLock.tsx — the mini-lesson player has its
 * own). Every voice take on screen reports its phase here, and any control that advances, submits, rates, closes or
 * navigates asks it first — while a take records, the control stops the take instead (and does nothing else); while
 * the stopped take is checked, it waits.
 *
 * - `useReportTake` (components/voice/TakeLock.tsx) lands here when there is no provider: `useVoiceDictation` (every
 *   voice-first box / 🎤 practice take), the study card's own recorder (StudyPage), the card editor's and the tutor's
 *   model recording.
 * - `useAppTakeLock()` = the merged phase + stop for a screen; `guardTake(fn)` wraps a handler (✕, Cancel, a rating,
 *   Next …) — decided at TAP time from the registry, never from a stale render.
 * - `TakeBackGuard` (components/voice/TakeStop.tsx, App.tsx): back stops a recording take instead of leaving —
 *   unless the take's owner handles back itself (`ownBack`).
 *
 * Lab twin: ui/kit/TakeLock.kt (`TakeLocks`, the fallback of `ReportTake`).
 */
import { useSyncExternalStore } from 'react';
import { combineTakePhases, takeLockLeave, takeLockMayProceed, type TakePhase } from '@shared/voice/takeLock';

interface TakeEntry {
  phase: TakePhase;
  /** Stop the take (kept and checked as usual) — called only while it records. */
  stop: () => void;
  /** The owner handles back itself (the study card's Record again / Say it again, the reader, the phone): the global back guard leaves it alone. */
  ownBack?: boolean;
}

export interface TakeLockSnapshot {
  /** All takes on screen combined: idle | recording | checking. */
  phase: TakePhase;
  /** The same over the takes whose back the global guard handles. */
  backPhase: TakePhase;
}

const entries = new Map<string, TakeEntry>();
const listeners = new Set<() => void>();
let snapshot: TakeLockSnapshot = { phase: 'idle', backPhase: 'idle' };

function recompute() {
  const all = [...entries.values()];
  const next: TakeLockSnapshot = {
    phase: combineTakePhases(all.map((e) => e.phase)),
    backPhase: combineTakePhases(all.filter((e) => !e.ownBack).map((e) => e.phase)),
  };
  if (next.phase === snapshot.phase && next.backPhase === snapshot.backPhase) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

/** Report (or with null, remove) one take. */
export function setTake(id: string, entry: TakeEntry | null): void {
  if (entry) entries.set(id, entry);
  else entries.delete(id);
  recompute();
}

export function takeLockSnapshot(): TakeLockSnapshot {
  return snapshot;
}

export function subscribeTakeLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stop every take that is recording (each is kept and checked as usual). */
export function stopTakes(opts: { backOnly?: boolean } = {}): void {
  for (const e of [...entries.values()]) {
    if (opts.backOnly && e.ownBack) continue;
    if (e.phase === 'recording') e.stop();
  }
}

/**
 * What a tap does right now: 'run' (nothing under way), 'stop' (a recording take was stopped instead) or 'wait'
 * (a stopped take is being checked — nothing happens).
 */
export function takeTap(): 'run' | 'stop' | 'wait' {
  if (takeLockMayProceed(snapshot.phase)) return 'run';
  if (takeLockLeave(snapshot.phase) === 'stop_take') {
    stopTakes();
    return 'stop';
  }
  return 'wait';
}

/** `fn`, unless a take is under way: then a tap stops it (or waits for its check) and does nothing else. */
export function guardTake<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    if (takeTap() === 'run') fn(...args);
  };
}

/** For tests: forget every take. */
export function resetTakeLock(): void {
  entries.clear();
  recompute();
}

export function useTakeLockSnapshot(): TakeLockSnapshot {
  return useSyncExternalStore(subscribeTakeLock, takeLockSnapshot, takeLockSnapshot);
}

/** The screen's view of the app-wide lock. */
export function useAppTakeLock() {
  const { phase } = useTakeLockSnapshot();
  return {
    phase,
    locked: phase !== 'idle',
    recording: phase === 'recording',
    checking: phase === 'checking',
    stop: () => stopTakes(),
    guard: guardTake,
  };
}
