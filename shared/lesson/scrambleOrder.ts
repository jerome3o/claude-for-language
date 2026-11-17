/**
 * Word order (scramble) — rearranging the tiles by hand (docs/STUDY_SESSION.md "Mini lessons" → "Word order").
 *
 * Jerome (Nov 2026): "it would be nice if I could click and drag and rearrange stuff so that the order that I click
 * them in isn't final." A tile can be:
 *  - TAPPED: a pool tile goes to the END of the answer, a placed tile goes back to the pool (unchanged);
 *  - DRAGGED inside the answer to a new place, DRAGGED in from the pool to a place, or DRAGGED out to the pool;
 *  - moved one place left / right without a drag (web: arrow keys on a focused tile; Lab: the a11y actions).
 *
 * The order is a list of TILE INDEXES (into the exercise's `tiles`), as the players keep it. Everything here is
 * pure and ported to the Lab app (core `ScrambleOrder.kt`, parity-tested by `parity/fixtures/scramble-order.ts`).
 * Checking is untouched: Check grades whatever the final order is (shared/lesson/scrambleCheck.ts).
 */

/** A tile's box on screen (web: client px; Lab: px in the board's own coordinates). */
export interface ScrambleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What is being dragged: a placed tile (its place in the answer) or a pool tile (its tile index). */
export type ScrambleDrag = { from: 'answer'; index: number } | { from: 'pool'; tile: number };

/** Where the pointer is: over the answer row, over the pool, or neither. */
export type ScrambleZone = 'answer' | 'pool' | 'none';

/** What a drop did (analytics `lesson.scramble_reorder` `change`). */
export type ScrambleChange = 'moved' | 'inserted' | 'removed' | 'none';

/** How far (px / dp) the finger travels on a tile before it is a drag rather than a tap. */
export const SCRAMBLE_DRAG_START = 8;
/** How far (px / dp) outside the answer row / pool a drop still counts as on it. */
export const SCRAMBLE_DROP_SLACK = 24;

function inside(r: ScrambleRect | null | undefined, x: number, y: number, slack: number): boolean {
  if (!r) return false;
  return x >= r.left - slack && x <= r.left + r.width + slack && y >= r.top - slack && y <= r.top + r.height + slack;
}

/** Which zone (x, y) is in; the answer row wins where the two (with their slack) overlap. */
export function scrambleZone(
  answer: ScrambleRect | null,
  pool: ScrambleRect | null,
  x: number,
  y: number,
  slack: number = SCRAMBLE_DROP_SLACK,
): ScrambleZone {
  if (inside(answer, x, y, slack)) return 'answer';
  if (inside(pool, x, y, slack)) return 'pool';
  return 'none';
}

/**
 * The tiles' rows, in order: a flowing, wrapped row starts a new line when a tile's top is below the middle of the
 * line's first tile. Returns [start, end) index ranges into `rects`.
 */
export function scrambleRows(rects: readonly ScrambleRect[]): Array<[number, number]> {
  const rows: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= rects.length; i++) {
    if (i === rects.length) {
      if (rects.length > 0) rows.push([start, i]);
      break;
    }
    const first = rects[start];
    if (rects[i].top >= first.top + first.height / 2) {
      rows.push([start, i]);
      start = i;
    }
  }
  return rows;
}

/**
 * The drop slot (0..rects.length) nearest (x, y) among the OTHER placed tiles (the dragged one left out), over rows
 * that wrap: the line whose band holds y (else the nearest line, the earlier on a tie), then before the first tile of
 * that line whose centre is right of x, else after the line's last tile. 0 for an empty answer.
 */
export function scrambleDropSlot(rects: readonly ScrambleRect[], x: number, y: number): number {
  const rows = scrambleRows(rects);
  if (rows.length === 0) return 0;
  let best = rows[0];
  let bestDist = Infinity;
  for (const row of rows) {
    let top = Infinity;
    let bottom = -Infinity;
    for (let i = row[0]; i < row[1]; i++) {
      top = Math.min(top, rects[i].top);
      bottom = Math.max(bottom, rects[i].top + rects[i].height);
    }
    const d = y < top ? top - y : y > bottom ? y - bottom : 0;
    if (d < bestDist) {
      bestDist = d;
      best = row;
    }
  }
  for (let i = best[0]; i < best[1]; i++) {
    const r = rects[i];
    if (x < r.left + r.width / 2) return i;
  }
  return best[1];
}

