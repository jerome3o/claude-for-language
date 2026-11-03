/**
 * "💬 Ask Claude" — a plain chat with Claude from the Sentence Coach (`/coach/chat/:id`, `new` for a
 * fresh one; immersive; docs/CHAT.md "Ask Claude chat"). Backed by a coach conversation of kind
 * 'ask' whose replies are written in the background (leaving never loses one; the page polls while
 * a reply is pending). The screen is the context-agnostic pieces in components/claudeChat: the
 * thread (word chips → explorer, ▶, 拼 / EN, 🎧 Listen first, 🎤 Read it back) and the minimal
 * voice-first composer. Header: ← Coach, the title, 🎧, 中文 | EN (the account's Ask Claude
 * settings), ⋯ → Make flashcards from this chat (the tapped words ticked) and the words to recap
 * (coming soon).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  askCardChecked,
  recapCountLabel,
  recapFocusWords,
  COACH_ASK_EMPTY_EN,
  COACH_ASK_HINT,
  COACH_ASK_ICON,
  COACH_ASK_LABEL,
  COACH_ASK_THINKING_EN,
  COACH_ASK_THINKING_ZH,
  RECAP_COMING_SOON,
} from '@shared/coach/askChat';
import { revealedWhenListeningOn } from '@shared/study/askClaude';
import {
  apiErrorStatus,
  getCoachConversation,
  proposeCoachFlashcards,
  retryCoachReply,
  sendCoachMessage,
  startCoachAsk,
  translateCoachMessage,
} from '../api/client';
import type { CoachConversation, CoachMessage } from '../types';
import { ClaudeChatThread, type ClaudeChatMessage } from '../components/claudeChat/ClaudeChatThread';
import { ClaudeChatComposer } from '../components/claudeChat/ClaudeChatComposer';
import { MakeFlashcardsSheet } from '../components/chat/MakeFlashcardsSheet';
import { useAskLanguage } from '../services/askClaudeLanguage';
import { getAskRevealed, setAskRevealed, useAskListening } from '../services/askClaudeListening';
import { moveRecapWords, useRecapWords } from '../services/claudeChatRecap';
import { useNetwork } from '../contexts/NetworkContext';
import { track, trackError } from '../services/analytics';
import '../components/claudeChat/claude-chat.css';

type Thread = { conversation: CoachConversation; messages: CoachMessage[] };

/** Coach messages → the thread's plain messages (only text: an Ask chat has nothing else). */
export function toClaudeChatMessages(messages: CoachMessage[]): ClaudeChatMessage[] {
  return messages
    .filter((m) => m.content_type === 'text')
    .map((m) => ({ id: m.id, role: m.role, text: m.content, answer_lang: m.answer_lang ?? null, status: m.status ?? null, error: m.error ?? null, translation: m.translation ?? null }));
}

function errorText(err: unknown): string {
  const status = apiErrorStatus(err);
  if (status === undefined) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? "You're offline — Claude needs a connection. Your message is kept; send it again when you're back online."
      : "Couldn't send that — the connection dropped. Try again.";
  }
  const message = err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : '';
  return message || "Couldn't send that — try again.";
}

