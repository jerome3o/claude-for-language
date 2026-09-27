/**
 * The one-off pass: not spaced repetition. Each item is seen once; an item
 * marked "Not yet" comes back after the others until it is marked "Got it".
 * A lesson / reader is one item, finished by a `done` event.
 *
 * The client walks the pass with `passProgress` / `nextPassItem`; the server
 * recomputes `done_count` / `status` from the uploaded events with the same
 * function, so both agree.
 */

import type { HomeworkResult } from './types';

export interface PassEvent {
  item_id: string;
  result: HomeworkResult;
  created_at: string;
}

export interface PassProgress {
  total: number;
  /** Items marked right (or done). */
  done: number;
  /** Items still to go, in the order the pass shows them. */
  remaining: string[];
  /** Items marked "Not yet" at least once and not yet right. */
  retrying: number;
  complete: boolean;
}

export function passProgress(itemIds: readonly string[], events: readonly PassEvent[]): PassProgress {
  const wanted = new Set(itemIds);
  const right = new Set<string>();
  const lastWrong = new Map<string, string>();
  for (const e of events) {
    if (!wanted.has(e.item_id)) continue;
    if (e.result === 'right' || e.result === 'done') right.add(e.item_id);
    else if (e.result === 'wrong') {
      const prev = lastWrong.get(e.item_id);
      if (!prev || e.created_at > prev) lastWrong.set(e.item_id, e.created_at);
    }
  }
  const unique = Array.from(new Set(itemIds));
  const unseen = unique.filter((id) => !right.has(id) && !lastWrong.has(id));
  const retry = unique
    .filter((id) => !right.has(id) && lastWrong.has(id))
    .sort((a, b) => lastWrong.get(a)!.localeCompare(lastWrong.get(b)!));
  const done = unique.filter((id) => right.has(id)).length;
  return {
    total: unique.length,
    done,
    remaining: [...unseen, ...retry],
    retrying: retry.length,
    complete: unique.length > 0 && done === unique.length,
  };
}

export function nextPassItem(progress: PassProgress): string | null {
  return progress.remaining[0] ?? null;
}

/** "5 of 12 words" / "done" — the progress line on a homework row. */
export function passSummary(progress: Pick<PassProgress, 'done' | 'total' | 'complete'>, kind: string): string {
  if (progress.complete) return 'done';
  if (kind !== 'deck') return 'not started';
  const left = progress.total - progress.done;
  return progress.done === 0 ? `${progress.total} ${progress.total === 1 ? 'word' : 'words'}` : `${left} of ${progress.total} words left`;
}
