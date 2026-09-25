import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { replyToCardFlag, resolveCardFlag, reopenCardFlag, deleteCardFlag } from '../../api/cardFlags';
import type { CardFlag } from '../../types/cardFlags';
import { relativeDay } from '../tutor/format';
import { cardHubPath } from './paths';
import './cardFlags.css';

/**
 * Flags as a list: the card (a link to its hub page), the student's note,
 * the tutor's reply. The tutor gets an inline reply box and Resolve; the
 * student can delete a flag they sent. `relId` decides which hub page the
 * card links to (the tutor's view when set) and `role` which controls show.
 */
export function CardFlagsList({
  flags,
  role,
  relId,
  showCard = true,
  emptyText = 'No flagged cards.',
  onChanged,
}: {
  flags: CardFlag[];
  role: 'tutor' | 'student';
  /** Set for the tutor's view: card links go through the relationship. */
  relId?: string | null;
  /** Hide the card line when the list is already on that card's page. */
  showCard?: boolean;
  emptyText?: string;
  onChanged?: () => void;
}) {
  if (flags.length === 0) return <div className="cf-empty">{emptyText}</div>;
  return (
    <ul className="cf-list" data-testid="card-flags-list">
      {flags.map((flag) => (
        <CardFlagRow key={flag.id} flag={flag} role={role} relId={relId} showCard={showCard} onChanged={onChanged} />
      ))}
    </ul>
  );
}

function CardFlagRow({
  flag,
  role,
  relId,
  showCard,
  onChanged,
}: {
  flag: CardFlag;
  role: 'tutor' | 'student';
  relId?: string | null;
  showCard: boolean;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    qc.invalidateQueries({ queryKey: ['card-flags'] });
    qc.invalidateQueries({ queryKey: ['note-hub'] });
    qc.invalidateQueries({ queryKey: ['student-overview'] });
    qc.invalidateQueries({ queryKey: ['tutor-dashboard'] });
    onChanged?.();
  };
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong');

  const replyMutation = useMutation({
    mutationFn: () => replyToCardFlag(flag.id, reply),
    onSuccess: () => {
      setReply('');
      setReplying(false);
      done();
    },
    onError: fail,
  });
  const resolveMutation = useMutation({
    mutationFn: () => (flag.status === 'open' ? resolveCardFlag(flag.id) : reopenCardFlag(flag.id)),
    onSuccess: done,
    onError: fail,
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteCardFlag(flag.id),
    onSuccess: done,
    onError: fail,
  });

  const busy = replyMutation.isPending || resolveMutation.isPending || deleteMutation.isPending;
  const who = role === 'tutor' ? flag.student_name || 'Student' : 'You';

  return (
    <li className={`cf-row cf-row-${flag.status}`} data-testid="card-flag">
      {showCard && (
        <Link to={cardHubPath(flag.note_id, relId)} className="cf-card">
          <span className="cf-hanzi" lang="zh">{flag.hanzi}</span>
          <span className="cf-card-text">
            <span className="cf-pinyin">{flag.pinyin}</span>
            <span className="cf-english">{flag.english}</span>
          </span>
          <span className="cf-chevron" aria-hidden="true">›</span>
        </Link>
      )}
      <div className="cf-meta">
        <span className={`cf-status cf-status-${flag.status}`}>{flag.status === 'open' ? 'Waiting for a reply' : flag.tutor_reply ? 'Replied' : 'Resolved'}</span>
        <span className="cf-when">{who} flagged it {relativeDay(flag.created_at)}{showCard ? ` · ${flag.deck_name}` : ''}</span>
      </div>
      <p className="cf-message">{flag.message}</p>
      {flag.tutor_reply && (
        <p className="cf-reply">
          <span className="cf-reply-from">{role === 'student' ? flag.tutor_name || 'Your tutor' : 'You'} replied{flag.replied_at ? ` ${relativeDay(flag.replied_at)}` : ''}:</span>{' '}
          {flag.tutor_reply}
        </p>
      )}
      {error && <div className="cf-error" role="alert">{error}</div>}
      <div className="cf-actions">
        {role === 'tutor' && (replying ? (
          <div className="cf-reply-form">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={`Reply to ${flag.student_name || 'the student'} — they see it on the back of this card`}
              rows={2}
              maxLength={2000}
              autoFocus
              data-testid="card-flag-reply-input"
            />
            <div className="cf-reply-buttons">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReplying(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => replyMutation.mutate()} disabled={busy || !reply.trim()} data-testid="card-flag-reply-send">
                {replyMutation.isPending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setReplying(true)} disabled={busy} data-testid="card-flag-reply">
            {flag.tutor_reply ? 'Reply again' : 'Reply'}
          </button>
        ))}
        {!replying && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => resolveMutation.mutate()} disabled={busy}>
            {flag.status === 'open' ? 'Resolve' : 'Reopen'}
          </button>
        )}
        {role === 'student' && !replying && (
          <button
            type="button"
            className="btn btn-secondary btn-sm cf-delete"
            onClick={() => {
              if (confirm('Delete this flag? Your tutor keeps the chat message.')) deleteMutation.mutate();
            }}
            disabled={busy}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
