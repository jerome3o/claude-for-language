/**
 * The call's tiles (shared/calls/layout.ts): every tile is ONE element that
 * stays mounted and is moved by its rectangle, so a video never restarts and
 * the board keeps its caret when the layout changes.
 *
 * - Double-click / double-tap a tile (or its ⤢) to focus it; the rail's tiles
 *   focus on a single tap.
 * - Split: drag the divider.
 * - Floating cameras: drag anywhere, they snap to the nearest corner; my own
 *   camera has a resize handle.
 * - Faces together (content on the stage): both cameras in one box — drag it,
 *   it snaps to a corner; resize with its handle; a tap (or Enter) → Speaker.
 *   The two camera tiles stay the same elements, only moved into the box.
 * - Phones: swipe left / right on the stage to move between tiles.
 */

import { useRef, type CSSProperties, type ReactNode } from 'react';
import {
  arrangeTiles,
  layoutRects,
  snapCorner,
  swipeFocus,
  type CallLayout,
  type LayoutAction,
  type TileAvailability,
  type TileId,
  type VideoSize,
} from '@shared/calls';
import { useElementSize } from './CallVideo';

export interface TileSpec {
  label: string;
  /** Rendered once; kept mounted. */
  content: ReactNode;
  /** Small overlay in the tile's corner (status badges etc). */
  closable?: boolean;
}

