/**
 * `/chats/claude/:id` — one Claude thread (components/claude/ClaudeThreadView.tsx), immersive. `new`
 * starts a fresh one: `?context=card&note_id=` (+ `label`) for a card, else a plain chat;
 * `?text=&intent=check|explain|translate|ask` sends at once (the Coach's deep links), `?draft=`
 * only fills the box. Back goes where the learner came from (the Coach by default).
 * `/coach/chat/:id` (the Coach's "💬 Ask Claude" chats — the same rows) redirects here.
 */
import { useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ClaudeContextSnapshot, ClaudeThreadContext } from '@shared/claude/context';
import { parseIntent } from '@shared/claude/context';
import { ClaudeThreadView } from '../components/claude/ClaudeThreadView';
import { moveRecapWords } from '../services/claudeChatRecap';

export function ClaudeThreadPage() {
  const { id = 'new' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? null;

  const newContext = useMemo<(ClaudeThreadContext & ClaudeContextSnapshot) | undefined>(() => {
    if (id !== 'new') return undefined;
    const label = params.get('label') || undefined;
    if (params.get('context') === 'card' && params.get('note_id')) return { kind: 'card', note_id: params.get('note_id')!, ...(label ? { label } : {}) };
    if (params.get('context') === 'chat_message' && params.get('message_id')) {
      const conversationId = params.get('conversation_id');
      return { kind: 'chat_message', message_id: params.get('message_id')!, ...(conversationId ? { conversation_id: conversationId } : {}), ...(label ? { label } : {}) };
    }
    return { kind: 'general' };
  }, [id, params]);
  const autoSend = useMemo(() => {
    const text = params.get('text')?.trim();
    const intent = parseIntent(params.get('intent'));
    return id === 'new' && text && intent ? { text, intent } : null;
  }, [id, params]);

  return (
    <ClaudeThreadView
      key={id === 'new' ? 'new' : 'thread'}
      threadId={id}
      newContext={newContext}
      autoSend={autoSend}
      initialDraft={params.get('draft') ?? undefined}
      source={params.get('source') ?? (id === 'new' ? 'coach' : 'link')}
      hasSentence={params.get('has_sentence') === '1'}
      onBack={() => (from ? navigate(from) : window.history.length > 1 ? navigate(-1) : navigate('/coach'))}
      onThreadCreated={(threadId) => {
        moveRecapWords('new', threadId);
        navigate(`/chats/claude/${encodeURIComponent(threadId)}`, { replace: true, state: location.state });
      }}
    />
  );
}

/** `/coach/chat/:id` → `/chats/claude/:id` (a coach conversation IS a Claude thread: same id). */
export function CoachChatRedirect() {
  const { id = 'new' } = useParams<{ id: string }>();
  return <Navigate to={`/chats/claude/${encodeURIComponent(id)}`} replace />;
}

export default ClaudeThreadPage;
