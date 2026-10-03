import { useEffect, useState } from 'react';
import { getConversations, getMyRelationships } from '../../api/client';
import { getOtherUserInRelationship, type ConversationWithLastMessage } from '../../types';
import { describeError } from './InlineNotice';

export interface ForwardTarget {
  conversationId: string;
  relationshipId: string;
  label: string;
  sub: string | null;
}

/**
 * Forward to… (round 2 PR 3): every conversation I am in with a person (tutor
 * or student; not the Claude practice chats), newest first. Picking one sends
 * the message(s) there as forwarded copies.
 */
export function ForwardSheet({ myId, count, currentConversationId, onPick, onClose }: { myId: string; count: number; currentConversationId?: string; onPick: (t: ForwardTarget) => void; onClose: () => void }) {
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rels = await getMyRelationships();
        const all = [...rels.tutors, ...rels.students];
        const lists = await Promise.all(
          all.map(async (rel) => {
            const convs: ConversationWithLastMessage[] = await getConversations(rel.id).catch(() => []);
            const other = getOtherUserInRelationship(rel, myId);
            return convs
              .filter((cv) => !cv.is_ai_conversation)
              .map((cv) => ({
                conversationId: cv.id,
                relationshipId: rel.id,
                label: other.name || other.email || 'Someone',
                sub: cv.title || null,
                at: cv.last_message_at || cv.created_at || '',
              }));
          }),
        );
        const flat = lists.flat().sort((a, b) => (a.at < b.at ? 1 : -1));
        if (live) setTargets(flat.map(({ at: _at, ...t }) => t));
      } catch (err) {
        if (live) setError(describeError(err, "Couldn't load your conversations."));
      }
    })();
    return () => {
      live = false;
    };
  }, [myId]);

  return (
    <div className="msg-sheet-overlay" onClick={onClose}>
      <div className="msg-sheet chat-forward-sheet" role="dialog" aria-label="Forward to" data-testid="chat-forward-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="msg-sheet-handle" aria-hidden="true" />
        <div className="msg-sheet-preview">
          <span className="msg-sheet-preview-name">Forward {count > 1 ? `${count} messages` : 'message'} to…</span>
        </div>
        {!targets && !error && (
          <div className="chat-explain-loading" role="status">
            <span className="chat-spinner" aria-hidden="true" /> Loading…
          </div>
        )}
        {error && <div className="chat-explain-error" role="alert">{error}</div>}
        <div className="msg-sheet-actions">
          {targets?.map((t) => (
            <button key={t.conversationId} type="button" className="msg-sheet-action" onClick={() => onPick(t)}>
              <span className="msg-sheet-action-icon" aria-hidden="true">💬</span>
              <span className="msg-sheet-action-label">
                {t.label}
                {t.sub && <span className="chat-forward-sub"> · {t.sub}</span>}
                {t.conversationId === currentConversationId && <span className="chat-forward-sub"> · this chat</span>}
              </span>
            </button>
          ))}
          {targets && targets.length === 0 && <div className="chat-explain-tip">No other conversations yet.</div>}
        </div>
      </div>
    </div>
  );
}
