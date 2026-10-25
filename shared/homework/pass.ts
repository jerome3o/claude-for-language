/**
 * The one-off pass: not spaced repetition. Each item is seen once; an item
 * marked "Not yet" comes back after the others until it is marked "Got it".
 * A lesson / reader is one item, finished by a `done` event.
 *
 * The client walks the pass with `passProgress` / `nextPassItem`; the server
 * recomputes `done_count` / `status` from the uploaded events with the same
 * function, so both agree.
 *
 * Undo (docs/HOMEWORK.md §3b): events are never edited or deleted — an answer is
 * taken back by a further event `{ result: 'undo', undoes: <its id> }`. Every rule
 * here reads the LIVE events (`livePassEvents`: undo events and the events they
 * take back left out), so the order the two arrive in never matters and a
 * device that never saw the answer is not confused by the undo.
 */

import type { HomeworkResult } from './types';

export interface PassEvent {
  /** The event's id (an undo names it in `undoes`). Absent = can't be undone. */
  id?: string;
  item_id: string;
  result: HomeworkResult;
  created_at: string;
  /** An `undo` event: the id of the event it takes back. */
  undoes?: string | null;
}

/** The ids taken back by `undo` events. */
export function undonePassEventIds(events: readonly PassEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.result === 'undo' && e.undoes) out.add(e.undoes);
  return out;
}

/** The events that count: no `undo` events, and none an undo took back. Order kept. */
export function livePassEvents<E extends PassEvent>(events: readonly E[]): E[] {
  const undone = undonePassEventIds(events);
  return events.filter((e) => e.result !== 'undo' && !(e.id && undone.has(e.id)));
}

/**
 * What the pass's ↺ takes back: the most recent live *Got it* / *Not yet* (right / wrong) of
 * the assignment — by `created_at`, a tie going to the later one in the list. Repeated undos
 * walk back through the answers. `done` (a lesson / reader / link finished) is never undone
 * here. Null = nothing to undo.
 */
export function lastPassAnswer<E extends PassEvent>(events: readonly E[]): E | null {
  let best: E | null = null;
  for (const e of livePassEvents(events)) {
    if (!e.id || (e.result !== 'right' && e.result !== 'wrong')) continue;
    if (!best || e.created_at >= best.created_at) best = e;
  }
  return best;
}

/**
 * "Skip this homework" (docs/HOMEWORK.md §3d): the live `skip` event of an assignment's events
 * (the latest by created_at), or null. An undo takes it back like an answer.
 */
export function liveSkip<E extends PassEvent>(events: readonly E[]): E | null {
  let best: E | null = null;
  for (const e of livePassEvents(events)) {
    if (e.result !== 'skip') continue;
    if (!best || e.created_at >= best.created_at) best = e;
  }
  return best;
}

/**
 * Is the assignment skipped? The device's events decide once any `skip` event is among them (an
 * undo made here counts at once); otherwise the server's `skipped_at`.
 */
export function isSkipped(events: readonly PassEvent[], skippedAt: string | null | undefined): boolean {
  if (events.some(e => e.result === 'skip')) return liveSkip(events) !== null;
  return !!skippedAt;
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
  for (const e of livePassEvents(events)) {
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
