/**
 * One Claude thread, whatever its context (docs/CHAT.md "Claude thread view"; the unified-Claude-chats
 * plan §6.3–6.4): a plain chat (`general` — the Coach's "💬 Ask Claude", a `/coach?text=&action=`
 * deep link), Ask Claude on a card (`card`), Discuss with Claude (`chat_message`) or a practice chat
 * (`practice`, read-only for now). Route `/chats/claude/:id` (pages/ClaudeThreadPage.tsx, immersive);
 * `variant="sheet"` is the same screen without page chrome, for the study card's sheet later.
 *
 * - Header: ← / ✕, the title, 🎧 Listen first, 中文 | EN, ⋯ (Make flashcards from this chat,
 *   📝 words to recap); under it the context chip ("📇 Asked on card · 银行" → the card hub,
 *   "💬 From a chat message" → that chat, "🎭 Practice · 点菜" + a read-only banner).
 * - The thread: components/claudeChat (word chips → explorer, ▶, 拼 / EN, 🎧, 🎤 Read it back); a
 *   reply STREAMS in (ChatHub `claude_turn`, else the poll rule — hooks/useClaudeThread.ts); Coach
 *   results (✏️ Check / 🔍 Explain / Translate, 🎯 mini lesson) are the Coach's own cards
 *   (components/coach/CoachResults.tsx); tool results as chips.
 * - Suggestion chips (`chipsFor`) above the composer while empty and after each reply (≤ 3).
 * - The composer (`composerFor`): a new general chat offers Ask + Check / Explain / Translate;
 *   anything else Ask only. Offline, a message is queued (services/claudeThreads.ts) and shown at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { askCardChecked, recapCountLabel, recapFocusWords, COACH_ASK_EMPTY_EN, COACH_ASK_HINT, COACH_ASK_ICON, COACH_ASK_LABEL, COACH_ASK_THINKING_EN, COACH_ASK_THINKING_ZH } from '@shared/coach/askChat';
import { revealedWhenListeningOn } from '@shared/study/askClaude';
import { chipsFor, composerFor, headerChipFor, turnStatusLine, type ClaudeChip } from '@shared/claude/contexts';
import type { ClaudeContextSnapshot, ClaudeIntent, ClaudeThreadContext, StoredClaudeContext } from '@shared/claude/context';
import {
  coachMistakeLessonOffered,
  conversationAction,
  COACH_MISTAKE_LESSON_BUSY,
  COACH_MISTAKE_LESSON_LABEL,
  MISTAKE_LESSON_CONTENT_TYPE,
  type CoachAction,
} from '@shared/coach';
import { apiErrorStatus, getConversation, proposeCoachFlashcards, requestCoachMistakeLesson, translateCoachMessage } from '../../api/client';
import { ClaudeChatThread, type ClaudeChatMessage } from '../claudeChat/ClaudeChatThread';
import { ClaudeChatComposer } from '../claudeChat/ClaudeChatComposer';
import { MakeFlashcardsSheet } from '../chat/MakeFlashcardsSheet';
import { CoachMessageView, parseAnalysis, parseToolResults, ToolResultChips, type MistakeLessonChip } from '../coach/CoachResults';
import { useClaudeThread } from '../../hooks/useClaudeThread';
import { useAskLanguage } from '../../services/askClaudeLanguage';
import { getAskRevealed, setAskRevealed, useAskListening } from '../../services/askClaudeListening';
import { useRecapWords } from '../../services/claudeChatRecap';
import { useChatRecapCount } from '../../services/wordRecap';
import { useNetwork } from '../../contexts/NetworkContext';
import {
  discardQueuedMessage,
  flushClaudeOutbox,
  retryClaudeReply,
  sendClaudeMessage,
  setLocalTranslation,
  startClaudeThread,
  wireClaudeOutbox,
  type LocalClaudeMessage,
} from '../../services/claudeThreads';
import { track, trackError } from '../../services/analytics';
import '../claudeChat/claude-chat.css';

export interface ClaudeThreadViewProps {
  /** A thread id (or the client id of one started offline); 'new' = a fresh thread in `newContext`. */
  threadId: string;
  /** The context of a fresh thread (default: a plain chat) and its badge snapshot. */
  newContext?: ClaudeThreadContext & ClaudeContextSnapshot;
  /** Send this at once in a fresh thread (a `/coach?text=&action=` deep link). */
  autoSend?: { text: string; intent: ClaudeIntent } | null;
  /** Text waiting in the box. */
  initialDraft?: string;
  variant?: 'page' | 'sheet';
  /** ← (page) */
  onBack?: () => void;
  /** ✕ (sheet) */
  onClose?: () => void;
  /** A fresh thread exists now (the page moves to its URL). */
  onThreadCreated?: (id: string) => void;
  /** Where it was opened from (analytics). */
  source?: string;
  /** A card thread: the card has an example sentence (the "Explain sentence" chip). */
  hasSentence?: boolean;
}

