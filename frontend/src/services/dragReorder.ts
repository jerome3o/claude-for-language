/**
 * Press-and-hold to drag a deck to a new place in the queue (Decks tab).
 *
 * Plain pointer events, no library: hold a card still for `holdMs` and it
 * lifts (a short vibration on phones that have it); moving the pointer
 * reorders the list under it; letting go commits the new order. Moving
 * before the hold ends is a scroll and cancels the hold. While a drag is
 * live a non-passive touchmove listener on the list blocks scrolling, and
 * the tap that ends the drag never navigates.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pure: which card the pointer is over — the one containing the point, else
 * the nearest by centre. -1 for an empty list.
 */
export function indexUnderPointer(rects: readonly RectLike[], x: number, y: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return i;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Pure: the order with `id` moved to `index`; the same array when nothing changes. */
export function moveToIndex(ids: readonly string[], id: string, index: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || index < 0 || index >= ids.length || from === index) return ids as string[];
  const next = ids.filter((x) => x !== id);
  next.splice(index, 0, id);
  return next;
}

interface Press {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

export interface LongPressReorder {
  /** The order to render: the live preview while dragging, else `ids`. */
  order: string[];
  dragId: string | null;
  listRef: (el: HTMLElement | null) => void;
  /** Spread onto each card's root; the root must carry `data-drag-id`. */
  cardProps: (id: string) => {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  };
  /** Put on links inside a card so the release of a drag never navigates. */
  onLinkClick: (e: ReactMouseEvent<HTMLElement>) => void;
}

export function useLongPressReorder(
  ids: string[],
  onCommit: (orderedIds: string[]) => void | Promise<void>,
  { holdMs = 350, moveTolerance = 10 }: { holdMs?: number; moveTolerance?: number } = {}
): LongPressReorder {
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const previewRef = useRef<string[] | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const listEl = useRef<HTMLElement | null>(null);

  // Block scrolling while a drag is live (React's touch listeners are passive).
  const listRef = useCallback((el: HTMLElement | null) => {
    if (listEl.current) listEl.current.removeEventListener('touchmove', blockScroll);
    listEl.current = el;
    if (el) el.addEventListener('touchmove', blockScroll, { passive: false });
  }, []);
  function blockScroll(e: TouchEvent) {
    if (previewRef.current) e.preventDefault();
  }
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);

  const setPreviewBoth = (next: string[] | null) => {
    previewRef.current = next;
    setPreview(next);
  };

  const begin = (p: Press) => {
    dragIdRef.current = p.id;
    setDragId(p.id);
    setPreviewBoth(idsRef.current.slice());
    try { p.el.setPointerCapture(p.pointerId); } catch { /* not supported */ }
    try { navigator.vibrate?.(15); } catch { /* no haptics */ }
  };

  const moveTo = (x: number, y: number) => {
    const list = listEl.current;
    const cur = previewRef.current;
    const id = dragIdRef.current;
    if (!list || !cur || !id) return;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-drag-id]'));
    const idx = indexUnderPointer(cards.map((c) => c.getBoundingClientRect()), x, y);
    if (idx < 0) return;
    // The DOM order IS the preview order, so the index under the pointer is the target slot.
    const next = moveToIndex(cur, id, idx);
    if (next !== cur) setPreviewBoth(next);
  };

  const end = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    const final = previewRef.current;
    const wasDragging = !!final;
    if (wasDragging) {
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 400);
      const changed = final.some((id, i) => id !== idsRef.current[i]);
      if (changed) void onCommit(final);
    }
    dragIdRef.current = null;
    setDragId(null);
    setPreviewBoth(null);
  };

  const cardProps = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
      const el = e.currentTarget;
      if (press.current) clearTimeout(press.current.timer);
      const p: Press = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, el, timer: setTimeout(() => begin(p), holdMs) };
      press.current = p;
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p) return;
      if (previewRef.current) {
        moveTo(e.clientX, e.clientY);
        return;
      }
      if (Math.abs(e.clientX - p.x) > moveTolerance || Math.abs(e.clientY - p.y) > moveTolerance) {
        // The finger is scrolling, not holding.
        clearTimeout(p.timer);
        press.current = null;
      }
    },
    onPointerUp: () => end(),
    onPointerCancel: () => end(),
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (press.current || previewRef.current) e.preventDefault();
    },
  });

  const onLinkClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (suppressClick.current) e.preventDefault();
  };

  return { order: preview ?? ids, dragId, listRef, cardProps, onLinkClick };
}
