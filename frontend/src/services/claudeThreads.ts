/**
 * Claude threads on the device (docs/CHAT.md "Claude thread view"): every thread and message as
 * last fetched lives in IndexedDB (Dexie v37 `claudeThreads` / `claudeMessages`) so a thread reads
 * offline, and a message written without a connection goes to `claudeOutbox` with client ids —
 * shown at once as my bubble ("Waiting for a connection") and sent in order by `flushClaudeOutbox`
 * when the browser comes back online and in every sync. The server is idempotent by client id, so a
 * retry after a lost response never makes a second thread or message.
 *
 * A thread started offline lives under its CLIENT id until the server has it; then its rows move to
 * the server's id (`claudeThreads.client_id` keeps the link, so `/chats/claude/<client id>` still
 * finds it — `resolveThreadId`).
 *
 * Live replies (`claude_turn` over the ChatHub socket) patch the pending reply's text here too
 * (`applyTurnEvent`); a poll's older text never overwrites a longer streamed one (`mergeMessage`).
 */
import type { ClaudeThreadMessage, ClaudeThreadSummary, ClaudeTurnEvent } from '@shared/claude/api';
import { contextBadge, previewOf, titleFor, type ClaudeContextSnapshot, type ClaudeIntent, type ClaudeThreadContext } from '@shared/claude/context';
import { db } from '../db/database';
import {
  createClaudeThread,
  getClaudeThread,
  patchClaudeThread,
  retryClaudeThreadMessage,
  sendClaudeThreadMessage,
  type ThreadWithMessages,
} from '../api/claudeThreads';
import { apiErrorStatus } from '../api/client';
import { isPermanentFailure, newClientId } from './chatOutbox';

export interface LocalClaudeThread extends ClaudeThreadSummary {
  /** Not on the server yet (started offline): `id` is the client id. */
  local?: boolean;
  /** The server's `server_time` of the last full / ?since= fetch (the next `since`). */
  _cursor?: string | null;
}

export interface LocalClaudeMessage extends ClaudeThreadMessage {
  /** Written without a connection, waiting in the outbox. */
  queued?: boolean;
  /** The outbox gave up on it (a 4xx): `error` says why. */
  queue_failed?: boolean;
  /** The highest live `claude_turn` seq applied (a lower one is ignored). */
  _seq?: number;
}

export interface ClaudeOutboxEntry {
  /** The message's client id. */
  client_id: string;
  /** The thread it goes to: the server id, or the client id of a thread started offline. */
  thread_id: string;
  /** A message that starts a thread: the thread's client id + context. */
  create?: { thread_client_id: string; context: ClaudeThreadContext };
  text: string;
  intent: ClaudeIntent;
  language?: 'zh' | 'en';
  /** A suggestion chip (not checked). */
  quick?: boolean;
  /** A card thread: the answer typed on that showing of the card (null = none; absent = leave it). */
  typed?: { answer: string; correct?: string } | null;
  /** A reader / exercise thread: its context as it stands on this showing (looked_up / said_wrong, answer). */
  fields?: Record<string, unknown>;
  created_at: string;
  status: 'pending' | 'sending' | 'failed';
  attempts: number;
  error?: string | null;
}

const nowIso = () => new Date().toISOString();

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** A network error (no status) or a server that may answer next time (5xx, 408, 429). */
function shouldQueue(err: unknown): boolean {
  const status = apiErrorStatus(err);
  return status === undefined || !isPermanentFailure(status);
}

// ---------- Reading the cache ----------

/** The thread for a route id: by id, else a thread started offline that got its server id since. */
export async function resolveThreadId(idOrClientId: string): Promise<string | null> {
  const byId = await db.claudeThreads.get(idOrClientId);
  if (byId) return byId.id;
  const byClient = await db.claudeThreads.where('client_id').equals(idOrClientId).first();
  return byClient?.id ?? null;
}

export async function getLocalThread(id: string): Promise<LocalClaudeThread | undefined> {
  return db.claudeThreads.get(id);
}

/** A thread's messages in order (created_at, then my message before its reply). */
export async function getLocalMessages(threadId: string): Promise<LocalClaudeMessage[]> {
  const rows = await db.claudeMessages.where('thread_id').equals(threadId).toArray();
  return sortMessages(rows);
}

export function sortMessages<T extends Pick<ClaudeThreadMessage, 'created_at' | 'role'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.role === b.role ? 0 : a.role === 'user' ? -1 : 1));
}

// ---------- Writing the cache ----------

/**
 * A server row over what the device has: a reply still being written keeps the longer text this
 * device already streamed (the row is written ≤ every 400 ms, the socket ≤ every 120 ms); anything
 * finished, failed or newer wins.
 */
