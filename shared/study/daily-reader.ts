/**
 * Graded readers in the study session — read ONCE, never repeated (Jerome, Oct 2026).
 *
 * - A story that was read (any reader review event: "Finish", or listening to the
 *   end with "▶ Play whole story") is never offered by the session again. Old
 *   reads stay on the Readers list and can be opened by hand.
 * - One reader a day: a reader read today owns the day. Otherwise the session
 *   offers the FIRST unread story of the reader queue ("Up next",
 *   shared/reader/queue.ts) — newest first until the learner reorders it — so
 *   an unread daily reader keeps being offered, day after day, until it is read.
 * - A new daily story is generated only when there is no unread story left (the
 *   previous one was read, or none exists), nothing was read today, and at most
 *   once per local day (the device remembers the attempt's date).
 *
 * Pure; the Lab app's port (core/…/DailyReader.kt) is parity-tested against it.
 */
import { compareReaderQueue } from '../reader/queue';

/** One graded reader a day in the study session. */
export const READERS_PER_DAY = 1;

/** A reader as the session sees it. */
export interface ReaderOfferRow {
  id: string;
  created_at: string;
  /** Its place in the reader queue (shared/reader/queue.ts); NULL = never placed by hand. */
  queue_priority?: number | null;
  /** Generation finished ('ready') and it has pages. */
  studyable: boolean;
  /** It has at least one reader review event (it was finished once). */
  read: boolean;
}

/**
 * The unread story the session would offer next, ignoring today: the first
 * unread, studyable reader in queue order (`compareReaderQueue`: placed-by-hand
 * readers after the others, which go newest first, ties by id).
 */
export function nextUnreadReader<T extends ReaderOfferRow>(readers: T[]): T | null {
  let best: T | null = null;
  for (const r of readers) {
    if (!r.studyable || r.read) continue;
    if (!best || compareReaderQueue(r, best) < 0) best = r;
  }
  return best;
}

/** The unread, studyable readers in queue order — the Readers list's "Up next". */
export function unreadReaderQueue<T extends ReaderOfferRow>(readers: T[]): T[] {
  return readers.filter(r => r.studyable && !r.read).sort(compareReaderQueue);
}

/** Today's ONE reader, or null: nothing once a story was read today, else the first unread one in the queue. */
export function pickTodaysReader<T extends ReaderOfferRow>(readers: T[], readToday: boolean): T | null {
  if (readToday) return null;
  return nextUnreadReader(readers);
}

/**
 * Whether to ask the server for a new daily story now: only when nothing was
 * read today, no unread story is waiting, and no attempt was made today
 * (`lastAttemptDate` / `today` are local YYYY-MM-DD dates).
 */
export function shouldGenerateDailyReader(opts: {
  readToday: boolean;
  hasUnread: boolean;
  lastAttemptDate: string | null;
  today: string;
}): boolean {
  if (opts.readToday || opts.hasUnread) return false;
  return opts.lastAttemptDate !== opts.today;
}

// ============ ▶ Play whole story ============

/** The beat between one page's narration ending and the next page starting (wall clock). */
export const STORY_PAGE_GAP_MS = 600;

/**
 * After page `pageIndex` (0-based) finished playing in "Play whole story": the
 * next page to turn to and play, or null when that was the last page — the
 * story was listened to the end, which counts as finishing it.
 */
export function storyNextPage(pageIndex: number, pageCount: number): number | null {
  if (pageCount <= 0) return null;
  const next = Math.max(0, Math.floor(pageIndex)) + 1;
  return next < pageCount ? next : null;
}

/** The gap before the next page at a playback speed: a slower speed gets a proportionally longer beat (0.5× → 1.2 s). */
export function storyPageGapMs(speed: number): number {
  return speed > 0 ? Math.round(STORY_PAGE_GAP_MS / Math.min(1, speed)) : STORY_PAGE_GAP_MS;
}