/** A cached message → the thread component's message. */
export function toChatMessage(m: LocalClaudeMessage): ClaudeChatMessage {
  return {
    id: m.id,
    role: m.role,
    text: m.content,
    answer_lang: m.answer_lang,
    status: m.status,
    error: m.error,
    translation: m.translation,
    content_type: m.content_type,
    streaming: m.streaming,
    queued: m.queued,
    queueFailed: m.queue_failed,
  };
}

function sendErrorText(err: unknown): string {
  const status = apiErrorStatus(err);
  const message = err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : '';
  if (status === 409) return message || 'Claude is still answering your last message.';
  return message || "Couldn't send that — try again.";
}

export function ClaudeThreadView(props: ClaudeThreadViewProps) {
  const { threadId: routeId, newContext, autoSend, variant = 'page', source = 'link' } = props;
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [language, setLanguage] = useAskLanguage();
  const [listening, setListening] = useAskListening();
  const isNew = routeId === 'new';
  const state = useClaudeThread(isNew ? null : routeId);
  const { thread, messages: rows } = state;
  const threadId = isNew ? null : state.threadId ?? routeId;
  const ctx: StoredClaudeContext = thread?.context ?? newContext ?? { kind: 'general' };
  const [draft, setDraft] = useState(props.initialDraft ?? '');
  const [sending, setSending] = useState<{ text: string } | null>(null);
  const [sendError, setSendError] = useState<unknown>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [usedChips, setUsedChips] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [addedNote, setAddedNote] = useState<string | null>(null);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonError, setLessonError] = useState<unknown>(null);
  const recap = useRecapWords(threadId ?? 'new');
  const recapCount = useChatRecapCount(threadId ?? 'new');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wireClaudeOutbox();
  }, []);
  // Opening a thread sends whatever this device still holds for it.
  useEffect(() => {
    if (isOnline) void flushClaudeOutbox().catch(() => {});
  }, [isOnline, threadId]);

  const opened = useRef<string | null>(null);
  useEffect(() => {
    const key = threadId ?? (isNew ? 'new' : null);
    if (!key || opened.current === key || (!isNew && !thread)) return;
    opened.current = key;
    track('claude.thread_open', { context_kind: ctx.kind, source, resumed: !isNew });
  }, [threadId, isNew, thread, ctx.kind, source]);

  const messages = useMemo(() => rows.map(toChatMessage), [rows]);
  const replies = rows.filter((m) => m.role === 'assistant' && !m.status).length;
  const started = rows.length > 0 || !!sending;
  const replyPending = rows.some((m) => m.role === 'assistant' && m.status === 'pending' && m.content_type !== MISTAKE_LESSON_CONTENT_TYPE);
  const busy = !!sending || replyPending;
  const readOnly = ctx.kind === 'practice' || !!thread?.read_only;
  const chip = headerChipFor(ctx);

  useEffect(() => {
    if (rows.length > 1) bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [rows.length, rows[rows.length - 1]?.content.length]);

  const send = async (text: string, spoken: boolean, intent: ClaudeIntent = 'ask', fromChip?: string) => {
    const msg = text.trim();
    if (!msg || busy || readOnly) return;
    setSendError(null);
    setSending({ text: msg });
    try {
      let res;
      if (!threadId) {
        const context: ClaudeThreadContext = newContext ? stripSnapshot(newContext) : { kind: 'general' };
        res = await startClaudeThread({ context, snapshot: snapshotOf(newContext), text: msg, intent, language });
        props.onThreadCreated?.(res.threadId);
      } else {
        res = await sendClaudeMessage(threadId, { text: msg, language });
      }
      track('claude.message_send', { context_kind: ctx.kind, intent, offline: res.queued, chip: !!fromChip, spoken });
      setDraft('');
    } catch (err) {
      setSendError(err);
      trackError('claude_thread_send', err);
      if (apiErrorStatus(err) === 409) void state.refresh();
    } finally {
      setSending(null);
    }
  };

  // A deep link's text runs at once (once).
  const autoRef = useRef(false);
  useEffect(() => {
    if (!isNew || !autoSend || autoRef.current) return;
    autoRef.current = true;
    void send(autoSend.text, false, autoSend.intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, autoSend]);

  const translate = async (m: ClaudeChatMessage): Promise<string | null> => {
    if (!threadId) return null;
    try {
      const res = await translateCoachMessage(threadId, m.id);
      await setLocalTranslation(m.id, res.translation);
      return res.translation;
    } catch (err) {
      trackError('claude_thread_translate', err);
      return null;
    }
  };

  const retry = async (m: { id: string }) => {
    if (!threadId) return;
    setRetryingId(m.id);
    try {
      await retryClaudeReply(threadId, m.id);
      track('coach.reply_retry');
    } catch (err) {
      setSendError(err);
      trackError('claude_thread_retry', err);
    } finally {
      setRetryingId(null);
    }
  };

  // ✏️ Check results: "🎯 Mini lesson on this mistake" (the Coach's, same endpoint).
  const firstAnalysisRow = rows.find((m) => m.content_type === 'analysis' && !m.status) ?? null;
  const firstAnalysis = useMemo(() => (firstAnalysisRow ? parseAnalysis(firstAnalysisRow.content) : null), [firstAnalysisRow]);
  const lessonRow = rows.find((m) => m.content_type === MISTAKE_LESSON_CONTENT_TYPE) ?? null;
  const askForLesson = async () => {
    if (!threadId || lessonBusy) return;
    setLessonBusy(true);
    setLessonError(null);
    try {
      const res = await requestCoachMistakeLesson(threadId);
      track('coach.mistake_lesson_generate', { existing: !!res.existing });
      await state.refresh();
    } catch (err) {
      setLessonError(err);
      trackError('coach_mistake_lesson', err);
    } finally {
      setLessonBusy(false);
    }
  };
  const lessonChip: MistakeLessonChip | null =
    firstAnalysis?.kind !== 'chinese' || !coachMistakeLessonOffered(firstAnalysis.coach)
      ? null
      : lessonBusy || lessonRow?.status === 'pending'
        ? { label: COACH_MISTAKE_LESSON_BUSY, busy: true, onClick: () => {} }
        : lessonRow && !lessonRow.status
          ? { label: COACH_MISTAKE_LESSON_LABEL, busy: false, onClick: () => navigate(`/coach/${encodeURIComponent(threadId!)}/lesson/${encodeURIComponent(lessonRow.id)}`) }
          : { label: COACH_MISTAKE_LESSON_LABEL, busy: false, onClick: () => void askForLesson() };
  const firstUser = rows.find((m) => m.role === 'user');
  const action: CoachAction = firstUser?.intent && firstUser.intent !== 'ask' ? firstUser.intent : conversationAction({ action: null, input_language: null });

  const renderSpecial = (m: ClaudeChatMessage) => {
    const row = rows.find((r) => r.id === m.id);
    if (!row || !threadId) return null;
    return (
      <CoachMessageView
        message={{ ...row, content_type: row.content_type as 'text' | 'analysis' | 'mistake_lesson' }}
        action={action}
        conversationId={threadId}
        mistakeLesson={row.id === firstAnalysisRow?.id ? lessonChip : null}
        onRetry={(id) => void retry({ id })}
        retrying={retryingId === row.id || lessonBusy}
        onRetryLesson={() => void askForLesson()}
        onLessonSaved={() => void state.refresh()}
      />
    );
  };
  const renderAfter = (m: ClaudeChatMessage) => {
    const row = rows.find((r) => r.id === m.id);
    const results = parseToolResults(row?.tool_results ?? null);
    return results.length > 0 ? <ToolResultChips results={results} /> : null;
  };
  const statusLineFor = (m: ClaudeChatMessage) =>
    state.liveTool?.messageId === m.id ? turnStatusLine(state.liveTool.status as 'tool', state.liveTool.tool, language) : null;

  // A chip is used once its question is one of my messages (also after the page moved to the new thread).
  const allChips = chipsFor(ctx, { language, hasSentence: props.hasSentence });
  const asked = new Set(rows.filter((m) => m.role === 'user').map((m) => m.content.trim()));
  const used = [...usedChips, ...allChips.filter((c) => asked.has(c.question)).map((c) => c.id)];
  const chips: ClaudeChip[] = readOnly || busy ? [] : chipsFor(ctx, { language, hasSentence: props.hasSentence, replies, used });
  const useChip = (c: ClaudeChip) => {
    setUsedChips((u) => [...u, c.id]);
    void send(c.question, false, 'ask', c.id);
  };

  const openContext = async () => {
    const link = chip?.link;
    if (!link) return;
    if (link.kind === 'card') {
      navigate(`/cards/${encodeURIComponent(link.note_id)}`);
      return;
    }
    if (link.conversation_id) {
      try {
        const conv = await getConversation(link.conversation_id);
        navigate(`/connections/${encodeURIComponent(conv.relationship_id)}/chat/${encodeURIComponent(conv.id)}`);
      } catch (err) {
        trackError('claude_thread_open_context', err);
      }
    }
  };

  const toggleListening = () => {
    const on = !listening;
    if (on) setAskRevealed(revealedWhenListeningOn(messages.filter((m) => m.role === 'assistant').map((m) => ({ id: m.id, answer: m.text, answer_lang: m.answer_lang ?? null })), getAskRevealed()));
    track('coach.ask_tool', { action: on ? 'listening_on' : 'listening_off', role: 'claude' });
    void setListening(on, 'sheet');
  };
  const pickLanguage = (l: 'zh' | 'en') => {
    if (l === language) return;
    track('coach.ask_tool', { action: 'language', role: 'claude' });
    void setLanguage(l, 'sheet');
  };

  const hasClaude = rows.some((m) => m.role === 'assistant' && !m.status && m.content_type === 'text');
  const empty = rows.length === 0 && !sending;
  const offlineNoCache = !isNew && !thread && !state.loading && !!state.error;
  const title = thread?.title || (ctx.kind === 'general' ? COACH_ASK_LABEL : chip?.text ?? COACH_ASK_LABEL);
  const sheet = variant === 'sheet';

  return (
    <div className={sheet ? 'claude-thread-sheet' : 'claude-chat-page'} data-testid="claude-thread" data-context={ctx.kind}>
      <header className="claude-chat-header">
        {!sheet && (
          <button type="button" className="claude-chat-back" onClick={props.onBack} aria-label="Back" data-testid="claude-thread-back">
            ←
          </button>
        )}
        <div className="claude-chat-title" data-testid="claude-thread-title">
          {ctx.kind === 'general' ? `${COACH_ASK_ICON} ` : ''}
          {title}
        </div>
        <button
          type="button"
          className={`ask-listen-toggle${listening ? ' on' : ''}`}
          aria-pressed={listening}
          aria-label={listening ? 'Listen first is on: answers arrive hidden. Turn off' : 'Listen first: hear the answer before you read it'}
          title={listening ? 'Listen first: on' : 'Listen first'}
          onClick={toggleListening}
          data-testid="claude-thread-listen-toggle"
        >
          🎧
        </button>
        <div className="ask-lang-toggle" role="group" aria-label="Claude answers in">
          <button type="button" aria-pressed={language === 'zh'} className={language === 'zh' ? 'on' : ''} onClick={() => pickLanguage('zh')} data-testid="claude-thread-lang-zh">
            中文
          </button>
          <button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'on' : ''} onClick={() => pickLanguage('en')} data-testid="claude-thread-lang-en">
            EN
          </button>
        </div>
        <button type="button" className="claude-chat-more" onClick={() => setMenuOpen(true)} aria-label="More" data-testid="claude-thread-more" disabled={!threadId}>
          ⋯
        </button>
        {sheet && (
          <button type="button" className="claude-chat-more" onClick={props.onClose} aria-label="Close" data-testid="claude-thread-close">
            ✕
          </button>
        )}
      </header>
      {chip && (
        <div className="claude-thread-context">
          {chip.link ? (
            <button type="button" className="claude-thread-chip" onClick={() => void openContext()} data-testid="claude-thread-context-chip">
              <span aria-hidden="true">{chip.icon}</span> {chip.text}
            </button>
          ) : (
            <span className="claude-thread-chip" data-testid="claude-thread-context-chip">
              <span aria-hidden="true">{chip.icon}</span> {chip.text}
            </span>
          )}
        </div>
      )}

      <main className="claude-chat-body">
        {empty && !state.loading && !offlineNoCache && (
          <div className="claude-chat-empty" data-testid="claude-thread-empty">
            {ctx.kind === 'general' ? (
              <>
                <h2>
                  {COACH_ASK_ICON} {COACH_ASK_LABEL}
                </h2>
                <p>{language === 'zh' ? COACH_ASK_HINT : COACH_ASK_EMPTY_EN}</p>
                <p>Write a sentence and ✏️ Check it, 🔍 Explain one, or just ask. Under each answer: ▶ listen · 拼 pinyin · EN · 🎤 read it back.</p>
              </>
            ) : (
              <p>Ask Claude anything about it — tap a suggestion below to start.</p>
            )}
          </div>
        )}
        {state.loading && <p className="claude-chat-empty">Loading…</p>}
        {offlineNoCache && (
          <div className="coach-error claude-chat-error" data-testid="claude-thread-load-error">
            {isOnline ? "Couldn't load this chat." : "You're offline and this chat isn't on this device yet."}
          </div>
        )}
        {!isOnline && thread && <p className="claude-thread-offline" data-testid="claude-thread-offline">You're offline — this is the copy on this device. New messages send when you're back.</p>}
        {readOnly && thread && (
          <div className="claude-thread-readonly" data-testid="claude-thread-readonly">
            {composerFor('practice', '', { started: true }).hint}
          </div>
        )}
        <ClaudeChatThread
          threadId={threadId ?? 'new'}
          messages={messages}
          listening={listening}
          thinkingLabel={language === 'zh' ? COACH_ASK_THINKING_ZH : COACH_ASK_THINKING_EN}
          onTranslate={translate}
          onRetry={(m) => void retry(m)}
          retryingId={retryingId}
          pendingText={sending && !rows.some((r) => r.role === 'user' && r.content === sending.text && r.queued) ? sending.text : null}
          renderSpecial={renderSpecial}
          renderAfter={renderAfter}
          statusLineFor={statusLineFor}
          onDiscardQueued={(m) => void discardQueuedMessage(m.id)}
        />
        {sending && (
          <div className="ask-thread">
            <div className="chat-message received group-first group-last" data-testid="claude-thread-sending">
              <div className="chat-message-content">
                <div className="chat-bubble claude-chat-thinking">
                  <span className="chat-spinner" aria-hidden="true" /> …
                </div>
              </div>
            </div>
          </div>
        )}
        {sendError != null && !busy && (
          <div className="coach-error claude-chat-error" role="alert" data-testid="claude-thread-error">
            {sendErrorText(sendError)}
          </div>
        )}
        {lessonError != null && (
          <div className="coach-error claude-chat-error" role="alert">
            {sendErrorText(lessonError)}
          </div>
        )}
        {addedNote && (
          <div className="chat-notice claude-chat-error" role="status">
            <span className="chat-notice-text">{addedNote}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {!readOnly && (
        <div className="claude-chat-composer">
          {chips.length > 0 && (
            <div className="claude-thread-chips" role="group" aria-label="Suggestions" data-testid="claude-thread-chips">
              {chips.map((c) => (
                <button key={c.id} type="button" onClick={() => useChip(c)} disabled={busy} data-testid={`claude-thread-chip-${c.id}`}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <ClaudeChatComposer
            value={draft}
            onChange={setDraft}
            onSend={(text, spoken, intent) => void send(text, spoken, intent)}
            busy={busy}
            failed={sendError != null}
            language={language}
            online={isOnline}
            surface="claude_thread"
            composer={(text) => composerFor(ctx.kind, text, { started })}
          />
        </div>
      )}

      {menuOpen && (
        <div className="claude-chat-menu-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="claude-chat-menu" role="menu" onClick={(e) => e.stopPropagation()} data-testid="claude-thread-menu">
            <button
              type="button"
              role="menuitem"
              disabled={!hasClaude || !isOnline}
              onClick={() => {
                setMenuOpen(false);
                setAddedNote(null);
                setCardsOpen(true);
              }}
              data-testid="claude-thread-make-cards"
            >
              🃏 Make flashcards from this chat
            </button>
            {recapCount > 0 && threadId && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  navigate(`/chats/claude/${encodeURIComponent(threadId)}/recap`);
                }}
                data-testid="claude-thread-recap"
              >
                {recapCountLabel(recapCount)}
              </button>
            )}
          </div>
        </div>
      )}
      {cardsOpen && threadId && (
        <MakeFlashcardsSheet
          conversationId={threadId}
          scope={{ kind: 'last50' }}
          fromLabel="this chat"
          propose={() => proposeCoachFlashcards(threadId, recapFocusWords(recap))}
          initiallyChecked={(card) => askCardChecked(card, recap)}
          sourceText={(messageId) => rows.find((m) => m.id === messageId)?.content ?? null}
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

/** The descriptor without the badge snapshot (what the API takes). */
function stripSnapshot(c: ClaudeThreadContext & ClaudeContextSnapshot): ClaudeThreadContext {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { label, sublabel, ...rest } = c as ClaudeThreadContext & ClaudeContextSnapshot;
  return rest as ClaudeThreadContext;
}

function snapshotOf(c: (ClaudeThreadContext & ClaudeContextSnapshot) | undefined): ClaudeContextSnapshot {
  if (!c) return {};
  return { ...(c.label ? { label: c.label } : {}), ...(c.sublabel ? { sublabel: c.sublabel } : {}) };
}

export default ClaudeThreadView;
