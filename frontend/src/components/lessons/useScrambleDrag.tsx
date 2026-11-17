/**
 * Drag to rearrange a word order (scramble) — docs/STUDY_SESSION.md "Mini lessons" → "Word order".
 *
 * Plain pointer events (mouse, touch, pen), no library. A press on a tile that travels more than
 * `SCRAMBLE_DRAG_START` px is a drag; less is the old tap (a pool tile goes to the end, a placed tile goes back).
 * The tiles carry `touch-action: none`, so a drag never scrolls the page (a swipe that starts off a tile still
 * scrolls). While dragging, a copy of the tile follows the finger (portalled to <body>, so a transformed ancestor
 * can't offset it), the answer row shows the tile's place as a dashed gap the other tiles move around, and letting
 * go commits `scrambleDrop` — over the answer: that place; a placed tile over the pool: back to the pool; anywhere
 * else: nothing changes. The slot is the shared, unit-tested `scrambleDropSlot` over the OTHER placed tiles' boxes
 * (rows that wrap), measured from the DOM on every move. A light vibration on pick-up and drop where the device
 * has one. The release that ends a drag never also counts as a tap.
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  SCRAMBLE_DRAG_START,
  scrambleDragTile,
  scrambleDrop,
  scrambleDropSlot,
  scramblePreview,
  scrambleZone,
  type ScrambleChange,
  type ScrambleDrag,
  type ScrambleZone,
} from '@shared/lesson/scrambleOrder';

interface Press {
  pointerId: number;
  x: number;
  y: number;
  src: ScrambleDrag;
  el: HTMLElement;
}

export interface ScrambleDragState {
  src: ScrambleDrag;
  tile: number;
  zone: ScrambleZone;
  slot: number;
  /** The floating copy's top-left (client px) and size. */
  left: number;
  top: number;
  width: number;
  height: number;
}

function buzz() {
  try { navigator.vibrate?.(10); } catch { /* no haptics */ }
}

export function useScrambleDrag({
  order,
  tiles,
  disabled,
  onChange,
}: {
  order: number[];
  tiles: string[];
  disabled: boolean;
  onChange: (next: number[], change: ScrambleChange, fromPool: boolean) => void;
}) {
  const [drag, setDrag] = useState<ScrambleDragState | null>(null);
  const dragRef = useRef<ScrambleDragState | null>(null);
  const press = useRef<Press | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  const answerEl = useRef<HTMLElement | null>(null);
  const poolEl = useRef<HTMLElement | null>(null);
  const suppressClick = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const set = (next: ScrambleDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const measure = (src: ScrambleDrag, x: number, y: number): { zone: ScrambleZone; slot: number } => {
    const answer = answerEl.current?.getBoundingClientRect() ?? null;
    const pool = poolEl.current?.getBoundingClientRect() ?? null;
    const zone = scrambleZone(answer, pool, x, y);
    // The other placed tiles, in DOM (= preview) order — the gap itself is left out.
    const others = answerEl.current
      ? Array.from(answerEl.current.querySelectorAll<HTMLElement>('[data-scramble-placed]:not([data-scramble-gap])')).map(e => e.getBoundingClientRect())
      : [];
    const slot = zone === 'answer' ? scrambleDropSlot(others, x, y) : (dragRef.current?.slot ?? (src.from === 'answer' ? src.index : 0));
    return { zone, slot };
  };

  // The window listeners live for one press; one stable set (refs only inside), so add / remove always match.
  const listeners = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cancel: (e: PointerEvent) => void } | null>(null);
  if (!listeners.current) {
    const detach = () => {
      const l = listeners.current!;
      window.removeEventListener('pointermove', l.move);
      window.removeEventListener('pointerup', l.up);
      window.removeEventListener('pointercancel', l.cancel);
    };
    const finish = (commit: boolean) => {
      detach();
      press.current = null;
      const cur = dragRef.current;
      if (!cur) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 400);
      set(null);
      if (!commit) return;
      const result = scrambleDrop(orderRef.current, cur.src, cur.zone, cur.slot);
      buzz();
      if (result.change !== 'none') onChangeRef.current(result.order, result.change, cur.src.from === 'pool');
    };
    listeners.current = {
      move: (e: PointerEvent) => {
        const p = press.current;
        if (!p || e.pointerId !== p.pointerId) return;
        const cur = dragRef.current;
        if (!cur) {
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < SCRAMBLE_DRAG_START) return;
          // Lift: the copy starts exactly over the tile, so nothing jumps.
          const r = p.el.getBoundingClientRect();
          offset.current = { x: p.x - r.left, y: p.y - r.top };
          const start: ScrambleDragState = {
            src: p.src,
            tile: scrambleDragTile(orderRef.current, p.src),
            zone: p.src.from === 'answer' ? 'answer' : 'pool',
            slot: p.src.from === 'answer' ? p.src.index : orderRef.current.length,
            left: e.clientX - offset.current.x,
            top: e.clientY - offset.current.y,
            width: r.width,
            height: r.height,
          };
          dragRef.current = start;
          set({ ...start, ...measure(p.src, e.clientX, e.clientY) });
          buzz();
          return;
        }
        if (e.cancelable) e.preventDefault();
        set({ ...cur, ...measure(cur.src, e.clientX, e.clientY), left: e.clientX - offset.current.x, top: e.clientY - offset.current.y });
      },
      up: (e: PointerEvent) => { if (!press.current || e.pointerId === press.current.pointerId) finish(true); },
      cancel: (e: PointerEvent) => { if (!press.current || e.pointerId === press.current.pointerId) finish(false); },
    };
  }

  useEffect(() => () => {
    const l = listeners.current!;
    window.removeEventListener('pointermove', l.move);
    window.removeEventListener('pointerup', l.up);
    window.removeEventListener('pointercancel', l.cancel);
  }, []);

  /** Spread onto a tile button. */
  const tileProps = (src: ScrambleDrag) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (disabled || press.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      suppressClick.current = false;
      press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, src, el: e.currentTarget };
      const l = listeners.current!;
      window.addEventListener('pointermove', l.move, { passive: false });
      window.addEventListener('pointerup', l.up);
      window.addEventListener('pointercancel', l.cancel);
    },
    // A long press must not open the browser's context menu / text selection over a tile.
    onContextMenu: (e: ReactMouseEvent) => { if (press.current || dragRef.current) e.preventDefault(); },
  });

  /** True when this click is the release of a drag (ignore it). */
  const isDragClick = () => suppressClick.current;

  const preview = drag ? scramblePreview(order, drag.src, drag.zone, drag.slot) : order;

  const floatingStyle: CSSProperties | undefined = drag
    ? { left: drag.left, top: drag.top, width: drag.width, height: drag.height }
    : undefined;
  const floating = drag && typeof document !== 'undefined'
    ? createPortal(
        <div className="tile tile-floating" style={floatingStyle} aria-hidden="true" data-testid="scramble-floating-tile">
          {tiles[drag.tile]}
        </div>,
        document.body,
      )
    : null;

  return {
    drag,
    /** The answer row as it should look now (the dragged tile's place = the gap). */
    preview,
    answerRef: (el: HTMLElement | null) => { answerEl.current = el; },
    poolRef: (el: HTMLElement | null) => { poolEl.current = el; },
    answerElement: () => answerEl.current,
    tileProps,
    isDragClick,
    floating,
  };
}