export function mergeMessage(local: LocalClaudeMessage | undefined, server: ClaudeThreadMessage): LocalClaudeMessage {
  if (local && server.status === 'pending' && local.status === 'pending' && local.content.length > server.content.length && local.content.startsWith(server.content)) {
    return { ...server, content: local.content, streaming: true, _seq: local._seq };
  }
  return { ...server, ...(local?._seq !== undefined ? { _seq: local._seq } : {}) };
}

/** A thread / messages response into the cache (my optimistic rows replaced by their server rows). */
export async function cacheThreadResponse(res: ThreadWithMessages, opts: { full?: boolean } = {}): Promise<void> {
  const thread = res.thread;
  if (!thread) return;
  await db.transaction('rw', db.claudeThreads, db.claudeMessages, db.claudeOutbox, async () => {
    const prev = await db.claudeThreads.get(thread.id);
    // A thread started offline: its rows move from the client id to the server id.
    if (thread.client_id && thread.client_id !== thread.id) {
      const local = await db.claudeThreads.get(thread.client_id);
      if (local?.local) {
        await db.claudeThreads.delete(thread.client_id);
        const moved = await db.claudeMessages.where('thread_id').equals(thread.client_id).toArray();
        for (const m of moved) await db.claudeMessages.put({ ...m, thread_id: thread.id });
        const queued = await db.claudeOutbox.where('thread_id').equals(thread.client_id).toArray();
        for (const q of queued) await db.claudeOutbox.put({ ...q, thread_id: thread.id, create: undefined });
      }
    }
    await db.claudeThreads.put({ ...thread, local: false, _cursor: res.server_time ?? prev?._cursor ?? null });
    if (opts.full) {
      // The server's whole list: anything else but my still-queued messages is gone.
      const keep = new Set(res.messages.map((m) => m.id));
      const old = await db.claudeMessages.where('thread_id').equals(thread.id).toArray();
      for (const m of old) if (!keep.has(m.id) && !m.queued) await db.claudeMessages.delete(m.id);
    }
    for (const m of res.messages) {
      if (m.client_id) {
        const optimistic = await db.claudeMessages.where('client_id').equals(m.client_id).toArray();
        for (const o of optimistic) if (o.id !== m.id && o.thread_id === thread.id) await db.claudeMessages.delete(o.id);
      }
      const local = await db.claudeMessages.get(m.id);
      await db.claudeMessages.put(mergeMessage(local, m));
    }
  });
}

/** Fetch a thread (whole, or what changed since the cursor) into the cache. */
export async function refreshClaudeThread(id: string, opts: { full?: boolean } = {}): Promise<ThreadWithMessages> {
  const local = await db.claudeThreads.get(id);
  const since = !opts.full && local?._cursor && !local.local ? local._cursor : null;
  const res = await getClaudeThread(id, since);
  await cacheThreadResponse(res, { full: !since });
  return res;
}

/**
 * A live `claude_turn` frame: the pending reply's whole text so far (`seq` only grows — an older
 * frame is ignored). Returns true when it changed what the screen shows.
 */
export async function applyTurnEvent(e: ClaudeTurnEvent): Promise<boolean> {
  const row = await db.claudeMessages.get(e.message_id);
  if (!row || row.thread_id !== e.thread_id) return false;
  if (row._seq !== undefined && e.seq <= row._seq) return false;
  if (row.status !== 'pending' && e.status !== 'failed') return false;
  const next: LocalClaudeMessage = { ...row, _seq: e.seq };
  if (typeof e.text === 'string' && e.text.length >= row.content.length) {
    next.content = e.text;
    next.streaming = e.text.length > 0;
  }
  if (e.status === 'failed') {
    next.status = 'failed';
    next.streaming = false;
    next.error = e.error ?? row.error;
  }
  await db.claudeMessages.put(next);
  return true;
}

/** The English of a message, kept on its cached row. */
export async function setLocalTranslation(messageId: string, translation: string): Promise<void> {
  await db.claudeMessages.update(messageId, { translation });
}

/**
 * The thread ⋯ → Share with my tutor / Hide from my tutor (shared/claude/visibility.ts): the chat's own
 * choice (null = follow "Your tutor can see"). Online only — the server decides what she reads.
 */
export async function setThreadTutorVisible(threadId: string, value: boolean | null): Promise<ClaudeThreadSummary> {
  const res = await patchClaudeThread(threadId, { tutor_visible: value });
  await db.claudeThreads.update(threadId, { tutor_visible: res.thread.tutor_visible });
  return res.thread;
}

