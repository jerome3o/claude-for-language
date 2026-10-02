import { useEffect, useRef } from 'react';

/**
 * Search inside the open chat: the field, "3 of 12", ↑ older / ↓ newer.
 * Enter = next older match, Shift+Enter = newer, Escape closes.
 */
export function ChatSearchBar({
  query,
  onQuery,
  count,
  index,
  onOlder,
  onNewer,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  count: number;
  /** 0-based position in the matches (newest first). */
  index: number;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const hasQuery = query.trim().length > 0;
  return (
    <div className="chat-search-bar" role="search">
      <input
        ref={input}
        type="search"
        className="chat-search-input"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search this chat (汉字, pinyin, English)"
        aria-label="Search messages"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onNewer();
            else onOlder();
          }
        }}
      />
      <span className="chat-search-count" aria-live="polite" data-testid="chat-search-count">
        {hasQuery ? (count === 0 ? 'No matches' : `${index + 1} of ${count}`) : ''}
      </span>
      <button type="button" className="chat-search-nav" onClick={onOlder} disabled={count === 0 || index >= count - 1} aria-label="Older match">
        ↑
      </button>
      <button type="button" className="chat-search-nav" onClick={onNewer} disabled={count === 0 || index <= 0} aria-label="Newer match">
        ↓
      </button>
      <button type="button" className="chat-search-close" onClick={onClose} aria-label="Close search">
        ✕
      </button>
    </div>
  );
}
