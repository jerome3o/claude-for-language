/**
 * The take lock's registry (rules: shared/voice/takeLock.ts; docs/STUDY_SESSION.md "While a take is
 * recording"): every voice take on screen reports its phase here, and any control that advances, submits,
 * rates, closes or navigates asks it first — while a take records, the control stops the take instead (and
 * does nothing else); while the stopped take is checked, it waits.
 *
 * - `useVoiceDictation` registers every voice-first box / 🎤 practice take by itself; the study card's own
 *   recorder (read take, Say the answer, Record again) registers from StudyPage; anything else with a
 *   recorder calls `useRegisterTake`.
 * - `useTakeLock()` = the merged phase + stop for a screen; `guardTake(fn)` wraps a handler (✕, Cancel, a
 *   rating, Next …) — the decision is taken at TAP time from the registry, never from a stale render.
 * - `TakeBackGuard` (App.tsx): back (the Android gesture, the browser's ←, an in-app ← that goes back in
 *   history) stops a recording take instead of leaving — unless the take's owner handles back itself.
 *
 * Lab twin: ui/kit/TakeLock.kt (`TakeLocks`).
 */
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { mergeTakePhases, takeGuard, takeLockPhase, type TakeLockPhase } from '@shared/voice/takeLock';

interface TakeEntry {
  /** The recorder's own phase (listening, finishing, recording, review…). */
  phase: string;
  /** Stop the take (kept and checked as usual) — called only while it records. */
  stop: () => void;
  /** The owner handles back itself (the study card's Record again / Say it again): the global guard leaves it alone. */
  ownBack?: boolean;
}

export interface TakeLockSnapshot {
  /** All takes on screen merged: idle | recording | checking. */
  phase: TakeLockPhase;
  /** The same over the takes whose back the global guard handles. */
  backPhase: TakeLockPhase;
}

const entries = new Map<string, TakeEntry>();
const listeners = new Set<() => void>();
let snapshot: TakeLockSnapshot = { phase: 'idle', backPhase: 'idle' };

function recompute() {
  const all = [...entries.values()];
  const next: TakeLockSnapshot = {
    phase: mergeTakePhases(all.map((e) => e.phase)),
    backPhase: mergeTakePhases(all.filter((e) => !e.ownBack).map((e) => e.phase)),
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
    if (takeLockPhase(e.phase) === 'recording') e.stop();
  }
}

/**
 * What a tap does right now: 'run' (nothing under way), 'stop' (the take was stopped instead) or 'wait'
 * (a stopped take is being checked — nothing happens).
 */
export function takeTap(): 'run' | 'stop' | 'wait' {
  const g = takeGuard(snapshot.phase);
  if (g === 'stop') stopTakes();
  return g;
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

/** The screen's view of the takes on it. */
export function useTakeLock() {
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

/** Report a take from a component: its phase as it changes; removed on unmount. */
export function useRegisterTake(phase: string, stop: () => void, opts: { ownBack?: boolean } = {}): void {
  const id = useId();
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const ownBack = !!opts.ownBack;
  useEffect(() => {
    setTake(id, { phase, stop: () => stopRef.current(), ownBack });
  }, [id, phase, ownBack]);
  useEffect(() => () => setTake(id, null), [id]);
}
