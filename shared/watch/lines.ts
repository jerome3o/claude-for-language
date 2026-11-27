/**
 * 📺 Watch — the player's line rules (docs/WATCH.md): which transcript line is on screen, where
 * ⏮ / 🔁 / ⏭ seek to, when "Pause after each line" stops, the listen-first reveal, the speed chip.
 * Pure; ported to android-lab/core (watch/Watch.kt) and parity-tested
 * (android-lab/parity/fixtures/watch.ts) — change both together.
 *
 * Gemini's times are approximate, so a jump starts LINE_LEAD_MS before a line, and a line's pause
 * point is a little after its end but never inside the next line's speech.
 */

/** One timed line of a video's transcript (what GET /api/watch/videos/:id returns). */
export interface WatchLine {
  i: number;
  start_ms: number;
  end_ms: number;
  /** The Chinese as said / shown in the subtitles. */
  zh: string;
  /** Automatic pinyin (pinyin-pro + the 一 / 不 tone changes), null for a line without Chinese. */
  pinyin: string | null;
  /** Filled in by the translation step; null until then. */
  english: string | null;
  speaker: string | null;
}

/** A jump to a line starts this much before it (times are approximate). */
export const WATCH_LINE_LEAD_MS = 250;
/** "Pause after each line" stops this much after a line's end — never inside the next line. */
export const WATCH_LINE_TAIL_MS = 200;
/** A jump lands a little early or late (the player seeks to the nearest frame). */
export const WATCH_FOCUS_SLACK_MS = 300;
/** Paused after a line, its card stays on screen for this long past the pause point. */
export const WATCH_FOCUS_HOLD_MS = 1500;
/** Two ticks further apart than this (or backwards) are a seek, never a line's end being played through. */
export const WATCH_MAX_TICK_MS = 2000;

type Timed = Pick<WatchLine, 'start_ms' | 'end_ms'>;

