/**
 * The student's chats with Claude his tutor may read (docs/CHAT.md "Claude threads" → "What your tutor
 * sees"; `GET /api/relationships/:relId/claude-threads`): one row per chat — the context chip
 * ("📇 Asked on card · 银行" → her card hub view of the note; "🎭 Practice · 点菜", "📖 Reader · 小明在巴黎
 * p.3", "🧩 Exercise"), the title, the last line, when. A tap opens it read-only
 * (`/connections/:relId/claude/:id`). Used on the student page's "Asked Claude" section and on
 * `/connections/:relId/claude-chats`.
 */
import { Link, useNavigate } from 'react-router-dom';
import type { TutorClaudeThread } from '@shared/claude/api';
import { tutorEmptyText } from '@shared/claude/visibility';
import { relativeDay, plural } from './format';
import { cardHubPath } from '../cardFlags/paths';
import '../cardFlags/cardFlags.css';

export function studentClaudeThreadPath(relId: string, threadId: string, from: string): string {
  return `/connections/${encodeURIComponent(relId)}/claude/${encodeURIComponent(threadId)}?from=${from}`;
}

/** The empty list's words: what the student shares (never what he keeps). */
export const emptyClaudeText = tutorEmptyText;

export function StudentClaudeThreadList({
  threads,
  relId,
  emptyText,
  from,
}: {
  threads: TutorClaudeThread[];
  relId: string;
  emptyText: string;
  /** Where the list is (analytics): student_page | all_chats. */
  from: string;
}) {
  const navigate = useNavigate();
  if (threads.length === 0) return <div className="cf-empty" data-testid="student-claude-empty">{emptyText}</div>;
  return (
    <ul className="ct-list" data-testid="student-claude-threads">
      {threads.map((t) => {
        const noteId = t.context.kind === 'card' ? t.context.note_id : null;
        return (
          <li key={t.id} className="ct-thread" data-testid="student-claude-thread" data-context={t.context_kind}>
            <button type="button" className="ct-head" onClick={() => navigate(studentClaudeThreadPath(relId, t.id, from))}>
              <span className="ct-head-text">
                <span className="ct-preview" lang="zh">{t.title}</span>
                {t.preview && t.preview !== t.title && <span className="ct-card-line" lang="zh">{t.preview}</span>}
                <span className="ct-summary">
                  {relativeDay(t.last_message_at)} · {plural(t.message_count, 'message')}
                  {t.shared ? ' · 👁 shared with you' : ''}
                </span>
              </span>
              <span className="ct-toggle" aria-hidden="true">›</span>
            </button>
            {t.badge && (
              <div className="ct-badge-row">
                {noteId ? (
                  <Link to={cardHubPath(noteId, relId)} className="ct-badge" data-testid="student-claude-chip">
                    <span aria-hidden="true">{t.badge.icon}</span> {t.badge.text}
                  </Link>
                ) : (
                  <span className="ct-badge" data-testid="student-claude-chip">
                    <span aria-hidden="true">{t.badge.icon}</span> {t.badge.text}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
