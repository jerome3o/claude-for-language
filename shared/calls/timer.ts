/**
 * The call timer (Minghui, Oct 2026: "I sometimes need to time students' tests").
 *
 * ONE timer per call, shared by both people: a countdown (1 / 2 / 3 / 5 / 10 min or a custom
 * length) or a stopwatch, with start / pause / reset. The CallRoom holds it (`timer` messages,
 * `welcome.timer`) in SERVER time, so both screens show the same seconds and a reconnect picks it
 * up where it is; each device turns server time into its own clock with the room's ping offset.
 * The relationship's tutor controls it (in a solo call, the caller); the student sees it
 * read-only — a test is timed by the teacher. At zero both devices chime once and the pill
 * flashes (`timerFinishKey`: once per run, not again after a reconnect into a finished run).
 *
 * Pure rules, used by the CallRoom, the web call page and the Lab app
 * (`core/…/calls/CallTimer.kt`, parity-tested by parity/fixtures/calls-timer.ts).
 */

export type CallTimerMode = 'countdown' | 'stopwatch';

/** The room's timer. All times are the room's (server) epoch ms. */
export interface CallTimer {
  /** A new id for every new timer (`set`); the same timer keeps it through start / pause / reset. */
  id: string;
  mode: CallTimerMode;
  /** The countdown's length (0 for a stopwatch). */
  duration_ms: number;
  running: boolean;
  /** When the current run started (null while paused / not started). */
  started_at: number | null;
  /** Time counted before `started_at` (the runs before a pause). */
  elapsed_ms: number;
  /** Counts every change (start / pause / reset) — a run's finish is keyed by id + run. */
  v: number;
  /** Counts the runs (each start from zero / reset): the finish chime is once per run. */
  run: number;
  /** Who set it (user id) and their name. */
  by: string;
  name: string;
}

export type CallTimerAction =
  /** A new timer (replaces any): a countdown of `duration_ms`, or a stopwatch. Starts at once when `start`. */
  | { kind: 'set'; mode: CallTimerMode; duration_ms?: number; start?: boolean }
  | { kind: 'start' }
  | { kind: 'pause' }
  | { kind: 'reset' }
  /** Take the timer away. */
  | { kind: 'clear' };

/** The quick lengths, in minutes. */
export const TIMER_PRESET_MINUTES = [1, 2, 3, 5, 10] as const;
/** The longest countdown (a lesson is never longer). */
export const MAX_TIMER_MS = 3 * 60 * 60 * 1000;
export const MIN_TIMER_MS = 5_000;
/** How long the pill flashes after a countdown reaches zero. */
export const TIMER_FLASH_MS = 6_000;

/** A client's `timer` action, cleaned (null = refused). */
export function sanitizeTimerAction(raw: unknown): CallTimerAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'set': {
      if (r.mode === 'stopwatch') return { kind: 'set', mode: 'stopwatch', ...(r.start === true ? { start: true } : {}) };
      if (r.mode !== 'countdown') return null;
      const d = typeof r.duration_ms === 'number' && Number.isFinite(r.duration_ms) ? Math.round(r.duration_ms) : NaN;
      if (!(d >= MIN_TIMER_MS && d <= MAX_TIMER_MS)) return null;
      return { kind: 'set', mode: 'countdown', duration_ms: d, ...(r.start === true ? { start: true } : {}) };
    }
    case 'start':
    case 'pause':
    case 'reset':
    case 'clear':
      return { kind: r.kind };
    default:
      return null;
  }
}

/** Who may run the timer: the relationship's tutor; anyone in a solo call (no tutor). */
export function canControlTimer(userId: string, tutorId: string | null): boolean {
  return tutorId === null || userId === tutorId;
}

/** Time counted so far at `now` (room time). */
export function timerElapsed(t: CallTimer, now: number): number {
  return Math.max(0, t.elapsed_ms + (t.running && t.started_at !== null ? Math.max(0, now - t.started_at) : 0));
}

/** A countdown's time left (never below 0); a stopwatch's time counted. */
export function timerShown(t: CallTimer, now: number): number {
  const e = timerElapsed(t, now);
  return t.mode === 'countdown' ? Math.max(0, t.duration_ms - e) : e;
}

/** A countdown that reached zero. */
export function timerDone(t: CallTimer, now: number): boolean {
  return t.mode === 'countdown' && timerElapsed(t, now) >= t.duration_ms;
}

/** When (room time) a running countdown reaches zero; null otherwise. */
export function timerEndsAt(t: CallTimer): number | null {
  if (t.mode !== 'countdown' || !t.running || t.started_at === null) return null;
  return t.started_at + Math.max(0, t.duration_ms - t.elapsed_ms);
}

/**
 * The room's next timer after `action` by `by` at `now` (null = no timer). `newId` makes the id of
 * a new timer. A start on a finished countdown starts it again from the top.
 */
