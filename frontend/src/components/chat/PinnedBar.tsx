import { useEffect, useState } from 'react';
import type { MessageWithSender } from '../../types';
import { lastMessagePreview } from '../../services/chatThread';

function preview(m: MessageWithSender): string {
  return lastMessagePreview({ content: m.content, attachment: m.attachment, deleted_at: m.deleted_at }) || 'Message';
}

/**
 * The newest pinned message in a slim bar under the header (tap → jump to it);
 * with more than one pin, the count opens the list of all of them.
 */
export function PinnedBar({ pinned, onJump }: { pinned: MessageWithSender[]; onJump: (id: string) => void }) {
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    if (!showList) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowList(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showList]);

  if (pinned.length === 0) return null;
  const top = pinned[0];

  return (
    <>
      <div className="chat-pinned-bar" data-testid="chat-pinned-bar">
        <button type="button" className="chat-pinned-main" onClick={() => onJump(top.id)}>
          <span className="chat-pinned-icon" aria-hidden="true">📌</span>
          <span className="chat-pinned-text">
            <span className="chat-pinned-label">Pinned · {top.sender.name || 'Unknown'}</span>
            <span className="chat-pinned-preview">{preview(top)}</span>
          </span>
        </button>
        {pinned.length > 1 && (
          <button type="button" className="chat-pinned-more" onClick={() => setShowList(true)} aria-label={`All ${pinned.length} pinned messages`}>
            {pinned.length} ⋯
          </button>
        )}
      </div>
      {showList && (
        <div className="modal-overlay" onClick={() => setShowList(false)}>
          <div className="modal chat-pins-modal" role="dialog" aria-label="Pinned messages" onClick={(e) => e.stopPropagation()}>
            <h3>Pinned messages</h3>
            <div className="chat-pins-list">
              {pinned.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chat-pins-item"
                  onClick={() => {
                    setShowList(false);
                    onJump(m.id);
                  }}
                >
                  <span className="chat-pinned-label">
                    {m.sender.name || 'Unknown'} · {new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="chat-pins-text">{preview(m)}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowList(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
