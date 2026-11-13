/**
 * One Claude thread, whatever its context (docs/CHAT.md "Claude thread view"; the unified-Claude-chats
 * plan §6.3–6.4): a plain chat (`general` — the Coach's "💬 Ask Claude", a `/coach?text=&action=`
 * deep link), Ask Claude on a card (`card`), Discuss with Claude (`chat_message`) or a practice chat
 * (`practice`, read-only for now). Route `/chats/claude/:id` (pages/ClaudeThreadPage.tsx, immersive);
 * `variant="sheet"` is the same screen without page chrome: the study card's Ask Claude
 * (components/claude/CardClaudeSheet.tsx).
 *
 * - Header: ← (page), the title, 🎧 Listen first, 中文 | EN, ⋯ (the caller's `menuItems` first, then
 *   Make flashcards from this chat, 📝 words to recap); on the page, under it the context chip
 *   ("📇 Asked on card · 银行" → the card hub, "💬 From a chat message" → that chat, "🎭 Practice · 点菜"
 *   + a read-only banner). The sheet is compact (Jerome, Nov 2026): a grab handle on top instead of ✕
 *   (tap / drag down / Escape closes), no context chip, no "can read this chat" line.
 * - The thread: components/claudeChat (word chips → explorer, ▶, 拼 / EN, 🎧, 🎤 Read it back); a
 *   reply STREAMS in (ChatHub `claude_turn`, else the poll rule — hooks/useClaudeThread.ts); Coach
 *   results (✏️ Check / 🔍 Explain / Translate, 🎯 mini lesson) are the Coach's own cards
 *   (components/coach/CoachResults.tsx); tool results as chips.
 * - Suggestion chips (`chipsFor`) above the composer only before the first message (a role-play's help
 *   chips every time).
 * - The composer (`composerFor`): a new general chat offers Ask + Check / Explain / Translate;
 *   anything else Ask only. Offline, a message is queued (services/claudeThreads.ts) and shown at once.
 * - The card sheet's hooks: `typed` rides with each card question, `onReplyFinished` hears a reply this
 *   screen saw being written finish (Claude's card tools reach the device there), `renderToolResults`
 *   draws its tool results, `autoSend` with a `key` asks into the thread on screen (the leech sheet).
 * - ⋯ → 👁 Share with my tutor / 🙈 Hide from my tutor (shared/claude/visibility.ts), and (on the page)
 *   the quiet "👁 Minghui can read this chat" under the header while she can.
 * - `tutorView`: the tutor's READ-ONLY view of one of her student's chats (the student page's "Asked
 *   Claude", `/connections/:relId/claude/:id` — pages/tutor/StudentClaudeThreadPage.tsx): the thread
 *   she was given, no composer, chips, 🎧 / 中文 | EN or ⋯; the card chip opens her card hub view.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { askCardChecked, recapCountLabel, recapFocusWords, COACH_ASK_EMPTY_EN, COACH_ASK_HINT, COACH_ASK_ICON, COACH_ASK_LABEL, COACH_ASK_THINKING_EN, COACH_ASK_THINKING_ZH } from '@shared/coach/askChat';
import { revealedWhenListeningOn } from '@shared/study/askClaude';
import { coachDeepLink, openInCoachRequest } from '@shared/chats/autoCheck';
import { chipsFor, composerFor, headerChipFor, turnStatusLine, type ClaudeChip } from '@shared/claude/contexts';
import type { ClaudeContextSnapshot, ClaudeIntent, ClaudeThreadContext, StoredClaudeContext } from '@shared/claude/context';
import type { TutorClaudeMessage, TutorClaudeThread } from '@shared/claude/api';
import { nextTutorVisible, parseTutorVisibility, sharedLine, shareMenuLabel, tutorCanSee, tutorReadOnlyLine } from '@shared/claude/visibility';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { PRACTICE_VOICE_SPEED, practiceVoiceFor } from '@shared/claude/practice';
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
import { addedCards } from '@shared/claude/cardTools';
import { useFollowEnd } from '../../hooks/useFollowEnd';
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
  setThreadTutorVisible,
  startClaudeThread,
  wireClaudeOutbox,
  type LocalClaudeMessage,
  type LocalClaudeThread,
} from '../../services/claudeThreads';
import { track, trackError } from '../../services/analytics';
import '../claudeChat/claude-chat.css';

/** A reply whose tools made cards (create_flashcards with at least one note). */
function repliedWithCards(raw: string | null | undefined): boolean {
  return parseToolResults(raw ?? null).some((r) => r.tool === 'create_flashcards' && r.success && addedCards(r.data).length > 0);
}

