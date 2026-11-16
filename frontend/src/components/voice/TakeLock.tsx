/**
 * The take lock on the web (rules: shared/voice/takeLock.ts; Lab twin ui/kit/TakeLock.kt): while a voice take is
 * RECORDING, the screen's primary action row is ONE big red "■ Stop recording" that can never advance or submit;
 * "Checking what you said…" while the take is judged; back / ✕ stop the take first.
 *
 * - `TakeLockProvider` — one per screen that locks (the mini-lesson player). Outside one, everything here is a no-op,
 *   so the voice hooks can report unconditionally.
 * - `useReportTake(phase, stop)` — every recorder reports its take (useVoiceDictation, useSpeakingTake do it already,
 *   so every voice box / 🎤 Say it again / speaking answer inside a provider is covered without per-exercise code).
 * - `TakeLockActions` — the screen's action row (`exercise-actions`): its children, or the Stop / Checking button.
 * - `useTakeLock()` — the lock itself: `phase`, `stop()`, `mayProceed()` (read at call time), `guardLeave(leave)`.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  combineTakePhases,
  TAKE_LOCK_CHECKING,
  TAKE_LOCK_STOP,
  takeLockFooter,
  takeLockLeave,
  takeLockMayProceed,
  type TakePhase,
} from '@shared/voice/takeLock';
import { useBackLevels } from '../../hooks/useBackLevels';
import { track } from '../../services/analytics';
import { setTake } from '../../services/takeLock';
import './TakeLock.css';

export interface TakeLock {
  /** Every take on the screen, combined. */
  phase: TakePhase;
  /** Stops every take that is recording (`via` for the analytics: footer by default). */
  stop: (via?: TakeLockStopVia) => void;
  /** The phase right now (safe in a callback that outlived a render). */
  current: () => TakePhase;
  /** May the screen move on right now? */
  mayProceed: () => boolean;
  /** ✕ / leave: stops the take instead while one is recording, else `leave()`. */
  guardLeave: (leave: () => void) => void;
  report: (id: string, phase: TakePhase, stop: () => void) => void;
  remove: (id: string) => void;
}

export type TakeLockStopVia = 'footer' | 'leave' | 'back' | 'advance';

const TakeLockContext = createContext<TakeLock | null>(null);

export function useTakeLock(): TakeLock | null {
  return useContext(TakeLockContext);
}

export function TakeLockProvider({ children, backOwner = 'take-lock', screen = 'lesson' }: {
  children: ReactNode;
  backOwner?: string;
  /** Analytics: which screen (voice.take_lock_stop's `screen`). */
  screen?: string;
}) {
  const [phases, setPhases] = useState<Record<string, TakePhase>>({});
  const phasesRef = useRef(phases);
  phasesRef.current = phases;
  const stops = useRef(new Map<string, () => void>());
  const phase = useMemo(() => combineTakePhases(Object.values(phases)), [phases]);

  const report = useCallback((id: string, p: TakePhase, stop: () => void) => {
    stops.current.set(id, stop);
    setPhases((cur) => (cur[id] === p ? cur : { ...cur, [id]: p }));
  }, []);
  const remove = useCallback((id: string) => {
    stops.current.delete(id);
    setPhases((cur) => {
      if (!(id in cur)) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);
  const current = useCallback(() => combineTakePhases(Object.values(phasesRef.current)), []);
  const stop = useCallback((via: TakeLockStopVia = 'footer') => {
    let stopped = false;
    for (const [id, p] of Object.entries(phasesRef.current)) {
      if (p !== 'recording') continue;
      stops.current.get(id)?.();
      stopped = true;
    }
    if (stopped) track('voice.take_lock_stop', { via, screen });
  }, [screen]);
  const mayProceed = useCallback(() => takeLockMayProceed(current()), [current]);
  const guardLeave = useCallback((leave: () => void) => {
    if (takeLockLeave(current()) === 'stop_take') stop('leave');
    else leave();
  }, [current, stop]);

  // The browser's / the phone's back while recording stops the take (one history entry while it records).
  useBackLevels(phase === 'recording' ? 1 : 0, () => stop('back'), backOwner);

  const value = useMemo<TakeLock>(
    () => ({ phase, stop, current, mayProceed, guardLeave, report, remove }),
    [phase, stop, current, mayProceed, guardLeave, report, remove],
  );
  return <TakeLockContext.Provider value={value}>{children}</TakeLockContext.Provider>;
}

/**
 * A recorder reports its take: to the screen's TakeLockProvider, or — outside one — to the app-wide lock
 * (services/takeLock.ts: the study card, sheets, chats, clips … hold their advancing controls and back stops the
 * take). `ownBack`: the take's screen handles back itself, the app-wide back guard leaves it alone.
 */
export function useReportTake(phase: TakePhase, stop: () => void, opts: { ownBack?: boolean } = {}): void {
  const lock = useContext(TakeLockContext);
  const id = useId();
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const report = lock?.report;
  const remove = lock?.remove;
  const inApp = !lock;
  const ownBack = !!opts.ownBack;
  useEffect(() => {
    report?.(id, phase, () => stopRef.current());
  }, [report, id, phase]);
  useEffect(() => () => remove?.(id), [remove, id]);
  useEffect(() => {
    if (!inApp) return;
    setTake(id, { phase, stop: () => stopRef.current(), ownBack });
  }, [inApp, id, phase, ownBack]);
  useEffect(() => {
    if (!inApp) return;
    return () => setTake(id, null);
  }, [inApp, id]);
}

/**
 * The screen's action row (`exercise-actions`): its own buttons, or — while a take records — one big red
 * "■ Stop recording" in the same place, then "Checking what you said…" until the take is judged.
 */
export function TakeLockActions({ children, className = 'exercise-actions', style, role = 'primary' }: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * primary (default) = the row that moves the screen on (Check / Continue / Got it / Show answer / Done): it becomes
   * the Stop button. secondary = a row that never moves it on (▶ Play, Listen back, one question's own buttons): it
   * stays where it is, greyed and untappable, so only ONE Stop button shows and nothing jumps.
   */
  role?: 'primary' | 'secondary';
}) {
  const lock = useTakeLock();
  const footer = lock ? takeLockFooter(lock.phase) : 'proceed';
  // `inert` set by hand (the same <div> is reused across states, so it is also taken off again).
  const inert = (on: boolean) => (el: HTMLDivElement | null) => {
    if (!el) return;
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  };
  if (footer === 'proceed') return <div className={className} style={style} ref={inert(false)}>{children}</div>;
  if (role === 'secondary') {
    return (
      <div className={`${className} take-lock-muted`} style={style} aria-disabled="true" data-testid="take-lock-muted" ref={inert(true)}>
        {children}
      </div>
    );
  }
  return (
    <div className={`${className} take-lock-actions`} style={style} data-testid="take-lock-actions" data-state={footer} ref={inert(false)}>
      <button
        type="button"
        className={`practice-btn take-lock-stop${footer === 'checking' ? ' checking' : ''}`}
        onClick={() => lock?.stop()}
        disabled={footer !== 'stop'}
        data-testid="take-lock-stop"
      >
        {footer === 'stop' ? (
          <><span className="take-lock-stop-square" aria-hidden="true" />{TAKE_LOCK_STOP}</>
        ) : (
          <><span className="spinner take-lock-spinner" aria-hidden="true" />{TAKE_LOCK_CHECKING}</>
        )}
      </button>
    </div>
  );
}
