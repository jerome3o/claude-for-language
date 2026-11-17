/**
 * Card Claude threads as a list: one row per conversation about a card — its last words, when, how many
 * replies are new — each opening the thread itself (`/chats/claude/:id`). Read from the device's thread
 * cache (offline), brought up to date from the server on open.
 *   CardClaudeThreads     one card's (the card hub, the deck page's History modal)
 *   AllCardClaudeThreads  every card's, with the card on each row ("Claude conversations", `/claude-chats`)
 * The threads are the one store of a card's questions (docs/CHAT.md "Claude threads").
 */
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { earlierCardThreads } from '@shared/claude/cardTools';
import { chatRelativeTime } from '@shared/chats/inbox';
import { refreshAllCardThreads, refreshCardThreads, useAllCardThreads, useCardThreads } from '../../services/cardClaudeThreads';
import type { LocalClaudeThread } from '../../services/claudeThreads';
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
  return <CardThreadRows rows={rows} label={`Claude conversations about ${hanzi}`} emptyText={emptyText} onOpen={onOpen} />;
}

const at = (t: LocalClaudeThread) => {
  const v = Date.parse(t.last_message_at ?? t.created_at);
  return Number.isNaN(v) ? 0 : v;
};

/** Every card's Claude threads, newest first, each row naming its card. */
export function AllCardClaudeThreads({ emptyText }: { emptyText: string }) {
  const { isOnline } = useNetwork();
  const threads = useAllCardThreads();
  useEffect(() => {
    if (isOnline) void refreshAllCardThreads().catch(() => undefined);
  }, [isOnline]);
  const rows = useMemo(() => (threads ?? []).filter((t) => !t.archived).sort((a, b) => at(b) - at(a) || (a.id < b.id ? 1 : -1)), [threads]);
  if (threads === undefined) return null;
  return <CardThreadRows rows={rows} label="Claude conversations about your cards" emptyText={emptyText} showCard />;
}

function CardThreadRows({ rows, label, emptyText, onOpen, showCard = false }: { rows: LocalClaudeThread[]; label: string; emptyText?: string; onOpen?: () => void; showCard?: boolean }) {
  if (rows.length === 0) {
    return emptyText ? <p className="text-light" data-testid="card-claude-threads-empty">{emptyText}</p> : null;
  }
  const offset = -new Date().getTimezoneOffset();
  return (
    <ul className="card-claude-threads" data-testid="card-claude-threads" aria-label={label}>
      {rows.map((t) => {
        const card = showCard ? t.context.label : null;
        return (
          <li key={t.id}>
            <Link to={`/chats/claude/${encodeURIComponent(t.id)}`} className="card-claude-thread-row" onClick={onOpen} data-testid="card-claude-thread-row">
              {card && <span className="card-claude-thread-card" lang="zh">{card}</span>}
              <span className="card-claude-thread-main">
                <span className="card-claude-thread-title">💬 {t.preview || t.title}</span>
                <span className="card-claude-thread-meta">
                  {showCard && t.context.sublabel ? `${t.context.sublabel} · ` : ''}
                  {chatRelativeTime(t.last_message_at ?? t.created_at, Date.now(), offset)}
                  {t.unread > 0 ? ` · ${t.unread} new` : ''}
                  {t.pending ? ' · Claude is writing…' : ''}
                </span>
              </span>
              <span className="card-claude-thread-open">{showCard ? '›' : 'Open conversation ›'}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default CardClaudeThreads;
