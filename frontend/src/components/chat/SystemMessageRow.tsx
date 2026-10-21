/**
 * A system message in the chat (docs/CHAT.md "System messages", shared/chats/system.ts):
 * a line the app posted on someone's behalf — "Minghui set your new cards to 2 a day
 * (+5 extra)", "Minghui started a video call · Join", "Jerome flagged 银行 for you".
 * A centred, muted row like the day pills — never a bubble: no ticks, reactions,
 * listening-mode hiding, read-aloud or word chips. Long-press / right-click = Copy.
 */
import { useRef, useState } from 'react';
import type { SystemMessageView } from '@shared/chats/system';

const LONG_PRESS_MS = 500;

export interface SystemMessageRowProps {
  view: SystemMessageView;
  /** "14:32" */
  time: string;
  onAction?: (path: string) => void;
  /** Long-press (touch) / right-click (mouse): the Copy menu at this point (null = a bottom sheet). */
  onMenu?: (anchor: { x: number; y: number } | null) => void;
}

export function SystemMessageRow({ view, time, onAction, onMenu }: SystemMessageRowProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(0);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return (
    <div
      className={`chat-system${view.quiet ? ' quiet' : ''}`}
      data-testid="chat-system-message"
      data-kind={view.kind}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' || !onMenu) return;
        clear();
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = null;
          fired.current = Date.now();
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(12);
          onMenu(null);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => {
        e.preventDefault();
        if (Date.now() - fired.current < 1000) return;
        onMenu?.({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="chat-system-card">
        <p className="chat-system-line">
          {view.icon && view.kind !== 'unknown' && (
            <span className="chat-system-icon" aria-hidden="true">
              {view.icon}
            </span>
          )}
          <span className="chat-system-text">{view.text}</span>
          <span className="chat-system-time">{time}</span>
        </p>
        {view.quote && <blockquote className="chat-system-quote">“{view.quote}”</blockquote>}
        {view.body && (
          <>
            {open && <p className="chat-system-body">{view.body}</p>}
            <button type="button" className="chat-system-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? 'Hide' : view.kind === 'install_howto' ? 'Show the steps' : 'More'}
            </button>
          </>
        )}
        {view.action && onAction && (
          <button
            type="button"
            className="chat-system-action"
            data-testid="chat-system-action"
            onClick={(e) => {
              e.stopPropagation();
              if (Date.now() - fired.current < 800) return;
              onAction(view.action!.path);
            }}
          >
            {view.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
