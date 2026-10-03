import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuActionId, MenuItem } from '@shared/chats/messageMenu';

export type MenuAnchor = { x: number; y: number } | null;

interface MessageMenuProps {
  /** Who wrote it + a line of it, at the top of the sheet. */
  senderName: string;
  preview: string;
  items: MenuItem[];
  reactions: boolean;
  isOnline: boolean;
  /** Right-click / hover ⋯ position: a popover there. Null (long-press) = a sheet on phones. */
  anchor: MenuAnchor;
  quickEmojis: string[];
  recentEmojis: string[];
  allEmojis: string[];
  /** Start with the full emoji grid open (the hover 😊 button). */
  emojiFirst?: boolean;
  onAction: (id: MenuActionId) => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}

const WIDE_QUERY = '(min-width: 640px)';
const POPOVER_WIDTH = 300;

/**
 * The message menu (docs/CHAT.md "Round 2"): the reaction bar on top, then the
 * actions `messageMenu` decides on. A bottom sheet on phones (long-press); a
 * popover at the pointer on wide screens (right-click, the hover ⋯ / 😊).
 * Actions needing the network are disabled offline with "Needs internet".
 */
export function MessageMenu({
  senderName,
  preview,
  items,
  reactions,
  isOnline,
  anchor,
  quickEmojis,
  recentEmojis,
  allEmojis,
  emojiFirst = false,
  onAction,
  onReact,
  onClose,
}: MessageMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [showAllEmojis, setShowAllEmojis] = useState(emojiFirst);
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const isPopover = wide && !!anchor;

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!isPopover || !anchor || !panelRef.current) {
      setPos(null);
      return;
    }
    const h = panelRef.current.offsetHeight;
    const m = 8;
    let top = anchor.y;
    if (top + h > window.innerHeight - m) top = Math.max(m, window.innerHeight - m - h);
    let left = anchor.x;
    if (left + POPOVER_WIDTH > window.innerWidth - m) left = Math.max(m, anchor.x - POPOVER_WIDTH);
    setPos({ top, left });
  }, [isPopover, anchor, showAllEmojis, items.length]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, []);

  const short = preview.length > 90 ? preview.slice(0, 90) + '…' : preview;

  return (
    <div
      className={`msg-sheet-overlay${isPopover ? ' popover' : ''}`}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`msg-sheet msg-menu ${isPopover ? 'popover' : ''}`}
        style={isPopover ? { top: pos?.top ?? anchor!.y, left: pos?.left ?? anchor!.x, width: POPOVER_WIDTH, visibility: pos ? 'visible' : 'hidden' } : undefined}
        role="dialog"
        aria-label="Message actions"
        data-testid="message-menu"
        onClick={(e) => e.stopPropagation()}
      >
        {!isPopover && <div className="msg-sheet-handle" aria-hidden="true" />}
        {!isPopover && (
          <div className="msg-sheet-preview">
            <span className="msg-sheet-preview-name">{senderName}</span>
            {short && <span className="msg-sheet-preview-text">{short}</span>}
          </div>
        )}

        {reactions && (
          <div className="msg-menu-reactions" data-testid="message-menu-reactions">
            {quickEmojis.map((emoji) => (
              <button key={emoji} type="button" className="msg-sheet-emoji" onClick={() => onReact(emoji)} disabled={!isOnline} aria-label={`React ${emoji}`}>
                {emoji}
              </button>
            ))}
            <button
              type="button"
              className="msg-sheet-emoji msg-sheet-emoji-more"
              onClick={() => setShowAllEmojis((v) => !v)}
              disabled={!isOnline}
              aria-label={showAllEmojis ? 'Fewer emojis' : 'More emojis'}
              aria-expanded={showAllEmojis}
            >
              {showAllEmojis ? '−' : '+'}
            </button>
          </div>
        )}
        {reactions && !isOnline && <div className="msg-sheet-hint">Reactions need internet</div>}
        {reactions && showAllEmojis && (
          <div className="msg-sheet-emoji-grid-wrap">
            {recentEmojis.length > 0 && (
              <>
                <div className="emoji-picker-section-label">Recent</div>
                <div className="msg-sheet-emoji-grid">
                  {recentEmojis.map((emoji) => (
                    <button key={`r-${emoji}`} type="button" className="msg-sheet-emoji" onClick={() => onReact(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="emoji-picker-section-label">All</div>
            <div className="msg-sheet-emoji-grid">
              {allEmojis.map((emoji) => (
                <button key={emoji} type="button" className="msg-sheet-emoji" onClick={() => onReact(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="msg-sheet-actions">
          {items.map((item) => {
            const blocked = item.needsInternet && !isOnline;
            return (
              <button
                key={item.id}
                type="button"
                className={`msg-sheet-action${item.danger ? ' danger' : ''}${item.active ? ' active' : ''}${item.id === 'say_better' ? ' say-better' : ''}`}
                onClick={() => onAction(item.id)}
                disabled={blocked}
                data-tool={item.id}
              >
                <span className="msg-sheet-action-icon" aria-hidden="true">{item.icon}</span>
                <span className="msg-sheet-action-label">{item.label}</span>
                {blocked && <span className="msg-sheet-action-hint">Needs internet</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
