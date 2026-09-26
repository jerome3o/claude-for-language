/**
 * The shared whiteboard of a video call: a list of drawing ops on a fixed
 * virtual canvas. Coordinates are 0..1 of BOARD_WIDTH × BOARD_HEIGHT, so
 * both sides draw the same picture whatever size their screen is.
 *
 * The room (worker/src/durable/call-room.ts) keeps the committed ops and
 * sends them to whoever joins; strokes in progress travel as 'board_live'
 * messages and are never stored.
 */

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 1000;
/** Oldest ops are dropped past this — a board is a scratchpad, not an archive. */
export const MAX_BOARD_OPS = 2000;
export const MAX_STROKE_POINTS = 4000;
export const MAX_TEXT_LENGTH = 500;

export const BOARD_COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#d97706'] as const;

/** [x, y] pairs, 0..1, rounded to 4 decimals on the wire. */
export type BoardPoint = [number, number];

export interface BoardStroke {
  type: 'stroke';
  id: string;
  by: string;
  color: string;
  /** Line width in virtual-canvas pixels. */
  width: number;
  points: BoardPoint[];
}

export interface BoardText {
  type: 'text';
  id: string;
  by: string;
  color: string;
  x: number;
  y: number;
  /** Font size in virtual-canvas pixels. */
  size: number;
  text: string;
}

export type BoardItem = BoardStroke | BoardText;

export type BoardOp =
  | BoardItem
  | { type: 'delete'; id: string; by: string }
  | { type: 'clear'; by: string };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Validate and normalise an op that came off the wire. Returns null for
 * anything malformed, so the room never stores or relays junk. `by` is always
 * overwritten with the sender the server knows.
 */
export function sanitizeBoardOp(raw: unknown, by: string): BoardOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const op = raw as Record<string, unknown>;
  const id = typeof op.id === 'string' && op.id.length > 0 && op.id.length <= 64 ? op.id : null;
  switch (op.type) {
    case 'stroke': {
      if (!id || !isColor(op.color) || !Array.isArray(op.points)) return null;
      const width = Number(op.width);
      if (!Number.isFinite(width) || width <= 0 || width > 80) return null;
      const points: BoardPoint[] = [];
      for (const p of op.points.slice(0, MAX_STROKE_POINTS)) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = Number(p[0]);
        const y = Number(p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push([round4(clamp01(x)), round4(clamp01(y))]);
      }
      if (points.length === 0) return null;
      return { type: 'stroke', id, by, color: op.color, width, points };
    }
    case 'text': {
      if (!id || !isColor(op.color) || typeof op.text !== 'string') return null;
      const text = op.text.trim().slice(0, MAX_TEXT_LENGTH);
      const x = Number(op.x);
      const y = Number(op.y);
      const size = Number(op.size);
      if (!text || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size < 8 || size > 200) return null;
      return { type: 'text', id, by, color: op.color, x: round4(clamp01(x)), y: round4(clamp01(y)), size, text };
    }
    case 'delete':
      return id ? { type: 'delete', id, by } : null;
    case 'clear':
      return { type: 'clear', by };
    default:
      return null;
  }
}

/** Apply one op to the list of items on the board (pure; returns a new list). */
export function applyBoardOp(items: readonly BoardItem[], op: BoardOp): BoardItem[] {
  switch (op.type) {
    case 'clear':
      return [];
    case 'delete':
      return items.filter((item) => item.id !== op.id);
    default: {
      const without = items.filter((item) => item.id !== op.id);
      without.push(op);
      return without.length > MAX_BOARD_OPS ? without.slice(without.length - MAX_BOARD_OPS) : without;
    }
  }
}

/** Stored boards stay under this much JSON (Durable Object values and D1 rows cap out around 2 MB). */
export const MAX_BOARD_JSON = 1_500_000;

/** Drop the oldest items until the board's JSON fits `maxChars`. */
export function capBoardSize(items: BoardItem[], maxChars = MAX_BOARD_JSON): BoardItem[] {
  let size = JSON.stringify(items).length;
  let start = 0;
  while (size > maxChars && start < items.length) {
    size -= JSON.stringify(items[start]).length + 1;
    start++;
  }
  return start > 0 ? items.slice(start) : items;
}

/** The id of `userId`'s most recent item — what Undo removes. */
export function lastItemBy(items: readonly BoardItem[], userId: string): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].by === userId) return items[i].id;
  }
  return null;
}