// ---------- Sending ----------

function localThread(clientId: string, context: ClaudeThreadContext, snapshot: ClaudeContextSnapshot, text: string, intent: ClaudeIntent, language: 'zh' | 'en' | undefined): LocalClaudeThread {
  const stored = { ...context, ...snapshot };
  const at = nowIso();
  return {
    id: clientId,
    client_id: clientId,
    title: titleFor(stored, text),
    context_kind: context.kind,
    context: stored,
    badge: contextBadge(stored, intent),
    first_intent: intent,
    preview: previewOf(text),
    last_message_at: at,
    created_at: at,
    unread: 0,
    pending: false,
    failed: false,
    read_only: false,
    archived: false,
    tutor_visible: null,
    language: language ?? null,
    source: 'app',
    local: true,
    _cursor: null,
  };
}

function localUserMessage(threadId: string, clientId: string, text: string, intent: ClaudeIntent): LocalClaudeMessage {
  const at = nowIso();
  return {
    id: clientId,
    thread_id: threadId,
    client_id: clientId,
    role: 'user',
    content_type: 'text',
    content: text,
    intent,
    status: null,
    streaming: false,
    error: null,
    answer_lang: null,
    translation: null,
    tool_results: null,
    created_at: at,
    updated_at: at,
    queued: true,
  };
}

export interface SendResult {
  threadId: string;
  /** No connection: kept in the outbox, sent when one comes back. */
  queued: boolean;
}

/**
 * Start a thread with its first message. Online: created on the server (202, the reply starting);
 * offline (or the request didn't get through): the thread and my bubble are kept here under client
 * ids and sent later. A 4xx is thrown (the caller says why).
 */
export async function startClaudeThread(input: {
  context: ClaudeThreadContext;
  snapshot?: ClaudeContextSnapshot;
  text: string;
  intent: ClaudeIntent;
  language?: 'zh' | 'en';
  quick?: boolean;
}): Promise<SendResult> {
  const threadClientId = newClientId();
  const messageClientId = newClientId();
  const body = {
    client_id: threadClientId,
    message_client_id: messageClientId,
    context: input.context,
    intent: input.intent,
    text: input.text,
    ...(input.language ? { language: input.language } : {}),
    ...(input.quick ? { quick: true } : {}),
  };
  if (!isOffline()) {
    try {
      const res = await createClaudeThread(body);
      await cacheThreadResponse(res, { full: true });
      return { threadId: res.thread.id, queued: false };
    } catch (err) {
      if (!shouldQueue(err)) throw err;
    }
  }
  await db.transaction('rw', db.claudeThreads, db.claudeMessages, db.claudeOutbox, async () => {
    await db.claudeThreads.put(localThread(threadClientId, input.context, input.snapshot ?? {}, input.text, input.intent, input.language));
    await db.claudeMessages.put(localUserMessage(threadClientId, messageClientId, input.text, input.intent));
    await db.claudeOutbox.put({
      client_id: messageClientId,
      thread_id: threadClientId,
      create: { thread_client_id: threadClientId, context: input.context },
      text: input.text,
      intent: input.intent,
      language: input.language,
      ...(input.quick ? { quick: true } : {}),
      created_at: nowIso(),
      status: 'pending',
      attempts: 0,
    });
  });
  return { threadId: threadClientId, queued: true };
}

/**
 * Start a role-play (Practice with Claude, shared/claude/practice.ts): a practice thread with no
 * message — Claude speaks first. Needs a connection (the scene is written by the server); throws when
 * there is none or the server says no. The thread (with Claude's pending opener) is cached at once so
 * the thread screen draws it before the first poll.
 */
export async function startPracticeThread(context: ClaudeThreadContext & { kind: 'practice' }, opts: { language?: 'zh' | 'en' } = {}): Promise<string> {
  if (isOffline()) throw new Error('Practising with Claude needs a connection.');
  const res = await createClaudeThread({ client_id: newClientId(), context: stripPracticeSnapshot(context), text: '', ...(opts.language ? { language: opts.language } : {}) });
  await cacheThreadResponse(res, { full: true });
  return res.thread.id;
}

function stripPracticeSnapshot<T extends Record<string, unknown>>(ctx: T): T {
  const { label: _l, sublabel: _s, ...rest } = ctx as T & { label?: unknown; sublabel?: unknown };
  return rest as unknown as T;
}