export interface ClaudeThreadMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface ClaudeThreadViewProps {
  /** A thread id (or the client id of one started offline); 'new' = a fresh thread in `newContext`. */
  threadId: string;
  /** The context of a fresh thread (default: a plain chat) and its badge snapshot. */
  newContext?: ClaudeThreadContext & ClaudeContextSnapshot;
  /**
   * Send this at once in a fresh thread (a `/coach?text=&action=` deep link); with a `key`, also into
   * the thread on screen once it is loaded (once per key — the leech sheet's "memory hook").
   */
  autoSend?: { text: string; intent: ClaudeIntent; key?: string } | null;
  /** A card thread: the answer typed on this showing of the card, sent with each question (null = none). */
  typed?: { answer: string; correct?: string } | null;
  /**
   * A reader / exercise thread: its context's fields as they stand on this showing (a page's
   * `looked_up` / `said_wrong`, an exercise's `answer`), sent with each question; the chips read them.
   */
  contextFields?: Record<string, unknown>;
  /** Under the header (the card sheet's list of earlier chats, Discuss's quoted message). */
  headerExtra?: ReactNode;
  /** Extra ⋯ menu items, first (the card sheet's "🕘 Earlier about 银行 · 2 chats" and "＋ New chat"). */
  menuItems?: ClaudeThreadMenuItem[];
  /** A reply this screen saw being written has finished (the card sheet applies Claude's card tools). */
  onReplyFinished?: (reply: LocalClaudeMessage) => void;
  /** A finished reply's tool results, drawn by the caller (default: the Coach's chips). */
  renderToolResults?: (reply: LocalClaudeMessage) => ReactNode;
  /** No composer, this line instead (the card was deleted). */
  closedNote?: string | null;
  /** The study card's type (analytics: `study.ask_claude`). */
  cardType?: string;
  /** Text waiting in the box. */
  initialDraft?: string;
  variant?: 'page' | 'sheet';
  /** ← (page) */
  onBack?: () => void;
  /** The sheet's grab handle (tap / drag down) and Escape. */
  onClose?: () => void;
  /** A fresh thread exists now (the page moves to its URL). */
  onThreadCreated?: (id: string) => void;
  /** Where it was opened from (analytics). */
  source?: string;
  /**
   * The ✦ Claude tab (`/claude`): 🎤 starts at once, ready for any question (the browser asks for
   * the microphone the first time; offline / refused → typing with the box's reason).
   * [onAutoListen] says which it was (true = listening).
   */
  autoListen?: boolean;
  onAutoListen?: (listening: boolean) => void;
  /** No ← (a tab's root has nowhere to go back to). */
  hideBack?: boolean;
  /** A card thread: the card has an example sentence (the "Explain sentence" chip). */
  hasSentence?: boolean;
  /** The tutor's read-only view of her student's chat (the server's trimmed copy). */
  tutorView?: { relId: string; studentName: string | null; thread: TutorClaudeThread; messages: TutorClaudeMessage[] } | null;
}

