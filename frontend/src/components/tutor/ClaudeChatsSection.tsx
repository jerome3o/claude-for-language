import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listStudentClaudeThreads } from '../../api/claudeThreads';
import { claudeChatsPath } from '../cardFlags/paths';
import { StudentClaudeThreadList, emptyClaudeText } from './StudentClaudeThreads';
import { plural } from './format';

const PREVIEW = 4;

/**
 * "Asked Claude" on the tutor's student page: the student's latest chats with Claude that he lets
 * her read (shared/claude/visibility.ts — card questions by default, plus any he shared), each with
 * its context chip, opened read-only; a link to all of them.
 */
export function ClaudeChatsSection({ relId, studentName, hideWhenEmpty = false }: { relId: string; studentName: string | null; /** A brand-new student: skip the section unless they have asked something. */ hideWhenEmpty?: boolean }) {
  const chatsQuery = useQuery({
    queryKey: ['student-claude-threads', relId, 'preview'],
    queryFn: () => listStudentClaudeThreads(relId, { limit: PREVIEW }),
    staleTime: 60_000,
  });
  const total = chatsQuery.data?.total ?? 0;
  if (hideWhenEmpty && total === 0) return null;

  return (
    <section className="detail-section" data-testid="claude-chats-section">
      <h2>✦ Asked Claude{total > 0 ? ` (${plural(total, 'chat')})` : ''}</h2>
      {chatsQuery.isLoading && <div className="cf-empty">Loading…</div>}
      {chatsQuery.isError && <div className="td-error">Could not load the Claude chats</div>}
      {chatsQuery.data && (
        <>
          <StudentClaudeThreadList
            threads={chatsQuery.data.threads}
            relId={relId}
            from="student_page"
            emptyText={emptyClaudeText(studentName, chatsQuery.data.visibility)}
          />
          {total > PREVIEW && (
            <p className="hub-more"><Link to={claudeChatsPath(relId)}>All chats ({total}) ›</Link></p>
          )}
        </>
      )}
    </section>
  );
}
