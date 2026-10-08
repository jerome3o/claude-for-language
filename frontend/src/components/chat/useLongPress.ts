import { useCallback, useEffect, useRef } from 'react';

/** How long a touch must be held to open a message's menu (the chat's LONG_PRESS_MS). */
export const LONG_PRESS_MS = 500;
/** A finger that moves further than this is scrolling, not pressing. */
const MOVE_TOLERANCE_PX = 10;
/** A tap this soon after a long press belongs to the press (the menu opened), not to a word. */
const SUPPRESS_TAP_MS = 600;

/**
 * Long-press on a message bubble (touch / pen; a mouse right-clicks instead) — the chat's
 * gesture for the message menu, as a hook for message lists outside the chat page (Ask Claude
 * on the study card). `bind(onLongPress)` gives the pointer handlers for one bubble;
 * `suppressTap()` is true right after a long press fired, so word chips ignore the tap that
 * ends it.
 */
export function useLongPress(ms = LONG_PRESS_MS) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const firedAt = useRef(0);

  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => {
    return clear;
  }, [clear]);

  const bind = useCallback(
    (onLongPress: () => void) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse') return;
        clear();
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = null;
          firedAt.current = Date.now();
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(12);
          onLongPress();
        }, ms);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const s = start.current;
        if (s && (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE_PX)) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
    }),
    [clear, ms],
  );

  const suppressTap = useCallback(() => Date.now() - firedAt.current < SUPPRESS_TAP_MS, []);

  return { bind, suppressTap };
}
