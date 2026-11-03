/**
 * `/connections/:relId/claude/:threadId` — the tutor reads one of her student's chats with Claude,
 * read-only (docs/CHAT.md "Claude threads" → "What your tutor sees"): the same thread view the student
 * has (components/claude/ClaudeThreadView.tsx `tutorView`), without a composer. Only a chat he lets
 * her read loads; anything else is "not found" (the server never says which). Immersive; ← goes back.
 */
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudentClaudeThread } from '../../api/claudeThreads';
import { getRelationship } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { getOtherUserInRelationship } from '../../types';
import { ClaudeThreadView } from '../../components/claude/ClaudeThreadView';
import { Loading } from '../../components/Loading';
import '../../components/claudeChat/claude-chat.css';

export function StudentClaudeThreadPage() {
  const { relId = '', threadId = '' } = useParams<{ relId: string; threadId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const threadQuery = useQuery({
    queryKey: ['student-claude-thread', relId, threadId],
    queryFn: () => getStudentClaudeThread(relId, threadId),
    retry: false,
  });
  const relationshipQuery = useQuery({ queryKey: ['relationship', relId], queryFn: () => getRelationship(relId) });
  const studentName = relationshipQuery.data && user ? getOtherUserInRelationship(relationshipQuery.data, user.id).name : null;
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(`/connections/${encodeURIComponent(relId)}`));

  if (threadQuery.isLoading) return <Loading />;
  if (!threadQuery.data) {
    return (
      <div className="claude-chat-page" data-testid="student-claude-thread-missing">
        <header className="claude-chat-header">
          <button type="button" className="claude-chat-back" onClick={back} aria-label="Back">
            ←
          </button>
          <div className="claude-chat-title">Chat with Claude</div>
        </header>
        <main className="claude-chat-body">
          <p className="claude-chat-empty">This chat isn’t shared with you (or it was deleted).</p>
        </main>
      </div>
    );
  }
  return (
    <ClaudeThreadView
      threadId={threadQuery.data.thread.id}
      tutorView={{ relId, studentName, thread: threadQuery.data.thread, messages: threadQuery.data.messages }}
      source={params.get('from') ?? 'student_page'}
      onBack={back}
    />
  );
}

export default StudentClaudeThreadPage;
