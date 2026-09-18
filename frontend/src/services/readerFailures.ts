/**
 * Failed reader generations: grouping for the Readers list and the
 * friendly one-line reason shown instead of the raw API error.
 *
 * Pure functions — no IndexedDB, no network — so they are cheap to test.
 */

import type { GradedReader } from '../types';

export interface PartitionedReaders<T extends Pick<GradedReader, 'status'>> {
  /** Ready + generating readers, in the order given. */
  active: T[];
  /** Every reader whose generation failed, in the order given. */
  failed: T[];
}

/** Split a readers list into the cards to show and the failures to fold away. */
export function partitionReaders<T extends Pick<GradedReader, 'status'>>(readers: T[]): PartitionedReaders<T> {
  const active: T[] = [];
  const failed: T[] = [];
  for (const r of readers) (r.status === 'failed' ? failed : active).push(r);
  return { active, failed };
}

/**
 * Map a raw generation error to something a learner can act on. The raw
 * text stays available behind "Show details" for debugging; it is never the
 * headline.
 */
export function friendlyReaderError(raw: string | null | undefined): string {
  const msg = (raw ?? '').toLowerCase();
  if (!msg) return "Couldn't write this one.";
  if (/api ?key|authtoken|authentication|not configured|unauthori[sz]ed|401|403/.test(msg)) {
    return "The AI service isn't set up on the server yet.";
  }
  if (/timed? ?out|timeout|deadline/.test(msg)) {
    return 'It took too long and was stopped.';
  }
  if (/rate limit|too many requests|overloaded|429|529|503|busy/.test(msg)) {
    return 'The AI service was busy — try again in a few minutes.';
  }
  if (/not enough|vocabulary|too few/.test(msg)) {
    return 'Not enough learned words to build a story from yet.';
  }
  if (/network|fetch failed|econn|socket|offline/.test(msg)) {
    return 'The connection dropped while it was being written.';
  }
  return "Something went wrong while writing this story.";
}

/** "38 failed generations" / "1 failed generation" — the collapsed row's label. */
export function failedReadersLabel(count: number): string {
  return `${count} failed generation${count === 1 ? '' : 's'}`;
}
