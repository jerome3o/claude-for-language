import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageWithSender } from '../../types';
import type { MessageTool, MessageToolId } from './messageTools';

interface MessageActionSheetProps {
  message: MessageWithSender;
  tools: MessageTool[];
  isOnline: boolean;
  /** Where the sheet was opened from; used to place the popover on wide screens. */
  anchor: DOMRect | null;
  quickEmojis: string[];
  recentEmojis: string[];
  allEmojis: string[];
  onAction: (id: MessageToolId) => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}

const POPOVER_QUERY = '(min-width: 640px)';
const POPOVER_WIDTH = 320;

/**
 * Per-message tools: a bottom sheet on phones, a popover anchored to the ⋯
 * button from 640px up. Reactions live at the top (quick row, expandable to
 * the full grid); every other tool is a 48px row. Tools that need the network
 * are disabled offline with a "Needs internet" hint.
 */
export function MessageActionSheet({
  message,
  tools,
  isOnline,
  anchor,
  quickEmojis,
  recentEmojis,
  allEmojis,
  onAction,
  onReact,
  onClose,
}: MessageActionSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [showAllEmojis, setShowAllEmojis] = useState(false);
  const [isPopover, setIsPopover] = useState(() => window.matchMedia(POPOVER_QUERY).matches);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(POPOVER_QUERY);
    const onChange = () => setIsPopover(mq.matches);
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

  // Place the popover under (or above) the anchor, kept inside the viewport.
  useLayoutEffect(() => {
    if (!isPopover || !anchor || !panelRef.current) {
      setPos(null);
      return;
    }
    const h = panelRef.current.offsetHeight;
    const margin = 8;
    let top = anchor.bottom + 4;
    if (top + h > window.innerHeight - margin) top = Math.max(margin, anchor.top - 4 - h);
    let left = anchor.right - POPOVER_WIDTH;
    if (left < margin) left = margin;
    if (left + POPOVER_WIDTH > window.innerWidth - margin) left = window.innerWidth - margin - POPOVER_WIDTH;
    setPos({ top, left });
  }, [isPopover, anchor, showAllEmojis, tools.length]);

  useEffect(() => {
    // Move focus into the dialog so keyboard users land on the first action.
    const first = panelRef.current?.querySelector<HTMLElement>('button');
    first?.focus();
  }, []);

  const preview = message.content.length > 90 ? message.content.slice(0, 90) + '…' : message.content;

  return (
    <div className="msg-sheet-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className={`msg-sheet ${isPopover ? 'popover' : ''}`}
        style={isPopover && pos ? { top: pos.top, left: pos.left, width: POPOVER_WIDTH } : undefined}
        role="dialog"
        aria-label="Message actions"
        onClick={(e) => e.stopPropagation()}
      >
        {!isPopover && <div className="msg-sheet-handle" aria-hidden="true" />}
        <div className="msg-sheet-preview">
          <span className="msg-sheet-preview-name">{message.sender.name || 'Unknown'}</span>
          <span className="msg-sheet-preview-text">{preview}</span>
        </div>

        <div className="msg-sheet-emojis">
          {quickEmojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="msg-sheet-emoji"
              onClick={() => onReact(emoji)}
              disabled={!isOnline}
              aria-label={`React ${emoji}`}
            >
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
        {!isOnline && <div className="msg-sheet-hint">Reactions need internet</div>}

        {showAllEmojis && (
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
          {tools
            .filter((t) => t.id !== 'react')
            .map((tool) => {
              const blocked = tool.needsInternet && !isOnline;
              return (
                <button
                  key={tool.id}
                  type="button"
                  className="msg-sheet-action"
                  onClick={() => onAction(tool.id)}
                  disabled={blocked}
                  data-tool={tool.id}
                >
                  <span className="msg-sheet-action-icon" aria-hidden="true">{tool.icon}</span>
                  <span className="msg-sheet-action-label">{tool.label}</span>
                  {blocked && <span className="msg-sheet-action-hint">Needs internet</span>}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