/** A message in an existing thread (Ask). Offline → queued like `startClaudeThread`. */
export async function sendClaudeMessage(
  threadId: string,
  input: {
    text: string;
    language?: 'zh' | 'en';
    quick?: boolean;
    typed?: { answer: string; correct?: string } | null;
    /** A reader / exercise thread: the context fields as they stand now (`looked_up`, `said_wrong`, `answer`). */
    fields?: Record<string, unknown>;
  },
): Promise<SendResult> {
  const clientId = newClientId();
  const thread = await db.claudeThreads.get(threadId);
  const extras = {
    ...(input.fields ?? {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.quick ? { quick: true } : {}),
    ...(input.typed !== undefined ? { typed: input.typed } : {}),
  };
  if (!isOffline() && !thread?.local) {
    try {
      const res = await sendClaudeThreadMessage(threadId, { client_id: clientId, text: input.text, ...extras });
      await cacheThreadResponse(res);
      return { threadId, queued: false };
    } catch (err) {
      if (!shouldQueue(err)) throw err;
    }
  }
  await db.transaction('rw', db.claudeMessages, db.claudeOutbox, async () => {
    await db.claudeMessages.put(localUserMessage(threadId, clientId, input.text, 'ask'));
    await db.claudeOutbox.put({
      client_id: clientId,
      thread_id: threadId,
      text: input.text,
      intent: 'ask',
      language: input.language,
      ...(input.quick ? { quick: true } : {}),
      ...(input.typed !== undefined ? { typed: input.typed } : {}),
      ...(input.fields ? { fields: input.fields } : {}),
      created_at: nowIso(),
      status: 'pending',
      attempts: 0,
    });
  });
  return { threadId, queued: true };
}

export async function retryClaudeReply(threadId: string, messageId: string): Promise<void> {
  const res = await retryClaudeThreadMessage(threadId, messageId);
  await cacheThreadResponse(res, { full: true });
}

/** How many messages are waiting for a connection (all threads, or one). */
export async function queuedCount(threadId?: string): Promise<number> {
  return threadId ? db.claudeOutbox.where('thread_id').equals(threadId).count() : db.claudeOutbox.count();
}

let flushing: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Send what was written offline, oldest first. A message whose thread is still being created waits
 * for it; a network error stops the run (next time); a refusal (4xx) marks that message failed.
 */
export function flushClaudeOutbox(): Promise<{ sent: number; failed: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let failed = 0;
    if (isOffline()) return { sent, failed };
    const entries = (await db.claudeOutbox.orderBy('created_at').toArray()).filter((e) => e.status !== 'failed');
    for (const entry of entries) {
      // A follow-up in a thread whose creation is still queued: after it (same run, already moved).
      const current = await db.claudeOutbox.get(entry.client_id);
      if (!current || current.status === 'failed') continue;
      const thread = await db.claudeThreads.get(current.thread_id);
      if (!current.create && thread?.local) continue;
      try {
        const res = current.create
          ? await createClaudeThread({
              client_id: current.create.thread_client_id,
              message_client_id: current.client_id,
              context: current.create.context,
              intent: current.intent,
              text: current.text,
              ...(current.language ? { language: current.language } : {}),
              ...(current.quick ? { quick: true } : {}),
            })
          : await sendClaudeThreadMessage(current.thread_id, {
              ...(current.fields ?? {}),
              client_id: current.client_id,
              text: current.text,
              ...(current.language ? { language: current.language } : {}),
              ...(current.quick ? { quick: true } : {}),
              ...(current.typed !== undefined ? { typed: current.typed } : {}),
            });
        await db.claudeOutbox.delete(current.client_id);
        await cacheThreadResponse(res, { full: !!current.create });
        sent++;
      } catch (err) {
        const status = apiErrorStatus(err);
        // 409: Claude is still answering the previous message — try again next time.
        if (shouldQueue(err) || status === 409) {
          await db.claudeOutbox.update(current.client_id, { attempts: current.attempts + 1, error: err instanceof Error ? err.message : null });
          break;
        }
        const message = err instanceof Error ? err.message : 'Couldn’t send it';
        await db.claudeOutbox.update(current.client_id, { status: 'failed', attempts: current.attempts + 1, error: message });
        await db.claudeMessages.update(current.client_id, { queued: false, queue_failed: true, error: message });
        failed++;
      }
    }
    return { sent, failed };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Forget a queued message that failed (✕ on its bubble). */
export async function discardQueuedMessage(clientId: string): Promise<void> {
  await db.transaction('rw', db.claudeOutbox, db.claudeMessages, async () => {
    await db.claudeOutbox.delete(clientId);
    await db.claudeMessages.delete(clientId);
  });
}

let wired = false;
/** Send the outbox whenever the browser comes back online (once per tab). */
export function wireClaudeOutbox(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('online', () => {
    void flushClaudeOutbox().catch(() => {});
  });
}