/** The last line starting at or before `ms` (−1 before the first). */
export function lineIndexAt(lines: readonly Timed[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].start_ms <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Where a jump to line `i` seeks to. */
export function lineSeekMs(lines: readonly Timed[], i: number): number {
  const line = lines[i];
  if (!line) return 0;
  return Math.max(0, line.start_ms - WATCH_LINE_LEAD_MS);
}

/** Where "Pause after each line" stops line `i`: a little after its end, never past the next line's start. */
export function linePauseMs(lines: readonly Timed[], i: number): number {
  const line = lines[i];
  if (!line) return 0;
  const tail = line.end_ms + WATCH_LINE_TAIL_MS;
  const next = lines[i + 1];
  if (!next) return tail;
  return Math.min(tail, Math.max(line.end_ms, next.start_ms));
}

/**
 * The line on screen at `ms`. `focus` = the line the learner jumped to (⏮ 🔁 ⏭, a tap on a line) or
 * paused after: it stays on screen from its seek point (a jump starts a little early, inside the
 * line before) to its pause point — and, while paused, a little longer — whatever the raw times say.
 */
export function activeLineIndex(lines: readonly Timed[], ms: number, focus: number | null, playing: boolean): number {
  if (focus !== null && focus >= 0 && focus < lines.length) {
    const from = lineSeekMs(lines, focus) - WATCH_FOCUS_SLACK_MS;
    const to = linePauseMs(lines, focus) + (playing ? 0 : WATCH_FOCUS_HOLD_MS);
    if (ms >= from && ms <= to) return focus;
  }
  return lineIndexAt(lines, ms);
}

/** Should the focus be dropped? (Playback moved out of the focused line.) */
export function focusStillHolds(lines: readonly Timed[], ms: number, focus: number | null, playing: boolean): boolean {
  return focus !== null && activeLineIndex(lines, ms, focus, playing) === focus && focus >= 0 && focus < lines.length;
}

/**
 * "Pause after each line": between two playback ticks (prevMs → ms, playing), the line whose pause
 * point was just played through — or null. A seek (backwards, or a jump over WATCH_MAX_TICK_MS) never
 * pauses.
 */
export function lineEndCrossed(lines: readonly Timed[], prevMs: number, ms: number, focus: number | null): number | null {
  if (!(ms > prevMs) || ms - prevMs > WATCH_MAX_TICK_MS) return null;
  const at = activeLineIndex(lines, prevMs, focus, true);
  if (at < 0) return null;
  const stop = linePauseMs(lines, at);
  return prevMs < stop && ms >= stop ? at : null;
}

/** ⏮ / ⏭ from the line on screen (before the first line: either goes to the first). */
export function stepLine(count: number, current: number, dir: -1 | 1): number {
  if (count <= 0) return -1;
  if (current < 0) return 0;
  return Math.min(count - 1, Math.max(0, current + dir));
}

// ---------------- listen first

/** How much of the line card shows in listen-first mode: nothing, the Chinese, + pinyin, + English. */
export type WatchReveal = 'listen' | 'hanzi' | 'pinyin' | 'english';
export const WATCH_REVEALS: readonly WatchReveal[] = ['listen', 'hanzi', 'pinyin', 'english'];

/** The next reveal after a tap on the card; steps the line hasn't got are skipped, past the last → listen. */
export function nextWatchReveal(current: WatchReveal, hasPinyin: boolean, hasEnglish: boolean): WatchReveal {
  let at = WATCH_REVEALS.indexOf(current);
  if (at < 0) at = 0;
  for (let k = 0; k < WATCH_REVEALS.length; k++) {
    at = (at + 1) % WATCH_REVEALS.length;
    const r = WATCH_REVEALS[at];
    if (r === 'pinyin' && !hasPinyin) continue;
    if (r === 'english' && !hasEnglish) continue;
    return r;
  }
  return 'listen';
}

// ---------------- speed

export const WATCH_SPEEDS: readonly number[] = [1, 0.75, 0.5];

/** The speed chip's cycle 1× → 0.75× → 0.5× → 1×; anything else → 1×. */
export function nextWatchSpeed(speed: number): number {
  const at = WATCH_SPEEDS.indexOf(speed);
  return at < 0 ? 1 : WATCH_SPEEDS[(at + 1) % WATCH_SPEEDS.length];
}

/** A stored speed (localStorage / prefs) → one of WATCH_SPEEDS (1 otherwise). */
export function parseWatchSpeed(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN;
  return WATCH_SPEEDS.includes(n) ? n : 1;
}

export function watchSpeedLabel(speed: number): string {
  return `${speed}×`;
}

// ---------------- labels

/** "4:05" / "1:02:03". */
export function watchClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Where to start the video again: the saved position, unless it was (nearly) finished. */
export function resumeAtMs(positionMs: number | null | undefined, durationMs: number | null | undefined): number {
  const pos = typeof positionMs === 'number' && Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  if (typeof durationMs === 'number' && durationMs > 0 && pos >= durationMs - 30_000) return 0;
  return pos < 5_000 ? 0 : pos;
}

/** 0..1 watched, for the list's progress bar. */
export function watchedFraction(positionMs: number | null | undefined, durationMs: number | null | undefined): number {
  if (!positionMs || !durationMs || durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, positionMs / durationMs));
}

export type WatchStatus = 'queued' | 'transcribing' | 'translating' | 'ready' | 'failed';

/** The transcript's state, as the list and the player say it. */
export function watchStatusLine(v: {
  status: string | null;
  chunks_done?: number | null;
  chunks_total?: number | null;
  progress_done?: number | null;
  progress_total?: number | null;
  error?: string | null;
}): string {
  switch (v.status) {
    case 'queued':
      return 'Waiting to start the transcript…';
    case 'transcribing': {
      const total = v.chunks_total ?? 0;
      if (total > 0) return `Making the transcript… (part ${Math.min(total, (v.chunks_done ?? 0) + 1)} of ${total})`;
      return 'Making the transcript…';
    }
    case 'translating': {
      const total = v.progress_total ?? 0;
      if (total > 0) return `Translating ${v.progress_done ?? 0} / ${total} lines`;
      return 'Translating…';
    }
    case 'ready':
      return v.progress_total ? `Transcript ready · ${v.progress_total} lines` : 'Transcript ready';
    case 'failed':
      return `Couldn't make the transcript${v.error ? `: ${v.error}` : ''}`;
    default:
      return 'No transcript yet';
  }
}

/** Still being made: the screens poll while this is true. */
export function watchIsWorking(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'transcribing' || status === 'translating';
}