/** The tutor's copy of a student's chat as the screen's thread + messages (read-only). */
function tutorRows(t: NonNullable<ClaudeThreadViewProps['tutorView']>): { thread: LocalClaudeThread; messages: LocalClaudeMessage[] } {
  return {
    thread: {
      id: t.thread.id,
      client_id: null,
      title: t.thread.title,
      context_kind: t.thread.context_kind,
      context: t.thread.context,
      badge: t.thread.badge,
      first_intent: null,
      preview: t.thread.preview,
      last_message_at: t.thread.last_message_at,
      created_at: t.thread.created_at,
      unread: 0,
      pending: false,
      failed: false,
      read_only: true,
      archived: false,
      tutor_visible: t.thread.shared ? true : null,
      language: null,
      source: null,
    },
    messages: t.messages.map((m) => ({
      id: m.id,
      thread_id: t.thread.id,
      client_id: null,
      role: m.role,
      content_type: m.content_type,
      content: m.content,
      intent: null,
      status: null,
      streaming: false,
      error: null,
      answer_lang: m.answer_lang,
      translation: m.translation,
      tool_results: m.tool_results,
      auto_check: null,
      created_at: m.created_at,
      updated_at: null,
    })),
  };
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
    auto_check: m.auto_check ?? null,
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
  const tutor = props.tutorView ?? null;
  const auth = useOptionalAuth();
  const isNew = routeId === 'new' && !tutor;
  const state = useClaudeThread(isNew || tutor ? null : routeId);
  const tutorData = useMemo(() => (tutor ? tutorRows(tutor) : null), [tutor]);
  const thread = tutorData ? tutorData.thread : state.thread;
  const rows = tutorData ? tutorData.messages : state.messages;
  const threadId = tutor ? tutor.thread.id : isNew ? null : state.threadId ?? routeId;
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
  const [typeRequest, setTypeRequest] = useState(0);
  const recap = useRecapWords(threadId ?? 'new');
  const recapCount = useChatRecapCount(threadId ?? 'new');
  const bottomRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLElement>(null);

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
    if (tutor) track('tutor.claude_thread_open', { context_kind: ctx.kind, source });
    else track('claude.thread_open', { context_kind: ctx.kind, source, resumed: !isNew });
  }, [threadId, isNew, thread, ctx.kind, source, tutor]);

  const messages = useMemo(() => rows.map(toChatMessage), [rows]);
  const started = rows.length > 0 || !!sending;
  const replyPending = rows.some((m) => m.role === 'assistant' && m.status === 'pending' && m.content_type !== MISTAKE_LESSON_CONTENT_TYPE);
  const busy = !!sending || replyPending;
  // An old practice chat copied in from the tutor-chat tables is read-only; a new role-play is not.
  const readOnly = !!tutor || !!thread?.read_only || (ctx.kind === 'practice' && !!ctx.conversation_id);
  // ⋯ → Share with my tutor / Hide from my tutor: a learner's own chat once it is on the server.
  const visibility = parseTutorVisibility(auth?.user?.claude_tutor_visibility);
  const canShare = !tutor && !!thread && !thread.local && auth?.user?.role !== 'tutor' && !!auth?.user;
  const shareState = { context_kind: ctx.kind, tutor_visible: thread?.tutor_visible ?? null };
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const toggleShare = async () => {
    if (!threadId || !canShare || shareBusy) return;
    setMenuOpen(false);
    setShareBusy(true);
    setShareError(null);
    const next = nextTutorVisible(shareState, visibility);
    try {
      await setThreadTutorVisible(threadId, next);
      track('claude.share_with_tutor', { on: tutorCanSee({ ...shareState, tutor_visible: next }, visibility), scope: 'thread', context_kind: ctx.kind });
    } catch (err) {
      setShareError(isOnline ? "Couldn't change that — try again." : 'Sharing needs a connection.');
      trackError('claude_thread_share', err);
    } finally {
      setShareBusy(false);
    }
  };
  // A role-play's lines are read in the persona's voice (the server keeps it on the thread).
  const voice = useMemo(() => (ctx.kind === 'practice' ? { voice: practiceVoiceFor(ctx), speed: PRACTICE_VOICE_SPEED } : undefined), [ctx]);
  const chip = headerChipFor(ctx);

  // Follow the end while the reader is there — a reply streaming in, a check card arriving — and
  // never pull them down once they scrolled up themselves; my own new message follows again.
  const lastRow = rows[rows.length - 1];
  const mineCount = rows.filter((r) => r.role === 'user').length + (sending ? 1 : 0);
  useFollowEnd(bodyRef, bottomRef, `${rows.length}:${lastRow?.content.length ?? 0}:${lastRow?.tool_results ?? ''}`, mineCount, rows.length > 1);

  const send = async (text: string, spoken: boolean, intent: ClaudeIntent = 'ask', fromChip?: string) => {
    const msg = text.trim();
    if (!msg || busy || readOnly || props.closedNote) return;
    setSendError(null);
    setSending({ text: msg });
    const quick = !!fromChip;
    try {
      let res;
      if (!threadId) {
        const context: ClaudeThreadContext = newContext ? stripSnapshot(newContext) : { kind: 'general' };
        res = await startClaudeThread({ context, snapshot: snapshotOf(newContext), text: msg, intent, language, quick });
        props.onThreadCreated?.(res.threadId);
      } else {
        res = await sendClaudeMessage(threadId, {
          text: msg,
          language,
          quick,
          ...(ctx.kind === 'card' ? { typed: props.typed ?? null } : {}),
          ...((ctx.kind === 'reader' || ctx.kind === 'exercise') && props.contextFields ? { fields: props.contextFields } : {}),
        });
      }
      track('claude.message_send', { context_kind: ctx.kind, intent, offline: res.queued, chip: !!fromChip, spoken });
      if (ctx.kind === 'card') track('study.ask_claude', { card_type: props.cardType ?? (ctx as { card_type?: string }).card_type ?? null, language, quick, via: 'thread' });
      setDraft('');
    } catch (err) {
      setSendError(err);
      trackError('claude_thread_send', err);
      if (apiErrorStatus(err) === 409) void state.refresh();
    } finally {
      setSending(null);
    }
  };

  // A deep link's text runs at once (once); a keyed one also into the thread on screen, once it is loaded.
  const autoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSend) return;
    const key = autoSend.key ?? 'deep-link';
    if (autoRef.current === key) return;
    if (!isNew && (!autoSend.key || !thread || busy)) return;
    autoRef.current = key;
    void send(autoSend.text, false, autoSend.intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, autoSend, thread, busy]);

  // A reply this screen saw being written has finished: the caller hears it once (Claude's card
  // tools reach the device). A card question's "check my Chinese" may land a moment after the
  // reply — look again shortly.
  const seenPending = useRef<Set<string>>(new Set());
  const onReplyFinished = props.onReplyFinished;
  useEffect(() => {
    for (const m of rows) {
      if (m.role !== 'assistant') continue;
      if (m.status === 'pending') {
        seenPending.current.add(m.id);
      } else if (seenPending.current.has(m.id)) {
        seenPending.current.delete(m.id);
        if (m.status === null) {
          onReplyFinished?.(m);
          // Claude made cards: bring them to this device now (the card sheet's caller syncs itself),
          // so the explorer — a tap on the line's words — shows them as cards he has.
          if (!onReplyFinished && repliedWithCards(m.tool_results)) void import('../../services/sync').then(({ syncService }) => syncService.incrementalSync()).catch(() => undefined);
          if (ctx.kind === 'card') {
            for (const ms of [2500, 8000]) window.setTimeout(() => void state.refresh(), ms);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

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
    if (row && props.renderToolResults) return props.renderToolResults(row);
    const results = parseToolResults(row?.tool_results ?? null);
    return results.length > 0 ? <ToolResultChips results={results} /> : null;
  };
  const statusLineFor = (m: ClaudeChatMessage) =>
    state.liveTool?.messageId === m.id ? turnStatusLine(state.liveTool.status as 'tool', state.liveTool.tool, language) : null;

  // A chip is used once its question is one of my messages (also after the page moved to the new thread).
  // A reader / exercise thread's chips read its fields as they stand on this showing.
  const chipCtx = (ctx.kind === 'reader' || ctx.kind === 'exercise') && props.contextFields ? ({ ...ctx, ...props.contextFields } as StoredClaudeContext) : ctx;
  const allChips = chipsFor(chipCtx, { language, hasSentence: props.hasSentence });
  const asked = new Set(rows.filter((m) => m.role === 'user').map((m) => m.content.trim()));
  const used = [...usedChips, ...allChips.filter((c) => asked.has(c.question)).map((c) => c.id)];
  const chips: ClaudeChip[] = readOnly || busy ? [] : chipsFor(chipCtx, { language, hasSentence: props.hasSentence, started, used });
  const useChip = (c: ClaudeChip) => {
    // 🆘 How do I say…: into the box, to be finished.
    if (c.fill) {
      setDraft(c.question);
      setTypeRequest((n) => n + 1);
      track('claude.message_send', { context_kind: ctx.kind, intent: 'ask', offline: false, chip: true, spoken: false });
      return;
    }
    setUsedChips((u) => [...u, c.id]);
    void send(c.question, false, 'ask', c.id);
  };

  const openContext = async () => {
    const link = chip?.link;
    if (!link) return;
    if (tutor) {
      // The tutor: her view of the student's card; the rest are the student's own places.
      if (link.kind === 'card') navigate(`/connections/${encodeURIComponent(tutor.relId)}/cards/${encodeURIComponent(link.note_id)}`);
      return;
    }
    if (link.kind === 'card') {
      navigate(`/cards/${encodeURIComponent(link.note_id)}`);
      return;
    }
    if (link.kind === 'reader') {
      navigate(`/readers/${encodeURIComponent(link.reader_id)}${link.page ? `?page=${link.page}` : ''}`);
      return;
    }
    if (link.kind === 'exercise') {
      navigate(`/lessons/${encodeURIComponent(link.lesson_id)}/play?from=claude`);
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

  // "Open in Coach" from a bubble: my own Chinese is checked there, Claude's explained.
  const openInCoach = (m: ClaudeChatMessage, source: 'menu' | 'chip' | 'sheet') => {
    const req = openInCoachRequest({ sender_id: m.role === 'user' ? 'me' : 'claude', content: m.text }, 'me');
    if (!req) return;
    track('coach.ask_tool', { action: source === 'menu' ? 'open_coach' : `open_coach_${source}`, role: m.role === 'user' ? 'mine' : 'claude' });
    navigate(coachDeepLink(req));
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
  const cardLabel = ctx.kind === 'card' ? (ctx as { label?: string }).label : undefined;
  const title =
    thread?.title ||
    (ctx.kind === 'general'
      ? COACH_ASK_LABEL
      : cardLabel
        ? `Ask about ${cardLabel}`
        : ctx.kind === 'reader'
          ? 'Ask about this page'
          : ctx.kind === 'exercise'
            ? 'Ask about this exercise'
            : chip?.text ?? COACH_ASK_LABEL);
  const sheet = variant === 'sheet';

  return (
    <div className={sheet ? 'claude-thread-sheet' : 'claude-chat-page'} data-testid="claude-thread" data-context={ctx.kind}>
      {sheet && <SheetHandle onClose={props.onClose} />}
      <header className="claude-chat-header">
        {!sheet && !props.hideBack && (
          <button type="button" className="claude-chat-back" onClick={props.onBack} aria-label="Back" data-testid="claude-thread-back">
            ←
          </button>
        )}
        <div className="claude-chat-title" data-testid="claude-thread-title">
          {ctx.kind === 'general' ? `${COACH_ASK_ICON} ` : ''}
          {title}
        </div>
        {!tutor && (<>
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
        <button type="button" className="claude-chat-more" onClick={() => setMenuOpen(true)} aria-label="More" data-testid="claude-thread-more" disabled={!threadId && !props.menuItems?.length}>
          ⋯
        </button>
        </>)}
      </header>
      {/* The sheet opens from the card / page it is about: no chip saying so (Jerome, Nov 2026). */}
      {chip && !sheet && (
        <div className="claude-thread-context">
          {chip.link && (!tutor || chip.link.kind === 'card') ? (
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

      {ctx.kind === 'practice' && (ctx.ai_role || ctx.user_role) && (
        <p className="claude-thread-roles" data-testid="claude-thread-roles">
          {ctx.ai_role && <span>✦ Claude plays {ctx.ai_role}</span>}
          {ctx.ai_role && ctx.user_role && ' · '}
          {ctx.user_role && <span>You: {ctx.user_role}</span>}
        </p>
      )}
      {canShare && !sheet && tutorCanSee(shareState, visibility) && (
        <p className="claude-thread-shared" data-testid="claude-thread-shared">
          {sharedLine(shareState, visibility)}
        </p>
      )}
      {shareError && (
        <p className="claude-thread-shared" role="alert">
          {shareError}
        </p>
      )}
      {props.headerExtra}

      <main className="claude-chat-body" ref={bodyRef}>
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
            ) : ctx.kind === 'card' ? (
              <p data-testid="claude-thread-card-hint">
                {listening
                  ? '🎧 Listen first: Claude’s Chinese answers arrive hidden and play by themselves. Tap to hear again · hold to reveal.'
                  : language === 'zh'
                    ? 'Claude answers in simple Chinese. Tap any word to look it up · hold a message to translate it. Ask anything about this card — or tap a suggestion below.'
                    : 'Ask Claude anything about this card — or tap a suggestion below.'}
              </p>
            ) : ctx.kind === 'reader' ? (
              <p data-testid="claude-thread-reader-hint">Ask Claude about this page — what a sentence means, a word, the grammar — or tap a suggestion below. Claude can see the page and the words you looked up.</p>
            ) : ctx.kind === 'exercise' ? (
              <p data-testid="claude-thread-exercise-hint">Ask Claude about this exercise — why the answer is what it is, another example, one more to try — or tap a suggestion below.</p>
            ) : ctx.kind === 'practice' ? (
              <p data-testid="claude-thread-practice-hint">Claude is setting the scene… Answer in Chinese. Stuck? 💡 a hint, 🆘 how to say something, ✏️ a correction.</p>
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
            {tutor ? tutorReadOnlyLine(tutor.studentName) : composerFor(ctx.kind, '', { started: true, readOnly: true }).hint}
          </div>
        )}
        <ClaudeChatThread
          threadId={threadId ?? 'new'}
          messages={messages}
          listening={listening}
          thinkingLabel={language === 'zh' ? COACH_ASK_THINKING_ZH : COACH_ASK_THINKING_EN}
          onTranslate={tutor ? async (m) => m.translation ?? null : translate}
          onRetry={(m) => void retry(m)}
          retryingId={retryingId}
          pendingText={sending && !rows.some((r) => r.role === 'user' && r.content === sending.text && r.queued) ? sending.text : null}
          renderSpecial={renderSpecial}
          renderAfter={renderAfter}
          statusLineFor={statusLineFor}
          onDiscardQueued={(m) => void discardQueuedMessage(m.id)}
          onOpenInCoach={tutor ? undefined : openInCoach}
          onDraft={
            tutor
              ? undefined
              : (text) => {
                  setDraft(text);
                  setTypeRequest((n) => n + 1);
                }
          }
          language={language}
          online={isOnline}
          explorerSource={ctx.kind === 'card' ? 'ask_claude' : ctx.kind === 'reader' ? 'reader' : ctx.kind === 'exercise' ? 'lesson' : undefined}
          voice={voice}
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

      {props.closedNote && (
        <p className="claude-thread-closed" data-testid="claude-thread-closed">
          {props.closedNote}
        </p>
      )}
      {!readOnly && !props.closedNote && (
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
            surface={ctx.kind === 'card' ? 'ask_claude' : 'claude_thread'}
            composer={(text) => composerFor(ctx.kind, text, { started })}
            typeRequest={typeRequest}
            listenRequest={props.autoListen ? 1 : 0}
            onListenRequest={props.onAutoListen}
            compact
          />
        </div>
      )}

      {menuOpen && (
        <div className="claude-chat-menu-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="claude-chat-menu" role="menu" onClick={(e) => e.stopPropagation()} data-testid="claude-thread-menu">
            {props.menuItems?.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setMenuOpen(false);
                  item.onSelect();
                }}
                data-testid={item.id}
              >
                {item.label}
              </button>
            ))}
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
            {canShare && (
              <button type="button" role="menuitem" disabled={shareBusy || !isOnline} onClick={() => void toggleShare()} data-testid="claude-thread-share">
                {shareMenuLabel(shareState, visibility)}
              </button>
            )}
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
          deckSource="claude"
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

/**
 * The sheet's grab handle: a tap closes, a drag down past ~80px closes (the sheet follows the finger),
 * Escape closes. Replaces the ✕ (Jerome, Nov 2026: the sheet needs the room).
 */
function SheetHandle({ onClose }: { onClose?: () => void }) {
  const drag = useRef<{ y: number; dy: number; sheet: HTMLElement | null; moved: boolean } | null>(null);
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the sheet on screen (the card sheet stays mounted, hidden, while closed).
      const el = handleRef.current;
      if (el && !el.closest('[hidden]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const handleRef = useRef<HTMLButtonElement>(null);
  const reset = (sheet: HTMLElement | null) => {
    if (!sheet) return;
    sheet.style.transform = '';
    sheet.style.transition = '';
  };
  return (
    <button
      ref={handleRef}
      type="button"
      className="claude-sheet-handle"
      aria-label="Close"
      title="Close"
      data-testid="claude-thread-close"
      onClick={() => {
        if (drag.current?.moved) return;
        onClose?.();
      }}
      onPointerDown={(e) => {
        const sheet = (e.currentTarget.closest('[role="dialog"]') as HTMLElement | null) ?? null;
        drag.current = { y: e.clientY, dy: 0, sheet, moved: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
        if (sheet) sheet.style.transition = 'none';
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.dy = Math.max(0, e.clientY - d.y);
        if (d.dy > 6) d.moved = true;
        if (d.sheet) d.sheet.style.transform = `translateY(${d.dy}px)`;
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (!d) return;
        reset(d.sheet);
        if (d.dy > 80) onClose?.();
        // The click that follows a drag must not close it again (or close a short drag).
        window.setTimeout(() => { drag.current = null; }, 0);
      }}
      onPointerCancel={() => {
        reset(drag.current?.sheet ?? null);
        drag.current = null;
      }}
    >
      <span aria-hidden="true" />
    </button>
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
