/**
 * 📺 Watch — making a video's timed transcript (docs/WATCH.md): the chunk plan Gemini reads the
 * video in, the parsing of its timed lines (sub-second when it gives them, "MM:SS" too; times
 * relative to the clip are shifted), and tidying them into lines the player can step through.
 * Pure; used by the worker (services/watch/), tested in transcript.test.ts.
 */

/** Gemini reads the video in windows this long (video_metadata start / end offsets). */
export const WATCH_CHUNK_MS = 5 * 60 * 1000;
/** A last window shorter than this joins the one before. */
export const WATCH_MIN_LAST_CHUNK_MS = 90 * 1000;
/** The longest video transcribed. */
export const WATCH_MAX_MINUTES = 150;

export interface WatchChunkPlan {
  i: number;
  start_ms: number;
  end_ms: number;
}

/** The windows a video of `durationMs` is read in. */
export function planWatchChunks(durationMs: number, chunkMs = WATCH_CHUNK_MS): WatchChunkPlan[] {
  const total = Math.max(0, Math.round(durationMs));
  if (total <= 0) return [];
  const out: WatchChunkPlan[] = [];
  for (let start = 0; start < total; start += chunkMs) out.push({ i: out.length, start_ms: start, end_ms: Math.min(total, start + chunkMs) });
  if (out.length > 1 && out[out.length - 1].end_ms - out[out.length - 1].start_ms < WATCH_MIN_LAST_CHUNK_MS) {
    const last = out.pop()!;
    out[out.length - 1].end_ms = last.end_ms;
  }
  return out;
}

/** One line as Gemini gave it, in ms from the start of the whole video. */
export interface RawWatchLine {
  start_ms: number;
  end_ms: number;
  zh: string;
  speaker: string | null;
}

const HAN = /[㐀-鿿豈-﫿]/;

/** "75.4", 75.4, "1:15.4", "01:01:15" → seconds (NaN when unreadable). */
export function parseTimeSeconds(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  const s = raw.trim().replace(/s$/i, '');
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (!m) return NaN;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Gemini's JSON answer for one window → lines in ms from the start of the video. Times may be
 * absolute (asked for) or relative to the clip (some models count from the clip's start): when
 * most lines fall outside the window but inside [0, window length], they are shifted. Rows without
 * Chinese or a readable start are dropped; lines are clamped into the window.
 */
export function parseGeminiWatchLines(text: string, window: { start_ms: number; end_ms: number }): RawWatchLine[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  if (!cleaned) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini returned unreadable JSON');
  }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { lines?: unknown })?.lines) ? (parsed as { lines: unknown[] }).lines : null;
  if (!rows) throw new Error('Gemini returned no list of lines');
  const read: Array<{ s: number; e: number; zh: string; speaker: string | null }> = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    const zh = typeof r.zh === 'string' ? r.zh : typeof r.text === 'string' ? r.text : '';
    const clean = zh.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean || !HAN.test(clean)) continue;
    const s = parseTimeSeconds(r.start);
    if (!Number.isFinite(s) || s < 0) continue;
    const e = parseTimeSeconds(r.end);
    const speaker = typeof r.speaker === 'string' && r.speaker.trim() ? r.speaker.trim().slice(0, 40) : null;
    read.push({ s: s * 1000, e: Number.isFinite(e) ? e * 1000 : NaN, zh: clean, speaker });
  }
  if (!read.length) return [];
  const len = window.end_ms - window.start_ms;
  const inside = read.filter((l) => l.s >= window.start_ms - 2000 && l.s <= window.end_ms + 2000).length;
  const relative = read.filter((l) => l.s <= len + 2000).length;
  const shift = window.start_ms > 0 && inside < read.length / 2 && relative >= read.length / 2 ? window.start_ms : 0;
  const out: RawWatchLine[] = [];
  for (const l of read) {
    const start = Math.round(l.s + shift);
    if (start < window.start_ms - 2000 || start > window.end_ms + 2000) continue;
    const s = Math.min(window.end_ms, Math.max(window.start_ms, start));
    const e = Number.isFinite(l.e) ? Math.min(window.end_ms, Math.round(l.e + shift)) : NaN;
    out.push({ start_ms: s, end_ms: Number.isFinite(e) && e > s ? e : s, zh: l.zh, speaker: l.speaker });
  }
  return out;
}

/** Is a window's answer believable? (Times in order inside the window; not one line for five minutes.) */
export function checkWatchChunk(lines: readonly RawWatchLine[], window: { start_ms: number; end_ms: number }): string | null {
  let prev = -1;
  let backwards = 0;
  for (const l of lines) {
    if (l.start_ms < prev - 1500) backwards++;
    prev = Math.max(prev, l.start_ms);
  }
  if (lines.length >= 4 && backwards > lines.length / 4) return 'the line times go backwards';
  const len = window.end_ms - window.start_ms;
  if (lines.length >= 6 && len >= 60_000) {
    const first = Math.min(...lines.map((l) => l.start_ms));
    const last = Math.max(...lines.map((l) => l.start_ms));
    if (last - first < Math.min(20_000, len / 10)) return 'every line has nearly the same time';
  }
  return null;
}

/** How long a line with no end time probably lasts (≈ 4 characters a second, 1–8 s). */
function guessDurationMs(zh: string): number {
  const chars = [...zh].filter((ch) => HAN.test(ch)).length;
  return Math.min(8000, Math.max(1000, chars * 250));
}

/**
 * Lines from every window → the transcript the player steps through: in time order, a subtitle
 * read off several frames merged into one line, every line with an end (never past the next line's
 * start; a gap under 1 s is closed so the line runs on until the next), 0-based `i`.
 */
export function tidyWatchLines(raw: readonly RawWatchLine[]): Array<RawWatchLine & { i: number }> {
  const sorted = raw
    .filter((l) => l && typeof l.zh === 'string' && HAN.test(l.zh) && Number.isFinite(l.start_ms))
    .map((l) => ({ ...l, zh: l.zh.replace(/\s+/g, ' ').trim() }))
    .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  const merged: RawWatchLine[] = [];
  for (const l of sorted) {
    const prev = merged[merged.length - 1];
    const prevEnd = prev ? Math.max(prev.end_ms, prev.start_ms + guessDurationMs(prev.zh)) : 0;
    if (prev && prev.zh === l.zh && l.start_ms - prevEnd < 1500) {
      prev.end_ms = Math.max(prev.end_ms, l.end_ms, l.start_ms);
      continue;
    }
    if (prev && l.start_ms - prev.start_ms < 300) {
      // Two lines at the same moment: the later one starts just after.
      merged.push({ ...l, start_ms: prev.start_ms + 300, end_ms: Math.max(l.end_ms, prev.start_ms + 300) });
      continue;
    }
    merged.push({ ...l });
  }
  return merged.map((l, i) => {
    const next = merged[i + 1];
    let end = l.end_ms > l.start_ms ? l.end_ms : l.start_ms + guessDurationMs(l.zh);
    if (next) {
      if (end > next.start_ms || next.start_ms - end < 1000) end = next.start_ms;
    }
    return { i, start_ms: l.start_ms, end_ms: Math.max(end, l.start_ms + 1), zh: l.zh, speaker: l.speaker };
  });
}
