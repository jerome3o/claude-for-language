/**
 * The Up next page's drag (components/upNext/UpNextBoard.tsx): press-and-hold a row of the
 * list to move it, or press-and-hold a SEARCH RESULT and drag it into a place in the list.
 *
 * The same feel as the Decks tab's `useLongPressReorder` (services/dragReorder.ts) — plain
 * pointer events, hold still `holdMs` to lift (a short vibration), moving before that is a
 * scroll — plus: a result joins the list (as a placeholder row) only while the finger is
 * over the list and leaves it again when the finger moves away; near the top / bottom edge
 * of the screen the page scrolls itself so a word can travel the whole list. The slot math
 * is the shared, unit-tested `indexUnderPointer` / `moveToIndex` / `insertIntoOrder`.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { indexUnderPointer, insertIntoOrder, moveToIndex } from '@shared/decks';

type Kind = 'row' | 'result';

interface Press {
  id: string;
  kind: Kind;
  pointerId: number;
  x: number;
  y: number;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

/** How far outside the list (px) a dragged result still counts as over it. */
const LIST_SLACK = 48;
/** Edge band (px) where the page scrolls itself while dragging. */
const EDGE = 72;

export interface UpNextDrag {
  /** The order to render: the live preview while dragging (a dragged result included), else `ids`. */
  order: string[];
  dragId: string | null;
  /** The dragged id is a search result (render it as a placeholder row while it is in `order`). */
  dragIsResult: boolean;
  /** The element holding the list rows (each row carries `data-upnext-row`). */
  listRef: (el: HTMLElement | null) => void;
  /** The element around the search results AND the list (scrolling is blocked inside while dragging). */
  rootRef: (el: HTMLElement | null) => void;
  rowProps: (id: string) => PointerProps;
  resultProps: (id: string) => PointerProps;
  /** Put on buttons / links inside a row so the release of a drag never clicks them. */
  guardClick: (e: ReactMouseEvent<HTMLElement>) => void;
}

interface PointerProps {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
}