export function reduceTimer(
  cur: CallTimer | null,
  action: CallTimerAction,
  by: { userId: string; name: string },
  now: number,
  newId: () => string,
): CallTimer | null {
  switch (action.kind) {
    case 'clear':
      return null;
    case 'set': {
      const start = action.start === true;
      return {
        id: newId(),
        mode: action.mode,
        duration_ms: action.mode === 'countdown' ? action.duration_ms ?? 0 : 0,
        running: start,
        started_at: start ? now : null,
        elapsed_ms: 0,
        v: 1,
        run: 1,
        by: by.userId,
        name: by.name,
      };
    }
    case 'start': {
      if (!cur || (cur.running && !timerDone(cur, now))) return cur;
      if (timerDone(cur, now)) return { ...cur, running: true, started_at: now, elapsed_ms: 0, v: cur.v + 1, run: cur.run + 1 };
      return { ...cur, running: true, started_at: now, v: cur.v + 1 };
    }
    case 'pause': {
      if (!cur || !cur.running) return cur;
      const elapsed = cur.mode === 'countdown' ? Math.min(cur.duration_ms, timerElapsed(cur, now)) : timerElapsed(cur, now);
      return { ...cur, running: false, started_at: null, elapsed_ms: elapsed, v: cur.v + 1 };
    }
    case 'reset': {
      if (!cur) return cur;
      return { ...cur, running: false, started_at: null, elapsed_ms: 0, v: cur.v + 1, run: cur.run + 1 };
    }
  }
}

/** A room's stored timer, checked (anything odd = none). */
export function sanitizeTimer(raw: unknown): CallTimer | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<CallTimer>;
  if (typeof t.id !== 'string' || (t.mode !== 'countdown' && t.mode !== 'stopwatch')) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return {
    id: t.id,
    mode: t.mode,
    duration_ms: num(t.duration_ms),
    running: t.running === true && typeof t.started_at === 'number',
    started_at: t.running === true && typeof t.started_at === 'number' ? t.started_at : null,
    elapsed_ms: num(t.elapsed_ms),
    v: num(t.v),
    run: num(t.run),
    by: typeof t.by === 'string' ? t.by : '',
    name: typeof t.name === 'string' ? t.name : '',
  };
}

/**
 * The key a device remembers when it has chimed for a finished countdown — one chime per run:
 * a pause at zero, a reconnect or a re-render never chime again; a reset / new run does.
 */
export function timerFinishKey(t: CallTimer): string {
  return `${t.id}:${t.run}`;
}

/**
 * Should this device chime now? Only for a countdown that finished while this device watched it
 * run (`sawRunning`), not yet chimed for this run. Joining into a timer already at zero is silent.
 */
export function shouldChimeTimer(t: CallTimer | null, now: number, chimed: string | null, sawRunning: boolean): boolean {
  return !!t && sawRunning && timerDone(t, now) && chimed !== timerFinishKey(t);
}

/** "4:59", "0:07", "1:02:03" — whole seconds, a countdown rounds UP (it shows 0:00 only at zero). */
export function formatTimer(ms: number, roundUp = false): string {
  const s = roundUp ? Math.ceil(Math.max(0, ms) / 1000) : Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** The pill's time: a countdown rounds up, a stopwatch down. */
export function timerLabel(t: CallTimer, now: number): string {
  return formatTimer(timerShown(t, now), t.mode === 'countdown');
}

/** "5 min", "1 min 30 s", "45 s" — a length in words. */
export function minutesLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/**
 * The custom length typed in the timer sheet: "7" (minutes), "1:30", "90s", "2m", "2m30s".
 * Null = not a length the timer takes.
 */
export function parseTimerInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  let ms: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,3}):([0-5]?\d)$/))) ms = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  else if ((m = t.match(/^(\d{1,3}(?:\.\d+)?)(?:m|min|mins|minutes?)?$/))) ms = Math.round(Number(m[1]) * 60) * 1000;
  else if ((m = t.match(/^(\d{1,5})(?:s|sec|secs|seconds?)$/))) ms = Number(m[1]) * 1000;
  else if ((m = t.match(/^(\d{1,3})m(?:in)?(\d{1,2})s(?:ec)?$/))) ms = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  if (ms === null || ms < MIN_TIMER_MS || ms > MAX_TIMER_MS) return null;
  return ms;
}

// ------------------------------------------------------------------ words

export const TIMER_BUTTON_LABEL = '⏱ Timer';
export const TIMER_UP_LABEL = 'Time’s up';
export const TIMER_COUNTDOWN_LABEL = 'Countdown';
export const TIMER_STOPWATCH_LABEL = 'Stopwatch';

const first = (name: string) => name.trim().split(/\s+/)[0] || '';

/** Under the time in the expanded pill. */
export function timerByLine(t: CallTimer, myUserId: string, now: number): string {
  const who = t.by === myUserId ? 'You' : first(t.name) || 'Your tutor';
  if (timerDone(t, now)) return `${TIMER_UP_LABEL} · ${t.mode === 'countdown' ? minutesLabel(t.duration_ms) : ''}`.replace(/ · $/, '');
  const what = t.mode === 'countdown' ? `${minutesLabel(t.duration_ms)} countdown` : 'Stopwatch';
  const state = t.running ? '' : timerElapsed(t, now) > 0 ? ' · paused' : ' · ready';
  return `${what}${state} · set by ${who === 'You' ? 'you' : who}`;
}

/** The pill's accessible name. */
export function timerAria(t: CallTimer, now: number): string {
  if (timerDone(t, now)) return `Timer: ${TIMER_UP_LABEL}`;
  return `${t.mode === 'countdown' ? 'Countdown' : 'Stopwatch'} ${timerLabel(t, now)}${t.running ? '' : ', paused'}`;
}
