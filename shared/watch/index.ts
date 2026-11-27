/**
 * 📺 Watch (追剧, docs/WATCH.md): Chinese TV on YouTube, played embedded with a timed, tappable
 * transcript. The API shapes, the link parser and the player's line rules.
 */
export * from './video';
export * from './lines';
export * from './transcript';

import type { WatchLine, WatchStatus } from './lines';

/** A video in "My videos" (GET /api/watch). */
export interface WatchVideoSummary {
  id: string;
  title: string;
  channel: string | null;
  duration_ms: number | null;
  status: WatchStatus;
  progress: string | null;
  chunks_done: number;
  chunks_total: number;
  progress_done: number | null;
  progress_total: number | null;
  error: string | null;
  /** My resume point (ms) and when I last opened it. */
  position_ms: number;
  last_opened_at: string | null;
  added_at: string;
}

/** One video with its transcript so far (GET /api/watch/videos/:id). */
export interface WatchVideoDetail extends WatchVideoSummary {
  /** The lines so far: windows that are done while transcribing, every line once ready. */
  lines: WatchLine[];
  /** Windows the transcriber gave up on ("No transcript for 10:00–15:00"). */
  gaps: Array<{ start_ms: number; end_ms: number }>;
  finished_at: string | null;
}
