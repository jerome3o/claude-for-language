import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyClaudeChats } from '../api/cardFlags';
import { getRelationship } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Loading, ErrorMessage } from '../components/Loading';
import { ClaudeThreadList, toThreads } from '../components/cardFlags/ClaudeThreads';
import { getOtherUserInRelationship } from '../types';
import type { ClaudeChatQuestion } from '../types/cardFlags';
import { plural } from '../components/tutor/format';
import { listStudentClaudeThreads } from '../api/claudeThreads';
import { StudentClaudeThreadList, emptyClaudeText } from '../components/tutor/StudentClaudeThreads';
import type { TutorClaudeThread } from '@shared/claude/api';
import '../components/cardFlags/cardFlags.css';

const PAGE = 100;

/**
 *   /claude-chats                       my Ask-Claude questions, grouped per card
 *   /connections/:relId/claude-chats    the tutor's view: the student's chats with Claude he lets her read
 */
export function ClaudeChatsPage() {
  const { relId } = useParams<{ relId?: string }>();
  // The tutor's view: the student's chats with Claude he lets her read (every context, read-only).
  if (relId) return <StudentClaudeChatsPage relId={relId} />;
  return <MyClaudeChatsPage />;
}

/** `/claude-chats`: every Ask-Claude question I asked on a card, grouped per card. */
function MyClaudeChatsPage() {
  const [extra, setExtra] = useState<ClaudeChatQuestion[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const firstPage = useQuery({ queryKey: ['claude-chats', 'me'], queryFn: () => listMyClaudeChats({ limit: PAGE }) });

  if (firstPage.isLoading) return <Loading />;
  if (firstPage.error || !firstPage.data) {
    return (
      <div className="page"><div className="container"><ErrorMessage message={firstPage.error instanceof Error ? firstPage.error.message : 'Could not load the conversations'} /></div></div>
    );
  }
  const data = firstPage.data;
  const nextCursor = cursor === undefined ? data.next_cursor : cursor;
  const threads = toThreads([...data.questions, ...extra]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listMyClaudeChats({ limit: PAGE, before: nextCursor });
      setExtra((prev) => [...prev, ...page.questions]);
      setCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <Link to="/more" className="back-link">‹ More</Link>
        <div className="ct-page-head">
          <h1>Claude conversations</h1>
          <span className="ct-page-count">{plural(data.total, 'question')} · {plural(threads.length, 'conversation')}{nextCursor ? ' so far' : ''}</span>
        </div>
        <ClaudeThreadList threads={threads} emptyText="Nothing yet. During study, tap Ask Claude on the back of a card — every question you ask is kept here." />
        {nextCursor && (
          <div className="ct-load-more">
            <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** `/connections/:relId/claude-chats`: every chat with Claude the student lets his tutor read, newest first. */
function StudentClaudeChatsPage({ relId }: { relId: string }) {
  const { user } = useAuth();
  const [extra, setExtra] = useState<TutorClaudeThread[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const firstPage = useQuery({ queryKey: ['student-claude-threads', relId, 'all'], queryFn: () => listStudentClaudeThreads(relId, { limit: PAGE }) });
  const relationshipQuery = useQuery({ queryKey: ['relationship', relId], queryFn: () => getRelationship(relId) });
  if (firstPage.isLoading) return <Loading />;
  if (firstPage.error || !firstPage.data) {
    return (
      <div className="page"><div className="container"><ErrorMessage message={firstPage.error instanceof Error ? firstPage.error.message : 'Could not load the chats'} /></div></div>
    );
  }
  const data = firstPage.data;
  const nextCursor = cursor === undefined ? data.next_cursor : cursor;
  const studentName = relationshipQuery.data && user ? getOtherUserInRelationship(relationshipQuery.data, user.id).name : null;
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listStudentClaudeThreads(relId, { limit: PAGE, before: nextCursor });
      setExtra((prev) => [...prev, ...page.threads]);
      setCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };
  return (
    <div className="page">
      <div className="container">
        <Link to={`/connections/${relId}`} className="back-link">‹ {studentName || 'Student'}</Link>
        <div className="ct-page-head">
          <h1>{studentName || 'Student'} asked Claude</h1>
          <span className="ct-page-count">{plural(data.total, 'chat')} shared with you</span>
        </div>
        <StudentClaudeThreadList threads={[...data.threads, ...extra]} relId={relId} from="all_chats" emptyText={emptyClaudeText(studentName, data.visibility)} />
        {nextCursor && (
          <div className="ct-load-more">
            <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