export function useUpNextDrag(
  ids: string[],
  onReorder: (order: string[]) => void,
  onDrop: (noteId: string, index: number) => void,
  { holdMs = 350, moveTolerance = 10 }: { holdMs?: number; moveTolerance?: number } = {}
): UpNextDrag {
  const [dragId, setDragId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const previewRef = useRef<string[] | null>(null);
  const liftedRef = useRef<{ id: string; kind: Kind } | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const listEl = useRef<HTMLElement | null>(null);
  const rootEl = useRef<HTMLElement | null>(null);
  const last = useRef({ x: 0, y: 0 });
  /** Where the lift happened: the page only scrolls itself once the finger has really moved. */
  const liftAt = useRef({ x: 0, y: 0, moved: false });
  const raf = useRef<number | null>(null);

  const blockScroll = useCallback((e: TouchEvent) => {
    if (liftedRef.current) e.preventDefault();
  }, []);
  const rootRef = useCallback((el: HTMLElement | null) => {
    if (rootEl.current) rootEl.current.removeEventListener('touchmove', blockScroll);
    rootEl.current = el;
    if (el) el.addEventListener('touchmove', blockScroll, { passive: false });
  }, [blockScroll]);
  const listRef = useCallback((el: HTMLElement | null) => {
    listEl.current = el;
  }, []);
  useEffect(() => () => {
    if (press.current) clearTimeout(press.current.timer);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const setPreviewBoth = (next: string[] | null) => {
    previewRef.current = next;
    setPreview(next);
  };

  const moveTo = (x: number, y: number) => {
    const lifted = liftedRef.current;
    const list = listEl.current;
    if (!lifted || !list) return;
    const cur = previewRef.current;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-upnext-row]'));
    const rects = rows.map((r) => r.getBoundingClientRect());
    if (lifted.kind === 'row') {
      if (!cur) return;
      const idx = indexUnderPointer(rects, x, y);
      if (idx < 0) return;
      const next = moveToIndex(cur, lifted.id, idx);
      if (next !== cur) setPreviewBoth(next);
      return;
    }
    // A search result: in the list only while the finger is over it.
    const box = list.getBoundingClientRect();
    const over = y >= box.top - LIST_SLACK && y <= box.bottom + LIST_SLACK && x >= box.left - LIST_SLACK && x <= box.right + LIST_SLACK;
    if (!over) {
      if (cur) setPreviewBoth(null);
      return;
    }
    if (!cur) {
      // Not in the list yet: before the row under the finger, or after it past its middle.
      const idx = indexUnderPointer(rects, x, y);
      const at = idx < 0 ? 0 : y > rects[idx].top + rects[idx].height / 2 ? idx + 1 : idx;
      setPreviewBoth(insertIntoOrder(idsRef.current, [lifted.id], at));
      return;
    }
    const idx = indexUnderPointer(rects, x, y);
    if (idx < 0) return;
    const next = moveToIndex(cur, lifted.id, idx);
    if (next !== cur) setPreviewBoth(next);
  };

  const autoScroll = () => {
    raf.current = null;
    if (!liftedRef.current) return;
    const { x, y } = last.current;
    if (!liftAt.current.moved && Math.abs(y - liftAt.current.y) > 24) liftAt.current.moved = true;
    const h = window.innerHeight;
    const step = !liftAt.current.moved ? 0 : y < EDGE ? -Math.ceil((EDGE - y) / 4) : y > h - EDGE ? Math.ceil((y - (h - EDGE)) / 4) : 0;
    if (step !== 0) {
      window.scrollBy(0, step);
      moveTo(x, y);
    }
    raf.current = requestAnimationFrame(autoScroll);
  };

  const begin = (p: Press) => {
    liftedRef.current = { id: p.id, kind: p.kind };
    setDragId(p.id);
    setKind(p.kind);
    setPreviewBoth(p.kind === 'row' ? idsRef.current.slice() : null);
    last.current = { x: p.x, y: p.y };
    liftAt.current = { x: p.x, y: p.y, moved: false };
    try { p.el.setPointerCapture(p.pointerId); } catch { /* not supported */ }
    try { navigator.vibrate?.(15); } catch { /* no haptics */ }
    if (p.kind === 'result') moveTo(p.x, p.y);
    raf.current = requestAnimationFrame(autoScroll);
  };

  const end = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    const lifted = liftedRef.current;
    const final = previewRef.current;
    if (lifted) {
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 400);
      if (lifted.kind === 'row' && final && final.some((id, i) => id !== idsRef.current[i])) onReorder(final);
      if (lifted.kind === 'result' && final && final.includes(lifted.id)) onDrop(lifted.id, final.indexOf(lifted.id));
    }
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    liftedRef.current = null;
    setDragId(null);
    setKind(null);
    setPreviewBoth(null);
  };

  const propsFor = (id: string, k: Kind): PointerProps => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
      const el = e.currentTarget;
      if (press.current) clearTimeout(press.current.timer);
      const p: Press = { id, kind: k, pointerId: e.pointerId, x: e.clientX, y: e.clientY, el, timer: setTimeout(() => begin(p), holdMs) };
      press.current = p;
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (!p) return;
      if (liftedRef.current) {
        last.current = { x: e.clientX, y: e.clientY };
        moveTo(e.clientX, e.clientY);
        return;
      }
      if (Math.abs(e.clientX - p.x) > moveTolerance || Math.abs(e.clientY - p.y) > moveTolerance) {
        clearTimeout(p.timer);
        press.current = null;
      }
    },
    onPointerUp: () => end(),
    onPointerCancel: () => end(),
    onContextMenu: (e) => {
      if (press.current || liftedRef.current) e.preventDefault();
    },
  });

  const guardClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return {
    order: preview ?? ids,
    dragId,
    dragIsResult: kind === 'result',
    listRef,
    rootRef,
    rowProps: (id) => propsFor(id, 'row'),
    resultProps: (id) => propsFor(id, 'result'),
    guardClick,
  };
}
