/**
 * One Claude thread on screen (docs/CHAT.md "Claude thread view"): the cached thread + messages
 * (IndexedDB, so it reads offline), fetched on open (whole the first time, then `?since=`), the
 * reply being written streamed live from the ChatHub socket (`claude_turn`), and — while a reply
 * is pending — `GET …?since=` on the shared poll rule (`claudeReplyPollMs`: 400 ms for the first
 * 10 s, then 1.5 s; only a slow safety net while live frames arrive). Reports how long a reply took
 * to show (`claude.reply_shown`, via socket | poll).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { claudeReplyPollMs } from '@shared/claude/contexts';
import { db } from '../db/database';
import { chatLive, type ChatLiveStatus } from '../services/chatLive';
import {
  applyTurnEvent,
  refreshClaudeThread,
  resolveThreadId,
  sortMessages,
  type LocalClaudeMessage,
  type LocalClaudeThread,
} from '../services/claudeThreads';
import { track } from '../services/analytics';
import { apiErrorStatus } from '../api/client';

export interface ClaudeThreadState {
  /** The thread's id now (a thread started offline moves to its server id). */
  threadId: string | null;
  thread: LocalClaudeThread | null;
  messages: LocalClaudeMessage[];
  /** Nothing cached yet and the first fetch is running. */
  loading: boolean;
  /** The last fetch failed (offline: the cache is shown). */
  error: unknown;
  notFound: boolean;
  liveStatus: ChatLiveStatus;
  /** A tool Claude is using right now (from the live frames). */
  liveTool: { messageId: string; status: string; tool: string | null } | null;
  refresh: (full?: boolean) => Promise<void>;
}

interface ReplyTiming {
  startedAt: number;
  firstTextAt: number | null;
  via: 'socket' | 'poll' | null;
}

export function useClaudeThread(routeId: string | null, opts: { contextKind?: string } = {}): ClaudeThreadState {
  const [threadId, setThreadId] = useState<string | null>(routeId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [liveStatus, setLiveStatus] = useState<ChatLiveStatus>(chatLive.getStatus());
  const [liveTool, setLiveTool] = useState<ClaudeThreadState['liveTool']>(null);
  const lastEventAt = useRef<number | null>(null);
  const viaRef = useRef<Map<string, 'socket' | 'poll'>>(new Map());

  useEffect(() => {
    setThreadId(routeId);
    setNotFound(false);
    setError(null);
  }, [routeId]);

  // A thread started offline: follow it to its server id once it has one.
  const resolved = useLiveQuery(async () => (routeId ? resolveThreadId(routeId) : null), [routeId]);
  useEffect(() => {
    if (resolved && resolved !== threadId) setThreadId(resolved);
  }, [resolved, threadId]);

  const thread = useLiveQuery(async () => (threadId ? (await db.claudeThreads.get(threadId)) ?? null : null), [threadId]) ?? null;
  const rows = useLiveQuery(async () => (threadId ? sortMessages(await db.claudeMessages.where('thread_id').equals(threadId).toArray()) : []), [threadId]);
  const messages = rows ?? [];

  const refresh = useCallback(
    async (full = false) => {
      if (!threadId) return;
      const local = await db.claudeThreads.get(threadId);
      if (local?.local) return;
      try {
        await refreshClaudeThread(threadId, { full });
        setError(null);
      } catch (err) {
        if (apiErrorStatus(err) === 404) setNotFound(true);
        setError(err);
      }
    },
    [threadId],
  );

  // Open: fetch (whole the first time).
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void (async () => {
      const local = await db.claudeThreads.get(threadId);
      if (!local) setLoading(true);
      await refresh(!local?._cursor);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, refresh]);

  // Live: the reply's text as it is written; a reconnect / a finished reply catches up over REST.
  useEffect(() => {
    if (!threadId) return;
    const release = chatLive.acquire();
    setLiveStatus(chatLive.getStatus());
    const offStatus = chatLive.onStatus((s) => {
      setLiveStatus(s);
      if (s === 'open') void refresh();
    });
    const offEvent = chatLive.onEvent((e) => {
      if (e.type !== 'claude_turn' || e.thread_id !== threadId) return;
      lastEventAt.current = Date.now();
      setLiveTool(e.status === 'tool' || e.status === 'thinking' ? { messageId: e.message_id, status: e.status, tool: e.tool ?? null } : null);
      void applyTurnEvent(e).then((changed) => {
        if (changed && e.text && !viaRef.current.has(e.message_id)) viaRef.current.set(e.message_id, 'socket');
      });
      if (e.status === 'done' || e.status === 'failed') void refresh();
    });
    return () => {
      offEvent();
      offStatus();
      release();
    };
  }, [threadId, refresh]);

  // Poll while a reply is pending (the socket may be down, or the reply isn't streamed).
  const pending = messages.find((m) => m.role === 'assistant' && m.status === 'pending' && !m.queued) ?? null;
  const pendingSince = useRef<{ id: string; at: number } | null>(null);
  if (pending && pendingSince.current?.id !== pending.id) pendingSince.current = { id: pending.id, at: Date.now() };
  if (!pending) pendingSince.current = null;
  const pendingKey = pending ? `${pending.id}:${pending.content.length}` : null;
  const [pollTick, setPollTick] = useState(0);
  useEffect(() => {
    if (!pendingKey || !pendingSince.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const since = pendingSince.current.at;
    const delay = claudeReplyPollMs(Date.now() - since, { open: liveStatus === 'open', sinceEventMs: lastEventAt.current === null ? null : Date.now() - lastEventAt.current });
    const t = setTimeout(() => {
      void refresh().finally(() => setPollTick((n) => n + 1));
    }, delay);
    return () => clearTimeout(t);
    // Re-armed after each poll and whenever the pending reply's text changes.
  }, [pendingKey, liveStatus, refresh, pollTick]);

  // How long each reply took to show (first words, whole), and how it arrived.
  const timings = useRef<Map<string, ReplyTiming>>(new Map());
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      let t = timings.current.get(m.id);
      if (m.status === 'pending') {
        if (!t) {
          t = { startedAt: Date.now(), firstTextAt: null, via: null };
          timings.current.set(m.id, t);
        }
        if (m.content && t.firstTextAt === null) {
          t.firstTextAt = Date.now();
          t.via = viaRef.current.get(m.id) ?? 'poll';
        }
        continue;
      }
      if (t && m.status === null) {
        const now = Date.now();
        const mine = messages.filter((x) => x.role === 'user' && x.created_at <= m.created_at).pop();
        track('claude.reply_shown', {
          first_text_ms: (t.firstTextAt ?? now) - t.startedAt,
          done_ms: now - t.startedAt,
          via: t.via ?? viaRef.current.get(m.id) ?? 'poll',
          intent: mine?.intent ?? 'ask',
          context_kind: opts.contextKind ?? thread?.context_kind ?? 'general',
        });
        timings.current.delete(m.id);
      } else if (t && m.status === 'failed') {
        timings.current.delete(m.id);
      }
    }
  }, [messages, opts.contextKind, thread?.context_kind]);

  return { threadId, thread, messages, loading: loading && !thread, error, notFound, liveStatus, liveTool, refresh };
}
