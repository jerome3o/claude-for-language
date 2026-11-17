/**
 * Claude threads' time helpers. Two questions on the same card closer than THREAD_GAP_MS read as one
 * conversation: the server keeps them in one card thread (worker claude-agent/backfill.ts, the legacy
 * Ask route) and the card sheet resumes a thread from the last 30 min (shared/claude/contexts.ts
 * `resumeThreadFor`). Pure.
 */

/** Two questions on the same card closer than this belong to one thread. */
export const THREAD_GAP_MS = 30 * 60 * 1000;

/** SQLite's datetime('now') ("2026-09-25 10:01:02") as ISO; ISO input passes through. */
export function sqliteToIso(value: string): string {
  if (!value) return value;
  if (value.includes('T')) return value;
  return value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z');
}
