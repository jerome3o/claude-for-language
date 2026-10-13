/**
 * The call timer in the top bar (shared/calls/timer.ts): a small pill "⏱ 4:59" both people see,
 * expandable. The tutor (solo: the caller) sets a countdown — 1 / 2 / 3 / 5 / 10 min or a typed
 * length — or a stopwatch, and starts / pauses / resets it; the student sees it read-only. The
 * room keeps it in room time; `roomNow` turns it into this device's clock. At zero the pill
 * flashes and `onFinished` runs once per run (the page chimes).
 */

import { useEffect, useRef, useState } from 'react';
import {
  minutesLabel,
  parseTimerInput,
  shouldChimeTimer,
  timerAria,
  timerByLine,
  timerDone,
  timerFinishKey,
  timerLabel,
  TIMER_COUNTDOWN_LABEL,
  TIMER_FLASH_MS,
  TIMER_PRESET_MINUTES,
  TIMER_STOPWATCH_LABEL,
  TIMER_UP_LABEL,
  type CallTimer,
  type CallTimerAction,
  type CallTimerMode,
} from '@shared/calls';

export interface CallTimerPillProps {
  timer: CallTimer | null;
  roomNow: () => number;
  canControl: boolean;
  myUserId: string;
  onAction: (action: CallTimerAction) => void;
  /** A countdown reached zero while this device watched it run (once per run). */
  onFinished: () => void;
  /** Opened from outside (the ⋯ menu's ⏱ Timer). */
  openSignal?: number;
}

export function CallTimerPill({ timer, roomNow, canControl, myUserId, onAction, onFinished, openSignal }: CallTimerPillProps) {
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState(false);
  const [mode, setMode] = useState<CallTimerMode>('countdown');
  const [custom, setCustom] = useState('');
  const [now, setNow] = useState(() => roomNow());
  const [flashUntil, setFlashUntil] = useState(0);
  const sawRunningRef = useRef(false);
  const chimedRef = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openSignal) {
      setOpen(true);
      setSetup(!timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Tick while it runs (4× a second keeps the seconds honest); also while flashing.
  const running = !!timer?.running;
  useEffect(() => {
    setNow(roomNow());
    if (!running && Date.now() >= flashUntil) return;
    const t = setInterval(() => setNow(roomNow()), 250);
    return () => clearInterval(t);
  }, [running, timer, flashUntil, roomNow]);

  // The chime: once per run, only for a run this device saw counting.
  useEffect(() => {
    if (!timer) {
      sawRunningRef.current = false;
      return;
    }
    if (shouldChimeTimer(timer, now, chimedRef.current, sawRunningRef.current)) {
      chimedRef.current = timerFinishKey(timer);
      setFlashUntil(Date.now() + TIMER_FLASH_MS);
      onFinished();
    }
    if (timer.running && !timerDone(timer, now)) sawRunningRef.current = true;
    else if (!timer.running) sawRunningRef.current = false;
  }, [timer, now, onFinished]);

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  if (!timer && !canControl) return null;
  const done = !!timer && timerDone(timer, now);
  const flashing = done && Date.now() < flashUntil;
  const customMs = parseTimerInput(custom);
  const showSetup = canControl && (setup || !timer);

  const act = (a: CallTimerAction) => {
    onAction(a);
    // A new timer starts and the panel gets out of the way: the pill counts.
    if (a.kind === 'set') {
      setSetup(false);
      setOpen(false);
    }
  };

  return (
    <div className="call-timer-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`call-timer-pill${timer ? '' : ' empty'}${done ? ' done' : ''}${flashing ? ' flash' : ''}${timer && !timer.running && !done ? ' paused' : ''}`}
        onClick={() => {
          setOpen((v) => !v);
          setSetup(false);
        }}
        aria-expanded={open}
        aria-label={timer ? timerAria(timer, now) : 'Timer'}
        title={timer ? timerByLine(timer, myUserId, now) : 'Timer — count down a test, or time something'}
        data-testid="call-timer-pill"
      >
        <span aria-hidden="true">⏱</span>
        {timer && <span className="call-timer-time" data-testid="call-timer-time">{done ? TIMER_UP_LABEL : timerLabel(timer, now)}</span>}
      </button>
      {open && (
        <div className="call-timer-panel" role="dialog" aria-label="Timer" data-testid="call-timer-panel">
          {timer && !showSetup && (
            <>
              <div className={`call-timer-big${done ? ' done' : ''}`} aria-live="polite">{timerLabel(timer, now)}</div>
              <div className="call-timer-by">{timerByLine(timer, myUserId, now)}</div>
              {canControl ? (
                <div className="call-timer-actions">
                  {timer.running && !done ? (
                    <button type="button" className="call-timer-btn primary" onClick={() => act({ kind: 'pause' })} data-testid="timer-pause">⏸ Pause</button>
                  ) : (
                    <button type="button" className="call-timer-btn primary" onClick={() => act({ kind: 'start' })} data-testid="timer-start">▶ {done ? 'Again' : 'Start'}</button>
                  )}
                  <button type="button" className="call-timer-btn" onClick={() => act({ kind: 'reset' })} data-testid="timer-reset">↺ Reset</button>
                  <button type="button" className="call-timer-btn" onClick={() => setSetup(true)} data-testid="timer-new">New timer</button>
                  <button type="button" className="call-timer-btn quiet" onClick={() => { act({ kind: 'clear' }); setOpen(false); }} data-testid="timer-clear" aria-label="Remove the timer">✕</button>
                </div>
              ) : (
                <p className="call-timer-note">Only your tutor can start or stop it.</p>
              )}
            </>
          )}
          {showSetup && (
            <div className="call-timer-setup">
              <div className="call-timer-modes" role="tablist">
                {(['countdown', 'stopwatch'] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)} data-testid={`timer-mode-${m}`}>
                    {m === 'countdown' ? TIMER_COUNTDOWN_LABEL : TIMER_STOPWATCH_LABEL}
                  </button>
                ))}
              </div>
              {mode === 'countdown' ? (
                <>
                  <div className="call-timer-presets">
                    {TIMER_PRESET_MINUTES.map((m) => (
                      <button key={m} type="button" className="call-timer-preset" onClick={() => act({ kind: 'set', mode: 'countdown', duration_ms: m * 60_000, start: true })} data-testid={`timer-preset-${m}`}>
                        {minutesLabel(m * 60_000)}
                      </button>
                    ))}
                  </div>
                  <form
                    className="call-timer-custom"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (customMs) act({ kind: 'set', mode: 'countdown', duration_ms: customMs, start: true });
                    }}
                  >
                    <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other: 7 or 1:30" inputMode="text" aria-label="Countdown length (minutes, or m:ss)" data-testid="timer-custom" />
                    <button type="submit" className="call-timer-btn primary" disabled={!customMs} data-testid="timer-custom-start">▶ {customMs ? minutesLabel(customMs) : 'Start'}</button>
                  </form>
                </>
              ) : (
                <button type="button" className="call-timer-btn primary wide" onClick={() => act({ kind: 'set', mode: 'stopwatch', start: true })} data-testid="timer-stopwatch-start">▶ Start the stopwatch</button>
              )}
              <p className="call-timer-note">Both of you see it; a soft bell rings at zero.</p>
              {timer && <button type="button" className="call-timer-back" onClick={() => setSetup(false)}>‹ Back to the timer</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
