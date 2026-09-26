/**
 * Call transcripts. Each participant's microphone is recorded and transcribed
 * separately, so every segment already knows who spoke — merging is a sort by
 * time, not diarization.
 */

export interface TranscriptSegment {
  id: string;
  user_id: string;
  piece_id: string;
  /** Epoch ms (server clock) — comparable across both participants. */
  start_ms: number;
  end_ms: number;
  text: string;
  /** 'zh' | 'en' | 'mixed' when the provider reports it. */
  language: string | null;
  pinyin: string | null;
  translation: string | null;
}

/** Both speakers' segments in speaking order (ties: earlier end first, then id). */
export function mergeTranscript<T extends Pick<TranscriptSegment, 'start_ms' | 'end_ms' | 'id'>>(segments: readonly T[]): T[] {
  return [...segments].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms || a.id.localeCompare(b.id));
}

/** "4:05" / "1:02:09" for an offset in ms from the start of the call. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Parse a provider timestamp into seconds: a number, "83.5", "1:23", "01:23.4"
 * or "1:02:03". Returns null when it cannot be read.
 */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/**
 * Consecutive segments by the same speaker less than `gapMs` apart become one
 * turn — the transcript reads as a conversation instead of a list of
 * 3-second fragments.
 */
export function groupTurns<T extends Pick<TranscriptSegment, 'user_id' | 'start_ms' | 'end_ms'>>(
  merged: readonly T[],
  gapMs = 2500,
): T[][] {
  const turns: T[][] = [];
  for (const seg of merged) {
    const last = turns[turns.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.user_id === seg.user_id && seg.start_ms - prev.end_ms <= gapMs) last.push(seg);
    else turns.push([seg]);
  }
  return turns;
}

/** Plain-text transcript ("[4:05] Name: text") for prompts and exports. */
export function transcriptToText(
  merged: readonly Pick<TranscriptSegment, 'user_id' | 'start_ms' | 'text' | 'translation'>[],
  names: Record<string, string>,
  callStartMs: number,
  opts: { translations?: boolean } = {},
): string {
  return merged
    .map((seg) => {
      const who = names[seg.user_id] || 'Speaker';
      const line = `[${formatOffset(seg.start_ms - callStartMs)}] ${who}: ${seg.text}`;
      return opts.translations && seg.translation ? `${line}\n    (${seg.translation})` : line;
    })
    .join('\n');
}
