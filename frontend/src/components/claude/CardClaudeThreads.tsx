/**
 * A card's Claude threads as a list (the card hub, the deck page's History modal): one row per
 * conversation about the card — its last words, when, how many replies are new — each opening the
 * thread itself (`/chats/claude/:id`). Read from the device's thread cache (offline), brought up to
 * date from the server on open.
 */
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { earlierCardThreads } from '@shared/claude/cardTools';
import { chatRelativeTime } from '@shared/chats/inbox';
import { refreshCardThreads, useCardThreads } from '../../services/cardClaudeThreads';
import { useNetwork } from '../../contexts/NetworkContext';
import '../claudeChat/claude-chat.css';

export function CardClaudeThreads({ noteId, hanzi, emptyText, onOpen }: { noteId: string; hanzi: string; emptyText?: string; onOpen?: () => void }) {
  const { isOnline } = useNetwork();
  const threads = useCardThreads(noteId);
  useEffect(() => {
    if (isOnline) void refreshCardThreads(noteId).catch(() => undefined);
  }, [noteId, isOnline]);
  const rows = useMemo(() => earlierCardThreads(threads ?? [], noteId, null), [threads, noteId]);
  if (threads === undefined) return null;
  if (rows.length === 0) {
    return emptyText ? <p className="text-light" data-testid="card-claude-threads-empty">{emptyText}</p> : null;
  }
  const offset = -new Date().getTimezoneOffset();
  return (
    <ul className="card-claude-threads" data-testid="card-claude-threads" aria-label={`Claude conversations about ${hanzi}`}>
      {rows.map((t) => (
        <li key={t.id}>
          <Link to={`/chats/claude/${encodeURIComponent(t.id)}`} className="card-claude-thread-row" onClick={onOpen} data-testid="card-claude-thread-row">
            <span className="card-claude-thread-main">
              <span className="card-claude-thread-title">💬 {t.preview || t.title}</span>
              <span className="card-claude-thread-meta">
                {chatRelativeTime(t.last_message_at ?? t.created_at, Date.now(), offset)}
                {t.unread > 0 ? ` · ${t.unread} new` : ''}
                {t.pending ? ' · Claude is writing…' : ''}
              </span>
            </span>
            <span className="card-claude-thread-open">Open conversation ›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default CardClaudeThreads;