export function ClaudeChatPage() {
  const { id: routeId = 'new' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOnline } = useNetwork();
  const [language, setLanguage] = useAskLanguage();
  const [listening, setListening] = useAskListening();
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [addedNote, setAddedNote] = useState<string | null>(null);
  const isNew = routeId === 'new';
  const recap = useRecapWords(routeId);

  const query = useQuery({
    queryKey: ['coach-conversation', routeId],
    queryFn: () => getCoachConversation(routeId),
    enabled: !isNew,
    // A reply still being written in the background: look again every few seconds until it lands.
    refetchInterval: (q) => (q.state.data?.messages.some((m) => m.status === 'pending') ? 2500 : false),
  });
  const data = query.data;
  const messages = useMemo(() => toClaudeChatMessages(data?.messages ?? []), [data]);
  const replyPending = messages.some((m) => m.status === 'pending');

  // How long a reply takes to land on screen (Jerome: "the first message is slow").
  const sentAt = useRef<Map<string, { at: number; first: boolean }>>(new Map());
  useEffect(() => {
    for (const m of messages) {
      const s = sentAt.current.get(m.id);
      if (!s || m.status === 'pending') continue;
      sentAt.current.delete(m.id);
      if (!m.status) track('coach.ask_reply', { ms: Date.now() - s.at, first: s.first, language: m.answer_lang ?? language });
    }
  }, [messages, language]);
  const rememberPending = (msgs: CoachMessage[], first: boolean) => {
    const pending = msgs.find((m) => m.status === 'pending');
    if (pending) sentAt.current.set(pending.id, { at: Date.now(), first });
  };

  const startMutation = useMutation({
    mutationFn: (text: string) => startCoachAsk(text, language),
    onSuccess: (res) => {
      track('coach.ask_start', { language });
      rememberPending(res.messages, true);
      queryClient.setQueryData<Thread>(['coach-conversation', res.conversation.id], res);
      queryClient.invalidateQueries({ queryKey: ['coach-conversations'] });
      moveRecapWords('new', res.conversation.id);
      setDraft('');
      navigate(`/coach/chat/${encodeURIComponent(res.conversation.id)}`, { replace: true });
    },
    onError: (err) => trackError('coach_ask_start', err),
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => sendCoachMessage(routeId, text, { language }),
    onSuccess: (res) => {
      rememberPending(res.messages, false);
      queryClient.setQueryData<Thread>(['coach-conversation', routeId], (prev) => (prev ? { ...prev, messages: [...prev.messages, ...res.messages] } : prev));
      queryClient.invalidateQueries({ queryKey: ['coach-conversations'] });
      setDraft('');
    },
    onError: (err) => {
      trackError('coach_ask_message', err);
      // 409: a reply is still being written — pick it up.
      if (apiErrorStatus(err) === 409) void query.refetch();
    },
  });

  const retryMutation = useMutation({
    mutationFn: (messageId: string) => retryCoachReply(routeId, messageId),
    onSuccess: (res, messageId) => {
      track('coach.reply_retry');
      sentAt.current.set(messageId, { at: Date.now(), first: false });
      queryClient.setQueryData(['coach-conversation', routeId], res);
    },
    onError: (err) => trackError('coach_reply_retry', err),
  });

  const busy = startMutation.isPending || sendMutation.isPending || replyPending;
  const send = (text: string, spoken: boolean) => {
    const msg = text.trim();
    if (!msg || busy) return;
    track('coach.ask_message', { language, spoken });
    if (isNew) startMutation.mutate(msg);
    else sendMutation.mutate(msg);
  };

  const translate = async (m: ClaudeChatMessage): Promise<string | null> => {
    try {
      const res = await translateCoachMessage(routeId, m.id);
      queryClient.setQueryData<Thread>(['coach-conversation', routeId], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((x) => (x.id === m.id ? { ...x, translation: res.translation } : x)) } : prev);
      return res.translation;
    } catch (err) {
      trackError('coach_ask_translate', err);
      return null;
    }
  };

  const toggleListening = () => {
    const on = !listening;
    // History stays: what is on screen now keeps showing, anything newer hides.
    if (on) setAskRevealed(revealedWhenListeningOn(messages.filter((m) => m.role === 'assistant').map((m) => ({ id: m.id, answer: m.text, answer_lang: m.answer_lang ?? null })), getAskRevealed()));
    navigator.vibrate?.(10);
    track('coach.ask_tool', { action: on ? 'listening_on' : 'listening_off', role: 'claude' });
    void setListening(on, 'sheet');
  };

  const sendError = startMutation.error ?? sendMutation.error ?? retryMutation.error;
  const pendingText = startMutation.isPending ? startMutation.variables : sendMutation.isPending ? sendMutation.variables : null;
  const empty = messages.length === 0 && !pendingText;
  const hasClaude = messages.some((m) => m.role === 'assistant' && !m.status);

  return (
    <div className="claude-chat-page" data-testid="claude-chat-page">
      <header className="claude-chat-header">
        <button type="button" className="claude-chat-back" onClick={() => navigate('/coach')} aria-label="Back to the Coach" data-testid="claude-chat-back">
          ←
        </button>
        <div className="claude-chat-title" data-testid="claude-chat-title">
          {COACH_ASK_ICON} {data?.conversation.title || COACH_ASK_LABEL}
        </div>
        <button
          type="button"
          className={`ask-listen-toggle${listening ? ' on' : ''}`}
          aria-pressed={listening}
          aria-label={listening ? 'Listen first is on: answers arrive hidden. Turn off' : 'Listen first: hear the answer before you read it'}
          title={listening ? 'Listen first: on' : 'Listen first'}
          onClick={toggleListening}
          data-testid="claude-chat-listen-toggle"
        >
          🎧
        </button>
        <div className="ask-lang-toggle" role="group" aria-label="Claude answers in">
          <button type="button" aria-pressed={language === 'zh'} className={language === 'zh' ? 'on' : ''} onClick={() => { if (language !== 'zh') { track('coach.ask_tool', { action: 'language', role: 'claude' }); void setLanguage('zh', 'sheet'); } }} data-testid="claude-chat-lang-zh">
            中文
          </button>
          <button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'on' : ''} onClick={() => { if (language !== 'en') { track('coach.ask_tool', { action: 'language', role: 'claude' }); void setLanguage('en', 'sheet'); } }} data-testid="claude-chat-lang-en">
            EN
          </button>
        </div>
        <button type="button" className="claude-chat-more" onClick={() => setMenuOpen(true)} aria-label="More" data-testid="claude-chat-more" disabled={isNew}>
          ⋯
        </button>
      </header>

      <main className="claude-chat-body">
        {empty && (
          <div className="claude-chat-empty" data-testid="claude-chat-empty">
            <h2>{COACH_ASK_ICON} {COACH_ASK_LABEL}</h2>
            <p>{language === 'zh' ? COACH_ASK_HINT : COACH_ASK_EMPTY_EN}</p>
            <p>Under each answer: ▶ listen · 拼 pinyin · EN translation · 🎤 read it back and see how you did.</p>
          </div>
        )}
        {!isNew && query.isLoading && <p className="claude-chat-empty">Loading…</p>}
        {!isNew && query.isError && !data && <div className="coach-error claude-chat-error">Couldn't load this chat.</div>}
        <ClaudeChatThread
          threadId={routeId}
          messages={messages}
          listening={listening}
          thinkingLabel={language === 'zh' ? COACH_ASK_THINKING_ZH : COACH_ASK_THINKING_EN}
          onTranslate={translate}
          onRetry={(m) => retryMutation.mutate(m.id)}
          retryingId={retryMutation.isPending ? retryMutation.variables ?? null : null}
          pendingText={pendingText}
        />
        {pendingText && (
          <div className="ask-thread">
            <div className="chat-message received group-first group-last">
              <div className="chat-message-content">
                <div className="chat-bubble claude-chat-thinking">
                  <span className="chat-spinner" aria-hidden="true" /> {language === 'zh' ? COACH_ASK_THINKING_ZH : COACH_ASK_THINKING_EN}
                </div>
              </div>
            </div>
          </div>
        )}
        {sendError && !busy && (
          <div className="coach-error claude-chat-error" role="alert" data-testid="claude-chat-error">
            {errorText(sendError)}
          </div>
        )}
        {addedNote && (
          <div className="chat-notice claude-chat-error" role="status" data-testid="claude-chat-added">
            <span className="chat-notice-text">{addedNote}</span>
          </div>
        )}
      </main>

      <ClaudeChatComposer
        value={draft}
        onChange={setDraft}
        onSend={send}
        busy={busy}
        failed={!!sendError}
        language={language}
        online={isOnline}
      />

      {menuOpen && (
        <div className="claude-chat-menu-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="claude-chat-menu" role="menu" onClick={(e) => e.stopPropagation()} data-testid="claude-chat-menu">
            <button
              type="button"
              role="menuitem"
              disabled={!hasClaude}
              onClick={() => {
                setMenuOpen(false);
                setAddedNote(null);
                setCardsOpen(true);
              }}
              data-testid="claude-chat-make-cards"
            >
              🃏 Make flashcards from this chat
            </button>
            <button type="button" role="menuitem" disabled aria-disabled="true" data-testid="claude-chat-recap">
              {recapCountLabel(recap.length)}
              <span className="claude-chat-soon">{RECAP_COMING_SOON}</span>
            </button>
          </div>
        </div>
      )}
      {cardsOpen && !isNew && (
        <MakeFlashcardsSheet
          conversationId={routeId}
          scope={{ kind: 'last50' }}
          fromLabel="this chat"
          propose={() => proposeCoachFlashcards(routeId, recapFocusWords(recap))}
          initiallyChecked={(card) => askCardChecked(card, recap)}
          sourceText={(messageId) => messages.find((m) => m.id === messageId)?.text ?? null}
          onAddedCount={(count) => track('coach.ask_flashcards', { count, focus: recap.length > 0 })}
          onClose={() => setCardsOpen(false)}
          onAdded={(summary) => {
            setCardsOpen(false);
            setAddedNote(summary);
          }}
        />
      )}
    </div>
  );
}

export default ClaudeChatPage;
