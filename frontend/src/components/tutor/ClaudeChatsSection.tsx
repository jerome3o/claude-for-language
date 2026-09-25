import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listStudentClaudeChats } from '../../api/cardFlags';
import { ClaudeThreadList, toThreads } from '../cardFlags/ClaudeThreads';
import { claudeChatsPath } from '../cardFlags/paths';
import { plural } from './format';

const PREVIEW = 4;

/**
 * "Asked Claude" on the tutor's student page: the student's latest
 * conversations with Claude about their cards (what they are curious or
 * confused about), with a link to the full list.
 */
export function ClaudeChatsSection({ relId, studentName, hideWhenEmpty = false }: { relId: string; studentName: string | null; /** A brand-new student: skip the section unless they have asked something. */ hideWhenEmpty?: boolean }) {
  const chatsQuery = useQuery({
    queryKey: ['claude-chats', relId, 'preview'],
    queryFn: () => listStudentClaudeChats(relId, { limit: 40 }),
    staleTime: 60_000,
  });
  const threads = chatsQuery.data ? toThreads(chatsQuery.data.questions) : [];
  const total = chatsQuery.data?.total ?? 0;
  if (hideWhenEmpty && total === 0) return null;

  return (
    <section className="detail-section" data-testid="claude-chats-section">
      <h2>💬 Asked Claude{total > 0 ? ` (${plural(total, 'question')})` : ''}</h2>
      {chatsQuery.isLoading && <div className="cf-empty">Loading…</div>}
      {chatsQuery.isError && <div className="td-error">Could not load the Claude conversations</div>}
      {chatsQuery.data && (
        <>
          <ClaudeThreadList
            threads={threads.slice(0, PREVIEW)}
            relId={relId}
            emptyText={`${studentName || 'The student'} has not asked Claude about a card yet.`}
          />
          {threads.length > 0 && (
            <p className="hub-more"><Link to={claudeChatsPath(relId)}>All conversations{total > 0 ? ` (${total})` : ''} ›</Link></p>
          )}
        </>
      )}
    </section>
  );
}
