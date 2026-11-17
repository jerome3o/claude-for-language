/**
 * `/chats/claude/:id` — one Claude thread (components/claude/ClaudeThreadView.tsx), immersive. `new`
 * starts a fresh one: `?context=card&note_id=` (+ `label`) for a card, else a plain chat;
 * `?text=&intent=check|explain|translate|ask` sends at once (the Coach's deep links; `&from_message=` =
 * "Open in Coach" from a chat message, whose stored check is the analysis with no Claude call), `?draft=`
 * only fills the box. Back goes where the learner came from (the Chats tab by default); opened from a
 * study card (`source=study_card`, the card's return path in services/studyResume.ts) it also says
 * "← Back to your card", and back returns to the card as it was.
 * `/coach/chat/:id` (the Coach's "💬 Ask Claude" chats — the same rows) redirects here.
 */
import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ClaudeContextSnapshot, ClaudeThreadContext } from '@shared/claude/context';
import { parseIntent } from '@shared/claude/context';
import { ClaudeThreadView } from '../components/claude/ClaudeThreadView';
import { moveRecapWords } from '../services/claudeChatRecap';
import { coachReturnPath, setCoachReturn } from '../services/studyResume';

export function ClaudeThreadPage() {
  const { id = 'new' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? null;
  // Opened from a study card: its way back (read once — the card clears it once he is back).
  // (A homework pass's card has no study path: back alone returns to it.)
  const fromCard = !!(location.state as { fromCard?: boolean } | null)?.fromCard;
  const [cardReturn] = useState(() => (params.get('source') === 'study_card' ? coachReturnPath() ?? (fromCard ? '' : null) : null));
  const backToCard = () => {
    const path = cardReturn;
    setCoachReturn(null);
    if (fromCard && window.history.length > 1) navigate(-1);
    else if (path) navigate(path);
    else navigate('/chats');
  };

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
    return id === 'new' && text && intent ? { text, intent, chatMessageId: params.get('from_message') } : null;
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
      onBack={() => (cardReturn !== null ? backToCard() : from ? navigate(from) : window.history.length > 1 ? navigate(-1) : navigate('/chats'))}
      onBackToCard={cardReturn !== null ? backToCard : undefined}
      onThreadCreated={(threadId) => {
        moveRecapWords('new', threadId);
        // A study card's thread keeps saying where it came from (back from a tool line remounts the page).
        navigate(`/chats/claude/${encodeURIComponent(threadId)}${cardReturn !== null ? '?source=study_card' : ''}`, { replace: true, state: location.state });
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