/** The tile index being dragged. */
export function scrambleDragTile(order: readonly number[], drag: ScrambleDrag): number {
  return drag.from === 'answer' ? order[drag.index] : drag.tile;
}

/** The answer without the dragged tile — the tiles a drop slot counts between. */
export function scrambleOthers(order: readonly number[], drag: ScrambleDrag): number[] {
  const tile = scrambleDragTile(order, drag);
  return drag.from === 'answer' ? order.filter((_, i) => i !== drag.index) : order.filter(t => t !== tile);
}

/** `order` with `tile` inserted at `at` (clamped to 0..length). */
export function scrambleInsertAt(order: readonly number[], tile: number, at: number): number[] {
  const next = order.slice();
  next.splice(Math.max(0, Math.min(at, next.length)), 0, tile);
  return next;
}

/** `order` without the tile at place `at`; the same array when there is none. */
export function scrambleRemoveAt(order: readonly number[], at: number): number[] {
  if (at < 0 || at >= order.length) return order as number[];
  return order.filter((_, i) => i !== at);
}

/** The tile at place `from` moved to place `to` (clamped); the same array when nothing changes. */
export function scrambleMoveTo(order: readonly number[], from: number, to: number): number[] {
  if (from < 0 || from >= order.length) return order as number[];
  const target = Math.max(0, Math.min(to, order.length - 1));
  if (target === from) return order as number[];
  const next = order.filter((_, i) => i !== from);
  next.splice(target, 0, order[from]);
  return next;
}

/** One place left (-1) or right (+1) — the keyboard / accessibility move. The same array at an edge. */
export function scrambleNudge(order: readonly number[], index: number, dir: -1 | 1): number[] {
  return scrambleMoveTo(order, index, index + dir);
}

/**
 * What the answer row shows mid-drag: the other tiles, with the dragged tile at `slot` while the pointer is over the
 * answer (drawn as a gap), and without it elsewhere. A pool drag outside the answer shows the answer as it is.
 */
export function scramblePreview(order: readonly number[], drag: ScrambleDrag, zone: ScrambleZone, slot: number): number[] {
  const others = scrambleOthers(order, drag);
  if (zone === 'answer') return scrambleInsertAt(others, scrambleDragTile(order, drag), slot);
  if (drag.from === 'answer' && zone === 'none') return order.slice();
  return others;
}

/**
 * Letting go: over the answer → the tile goes in at `slot` (a move, or an insert from the pool); a placed tile over
 * the pool → back to the pool; anywhere else → nothing changes (the tile flies home).
 */
export function scrambleDrop(
  order: readonly number[],
  drag: ScrambleDrag,
  zone: ScrambleZone,
  slot: number,
): { order: number[]; change: ScrambleChange } {
  const unchanged = { order: order.slice(), change: 'none' as const };
  if (drag.from === 'answer' && (drag.index < 0 || drag.index >= order.length)) return unchanged;
  if (zone === 'answer') {
    const next = scrambleInsertAt(scrambleOthers(order, drag), scrambleDragTile(order, drag), slot);
    if (drag.from === 'pool') return { order: next, change: order.includes(drag.tile) ? 'moved' : 'inserted' };
    const same = next.length === order.length && next.every((t, i) => t === order[i]);
    return same ? unchanged : { order: next, change: 'moved' };
  }
  if (zone === 'pool' && drag.from === 'answer') return { order: scrambleRemoveAt(order, drag.index), change: 'removed' };
  return unchanged;
}

/** The screen-reader words for a placed tile ("他, 2 of 6"). */
export function scrambleTileLabel(text: string, index: number, count: number): string {
  return `${text.trim()}, ${index + 1} of ${count}`;
}

/** The polite announcement after a move ("他 moved to 2 of 6"). */
export function scrambleMovedAnnouncement(text: string, index: number, count: number): string {
  return `${text.trim()} moved to ${index + 1} of ${count}`;
}

/** The hint read with a placed tile. */
export const SCRAMBLE_TILE_HINT = 'Tap to take it out. Drag, or use the arrow keys, to move it.';
