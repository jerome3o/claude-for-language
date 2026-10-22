/**
 * The retry progress bar (Jerome, 22 Oct 2026; docs/HOMEWORK.md §3c): "When I click Not yet, an
 * orange bar should accumulate on the RIGHT-hand side of the progress bar, until my blue line
 * catches up with the orange — then I'm reviewing cards I've already seen."
 *
 * The bar is a row of SLOTS, one per showing of a card:
 *
 *   slots    = answered + fresh + retries          (= items + every "Not yet" given so far)
 *   blue     = answered / slots                    — every Got it AND every Not yet is a step done
 *   track    = fresh / slots                       — items not shown yet
 *   orange   = retries / slots, at the RIGHT end   — "Not yet" items still owed one more showing
 *
 * Why steps, not words right: with "words right / words" a Not yet moved nothing, which is what
 * Jerome saw. Counting showings, a Not yet is a step done AND adds one owed step at the right end:
 * `answered/slots` becomes `(answered+1)/(slots+1)`, which is never smaller — the blue never goes
 * backwards on a Not yet; the track gets longer (the orange grows) instead of progress being lost.
 * When every item has been shown once, `answered + retries = slots`: the blue meets the orange
 * (`onRetries`), and each Got it on a retry eats one orange slot. A Not yet on a retry adds a slot
 * and keeps the orange the same size. Finished = no fresh, no retries = full blue.
 *
 * It is a pure function of counts (`retryBar`), so other passes (mini-lesson homework) can reuse it;
 * `passRetryBar` derives the counts from a pass's events. Undo (§3b) is free: the counts are read
 * from the LIVE events, so an undone Not yet takes its slot (and its orange) back.
 * Lab port: core `RetryBar.kt`, parity-tested (`android-lab/parity/fixtures/retry-bar.ts`).
 */

import { livePassEvents, type PassEvent } from './pass';

export interface RetryBarCounts {
  /** Steps taken: every answer given, right or "not yet". */
  answered: number;
  /** Items not shown yet — one step each, in the grey track. */
  fresh: number;
  /** Items answered "not yet" and not right since — one step each, the orange at the right end. */
  retries: number;
  /** Items finished, of `items` (for the label). */
  itemsDone: number;
  items: number;
}

export interface RetryBar extends RetryBarCounts {
  /** answered + fresh + retries. */
  slots: number;
  /** 0..1: the blue, from the left. */
  doneFraction: number;
  /** 0..1: the orange, drawn from the right end leftwards (it starts at 1 − retryFraction). */
  retryFraction: number;
  /** Every item has been shown once and some are owed again: the blue has reached the orange. */
  onRetries: boolean;
  /** Nothing left: full blue. */
  complete: boolean;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function retryBar(counts: RetryBarCounts): RetryBar {
  const answered = nonNeg(counts.answered);
  const fresh = nonNeg(counts.fresh);
  const retries = nonNeg(counts.retries);
  const items = nonNeg(counts.items);
  const itemsDone = Math.min(nonNeg(counts.itemsDone), items);
  const slots = answered + fresh + retries;
  const left = fresh + retries;
  return {
    answered,
    fresh,
    retries,
    itemsDone,
    items,
    slots,
    doneFraction: slots === 0 ? 0 : answered / slots,
    retryFraction: slots === 0 ? 0 : retries / slots,
    onRetries: fresh === 0 && retries > 0,
    complete: slots > 0 && left === 0,
  };
}

/**
 * The bar of a one-off pass (`passProgress`'s rules): per item, its live "not yet"s are steps done,
 * a right (or done) is one more step done (repeats of it count once); an item never answered is fresh,
 * an item with a "not yet" and no right is a retry.
 */
export function passRetryBar(itemIds: readonly string[], events: readonly PassEvent[]): RetryBar {
  const unique = Array.from(new Set(itemIds));
  const wanted = new Set(unique);
  const right = new Set<string>();
  const wrongs = new Map<string, number>();
  for (const e of livePassEvents(events)) {
    if (!wanted.has(e.item_id)) continue;
    if (e.result === 'right' || e.result === 'done') right.add(e.item_id);
    else if (e.result === 'wrong') wrongs.set(e.item_id, (wrongs.get(e.item_id) ?? 0) + 1);
  }
  let answered = 0;
  let fresh = 0;
  let retries = 0;
  for (const id of unique) {
    const w = wrongs.get(id) ?? 0;
    answered += w + (right.has(id) ? 1 : 0);
    if (right.has(id)) continue;
    if (w > 0) retries++;
    else fresh++;
  }
  return retryBar({ answered, fresh, retries, itemsDone: right.size, items: unique.length });
}

export interface RetryBarUnit {
  one: string;
  other: string;
}

export const WORD_UNIT: RetryBarUnit = { one: 'word', other: 'words' };

const plural = (n: number, unit: RetryBarUnit) => (n === 1 ? unit.one : unit.other);

/** The bar's accessible label: "5 of 12 words done · 3 to retry" / "All 12 words done". */
export function retryBarLabel(bar: RetryBar, unit: RetryBarUnit = WORD_UNIT): string {
  if (bar.complete) return `All ${bar.items} ${plural(bar.items, unit)} done`;
  const head = `${bar.itemsDone} of ${bar.items} ${plural(bar.items, unit)} done`;
  return bar.retries > 0 ? `${head} · ${bar.retries} to retry` : head;
}

/** The small mark at the bar's right end, so the orange reads without colour: "↺ 3" (null = none). */
export function retryBarBadge(bar: RetryBar): string | null {
  return bar.retries > 0 ? `↺ ${bar.retries}` : null;
}

/**
 * The line under the bar: "3 to try again" while new items are still coming, "Trying again · 3 left"
 * once the blue has reached the orange (he is on cards he has already seen). Null = no retries.
 */
export function retryBarNote(bar: RetryBar): string | null {
  if (bar.retries === 0) return null;
  return bar.onRetries ? `Trying again · ${bar.retries} left` : `${bar.retries} to try again`;
}
