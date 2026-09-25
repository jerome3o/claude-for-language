import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyClaudeChats, listStudentClaudeChats } from '../api/cardFlags';
import { getRelationship } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Loading, ErrorMessage } from '../components/Loading';
import { ClaudeThreadList, toThreads } from '../components/cardFlags/ClaudeThreads';
import { getOtherUserInRelationship } from '../types';
import type { ClaudeChatQuestion } from '../types/cardFlags';
import { plural } from '../components/tutor/format';
import '../components/cardFlags/cardFlags.css';

const PAGE = 100;

/**
 * Every Ask-Claude conversation, newest first, grouped into threads per card.
 *   /claude-chats                       the student's own
 *   /connections/:relId/claude-chats    the tutor's view of a student's
 */
export function ClaudeChatsPage() {
  const { relId } = useParams<{ relId?: string }>();
  const { user } = useAuth();
  const tutorView = !!relId;
  const [extra, setExtra] = useState<ClaudeChatQuestion[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const firstPage = useQuery({
    queryKey: ['claude-chats', relId ?? 'me'],
    queryFn: () => (relId ? listStudentClaudeChats(relId, { limit: PAGE }) : listMyClaudeChats({ limit: PAGE })),
  });
  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: tutorView,
  });

  if (firstPage.isLoading) return <Loading />;
  if (firstPage.error || !firstPage.data) {
    return (
      <div className="page"><div className="container"><ErrorMessage message={firstPage.error instanceof Error ? firstPage.error.message : 'Could not load the conversations'} /></div></div>
    );
  }
  const data = firstPage.data;
  const nextCursor = cursor === undefined ? data.next_cursor : cursor;
  const questions = [...data.questions, ...extra];
  const threads = toThreads(questions);
  const studentName = tutorView && relationshipQuery.data && user ? getOtherUserInRelationship(relationshipQuery.data, user.id).name : null;

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = relId
        ? await listStudentClaudeChats(relId, { limit: PAGE, before: nextCursor })
        : await listMyClaudeChats({ limit: PAGE, before: nextCursor });
      setExtra((prev) => [...prev, ...page.questions]);
      setCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <Link to={tutorView ? `/connections/${relId}` : '/more'} className="back-link">{tutorView ? `‹ ${studentName || 'Student'}` : '‹ More'}</Link>
        <div className="ct-page-head">
          <h1>{tutorView ? `${studentName || 'Student'} asked Claude` : 'Claude conversations'}</h1>
          <span className="ct-page-count">{plural(data.total, 'question')} · {plural(threads.length, 'conversation')}{nextCursor ? ' so far' : ''}</span>
        </div>
        <ClaudeThreadList
          threads={threads}
          relId={relId}
          emptyText={tutorView ? `${studentName || 'The student'} has not asked Claude about any card yet.` : 'Nothing yet. During study, tap Ask Claude on the back of a card — every question you ask is kept here.'}
        />
        {nextCursor && (
          <div className="ct-load-more">
            <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