export function CallTiles({
  layout,
  dispatch,
  replace,
  available,
  tiles,
  aspects,
}: {
  layout: CallLayout;
  dispatch: (a: LayoutAction) => void;
  /** Replace the whole layout (phone swipe). */
  replace: (l: CallLayout) => void;
  available: TileAvailability;
  tiles: Partial<Record<TileId, TileSpec>>;
  aspects: Partial<Record<TileId, VideoSize | null>>;
}) {
  const [box, boxRef] = useElementSize<HTMLDivElement>();
  const boxEl = useRef<HTMLDivElement | null>(null);
  const width = box?.width ?? 0;
  const arr = arrangeTiles(layout, available, width || 1024);
  const ratios: Partial<Record<TileId, number>> = {};
  for (const [k, v] of Object.entries(aspects)) if (v && v.height) ratios[k as TileId] = v.width / v.height;
  const rects = box ? layoutRects(layout, arr, { w: box.width, h: box.height }, ratios) : null;
  const narrow = width > 0 && width < 640;
  const lastTap = useRef<{ tile: TileId; at: number } | null>(null);
  const els = useRef<Partial<Record<TileId | 'pair' | 'pairBg', HTMLDivElement | null>>>({});
  const swipe = useRef<{ x: number; y: number; at: number; lx: number; ly: number } | null>(null);

  const setRef = (el: HTMLDivElement | null) => {
    boxEl.current = el;
    boxRef(el);
  };

  // ---- divider drag
  const onDividerDown = (e: React.PointerEvent) => {
    if (!rects?.divider) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const stage = rects.stage;
    const dir = rects.divider.dir;
    const origin = boxEl.current?.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (!origin) return;
      const pos = dir === 'row' ? (ev.clientX - origin.left - stage.x) / stage.w : (ev.clientY - origin.top - stage.y) / stage.h;
      dispatch({ type: 'ratio', ratio: pos });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // ---- floating drag (snap to a corner) / resize
  const onFloatDown = (tile: TileId) => (e: React.PointerEvent) => {
    if (!rects || (e.target as HTMLElement).closest('button, .call-tile-resize')) return;
    const r = rects.tiles[tile];
    const el = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      el.style.transform = `translate(${r.x + dx}px, ${r.y + dy}px)`;
      el.style.transition = 'none';
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.style.transition = '';
      if (!moved) {
        tap(tile);
        return;
      }
      const cx = (r.x + ev.clientX - start.x + r.w / 2 - rects.stage.x) / rects.stage.w;
      const cy = (r.y + ev.clientY - start.y + r.h / 2 - rects.stage.y) / rects.stage.h;
      const corner = snapCorner(cx, cy);
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      dispatch(tile === 'self' ? { type: 'selfCorner', corner } : { type: 'remoteCorner', corner });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onResizeDown = (e: React.PointerEvent) => {
    if (!rects) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = rects.tiles.self;
    const startScale = layout.selfScale;
    const start = { x: e.clientX, y: e.clientY };
    const left = layout.selfCorner === 'tl' || layout.selfCorner === 'bl';
    const top = layout.selfCorner === 'tl' || layout.selfCorner === 'tr';
    const move = (ev: PointerEvent) => {
      // Dragging away from the tile's corner makes it bigger.
      const dx = (ev.clientX - start.x) * (left ? 1 : -1);
      const dy = (ev.clientY - start.y) * (top ? 1 : -1);
      const grow = Math.max(dx / r.w, dy / r.h);
      dispatch({ type: 'selfScale', scale: startScale * (1 + grow) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  // ---- the faces pair: drag the whole box (both faces move with it), snap on release; a tap → Speaker
  const pairParts = () => (['pairBg', 'pair', 'remote', 'self'] as const).map((k) => [k, els.current[k]] as const);
  const onPairDown = (e: React.PointerEvent) => {
    if (!rects?.pair || (e.target as HTMLElement).closest('.call-tile-resize')) return;
    const p = rects.pair;
    const base: Record<string, { x: number; y: number }> = {
      pairBg: p,
      pair: p,
      remote: rects.tiles.remote,
      self: rects.tiles.self,
    };
    const el = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const place = (dx: number, dy: number, animate: boolean) => {
      for (const [k, node] of pairParts()) {
        if (!node) continue;
        node.style.transition = animate ? '' : 'none';
        node.style.transform = `translate(${base[k].x + dx}px, ${base[k].y + dy}px)`;
      }
    };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      place(dx, dy, false);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!moved) {
        if (ev.type === 'pointerup') dispatch({ type: 'pairTap' });
        return;
      }
      const cx = (p.x + ev.clientX - start.x + p.w / 2 - rects.stage.x) / rects.stage.w;
      const cy = (p.y + ev.clientY - start.y + p.h / 2 - rects.stage.y) / rects.stage.h;
      place(0, 0, true); // springs to the (new) corner once the layout re-renders
      dispatch({ type: 'pairCorner', corner: snapCorner(cx, cy) });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onPairResizeDown = (e: React.PointerEvent) => {
    if (!rects?.pair) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const p = rects.pair;
    const startScale = layout.pairScale;
    const start = { x: e.clientX, y: e.clientY };
    const left = p.corner === 'tl' || p.corner === 'bl';
    const top = p.corner === 'tl' || p.corner === 'tr';
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) * (left ? 1 : -1);
      const dy = (ev.clientY - start.y) * (top ? 1 : -1);
      dispatch({ type: 'pairScale', scale: startScale * (1 + Math.max(dx / p.w, dy / p.h)) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  /** Double-tap → focus (single tap for a rail tile). */
  const tap = (tile: TileId) => {
    const role = rects?.tiles[tile].role;
    if (role === 'rail') {
      dispatch({ type: 'focus', tile });
      return;
    }
    const now = Date.now();
    if (lastTap.current && lastTap.current.tile === tile && now - lastTap.current.at < 350) {
      lastTap.current = null;
      dispatch({ type: 'focus', tile });
    } else lastTap.current = { tile, at: now };
  };

  // ---- phone swipe on the stage (touch events: pointer events get cancelled over a scrolling board)
  const onStageTouchStart = (e: React.TouchEvent) => {
    if (!narrow || e.touches.length !== 1) {
      swipe.current = null;
      return;
    }
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY, at: Date.now(), lx: t.clientX, ly: t.clientY };
  };
  const onStageTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (swipe.current && t) {
      swipe.current.lx = t.clientX;
      swipe.current.ly = t.clientY;
    }
  };
  const onStageTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !narrow) return;
    const dx = s.lx - s.x;
    const dy = s.ly - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.at < 1200) replace(swipeFocus(layout, available, dx < 0 ? 1 : -1));
  };

  const order: TileId[] = ['remote', 'screen', 'text', 'draw', 'chat', 'self'];
  return (
    <div className="call-tiles" ref={setRef} data-testid="call-tiles" data-mode={arr.mode} data-stage={arr.stage.join(',')}>
      {rects &&
        order.map((id) => {
          const spec = tiles[id];
          if (!spec) return null;
          const r = rects.tiles[id];
          const style: CSSProperties =
            r.role === 'hidden'
              ? { display: 'none' }
              : { transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h, zIndex: r.z };
          const focused = arr.mode === 'focus' && arr.stage[0] === id;
          return (
            <div
              key={id}
              ref={(el) => {
                els.current[id] = el;
              }}
              className={`call-tile role-${r.role} tile-${id}${focused ? ' focused' : ''}`}
              style={style}
              data-testid={`tile-${id}`}
              data-role={r.role}
              onPointerDown={r.role === 'floating' ? onFloatDown(id) : undefined}
              onTouchStart={r.role === 'stage' ? onStageTouchStart : undefined}
              onTouchMove={r.role === 'stage' ? onStageTouchMove : undefined}
              onTouchEnd={r.role === 'stage' ? onStageTouchEnd : undefined}
              onDoubleClick={r.role === 'stage' && (id === 'remote' || id === 'self' || id === 'screen') ? () => dispatch({ type: 'focus', tile: id }) : undefined}
              onClick={r.role === 'rail' ? () => tap(id) : undefined}
            >
              {spec.content}
              {r.role !== 'floating' && r.role !== 'pair' && (
                <div className="call-tile-chrome">
                  <span className="call-tile-name">{spec.label}</span>
                  {r.role === 'stage' && !focused && (
                    <button type="button" className="call-tile-btn" onClick={() => dispatch({ type: 'focus', tile: id })} aria-label={`Focus ${spec.label}`} title="Focus (double-click)">⤢</button>
                  )}
                  {r.role === 'stage' && spec.closable && (
                    <button type="button" className="call-tile-btn" onClick={() => dispatch({ type: 'close', tile: id })} aria-label={`Close ${spec.label}`} data-testid={`close-${id}`}>✕</button>
                  )}
                </div>
              )}
              {r.role === 'floating' && id === 'self' && <span className="call-tile-resize" onPointerDown={onResizeDown} aria-label="Resize" role="separator" />}
            </div>
          );
        })}
      {rects?.pair && (
        <>
          <div
            className="call-pair-bg"
            ref={(el) => {
              els.current.pairBg = el;
            }}
            style={{ transform: `translate(${rects.pair.x}px, ${rects.pair.y}px)`, width: rects.pair.w, height: rects.pair.h }}
            aria-hidden="true"
          />
          <div
            className={`call-pair corner-${rects.pair.corner}`}
            ref={(el) => {
              els.current.pair = el;
            }}
            style={{ transform: `translate(${rects.pair.x}px, ${rects.pair.y}px)`, width: rects.pair.w, height: rects.pair.h }}
            role="button"
            tabIndex={0}
            aria-label="Both cameras — drag to a corner, tap for the speaker view"
            title="Drag to a corner · click for the speaker view"
            data-testid="faces-pair"
            data-corner={rects.pair.corner}
            onPointerDown={onPairDown}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dispatch({ type: 'pairTap' });
              }
            }}
          >
            <span className="call-tile-resize" onPointerDown={onPairResizeDown} aria-label="Resize the cameras" role="separator" data-testid="faces-pair-resize" />
          </div>
        </>
      )}
      {rects?.divider && (
        <div
          className={`call-divider dir-${rects.divider.dir}`}
          style={{ transform: `translate(${rects.divider.x}px, ${rects.divider.y}px)`, width: rects.divider.w, height: rects.divider.h }}
          onPointerDown={onDividerDown}
          role="separator"
          aria-orientation={rects.divider.dir === 'row' ? 'vertical' : 'horizontal'}
          aria-label="Resize the two panes"
          data-testid="split-divider"
        >
          <span />
        </div>
      )}
    </div>
  );
}
