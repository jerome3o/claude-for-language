/**
 * The chat's offline outbox (docs/CHAT.md PR 2 "Optimistic send"): every text,
 * photo and voice message is written here first with a client_id, shown at once
 * as a bubble, and sent by `flushOutbox` — at once, when the browser comes back
 * online, and whenever a chat opens. The server is idempotent by client_id, so a
 * retry after a lost response never makes a duplicate. Persisted in its own
 * small IndexedDB (blobs included) so a reload or a closed tab loses nothing.
 *
 * `outboxReduce` is the pure state machine (unit-tested in chatOutbox.test.ts):
 *   pending --start--> sending --ok--> (removed)
 *                              --error (network / 5xx / 429)--> pending (backoff) | failed (after MAX_ATTEMPTS)
 *                              --error (other 4xx)------------> failed
 *   failed --retry--> pending        sending --reset--> pending (a tab died mid-send)
 */

import Dexie, { type Table } from 'dexie';
import type { MessageWithSender } from '../types';
import { sendChatMedia, sendChatText } from '../api/chat';

export type OutboxKind = 'text' | 'image' | 'voice';
export type OutboxStatus = 'pending' | 'sending' | 'failed';

export interface OutboxEntry {
  client_id: string;
  conversation_id: string;
  kind: OutboxKind;
  /** Text, or a photo's caption. */
  content: string;
  reply_to_message_id?: string | null;
  /** What the reply preview shows while pending. */
  reply_preview?: { content: string; sender_name: string | null } | null;
  blob?: Blob | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  created_at: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which an automatic retry waits (backoff). */
  next_attempt_at?: number;
  error?: string | null;
}

export type OutboxEvent =
  | { type: 'start' }
  | { type: 'ok' }
  | { type: 'error'; status?: number; message?: string; now: number }
  | { type: 'retry' }
  | { type: 'reset' };

export const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [2000, 5000, 15000, 30000, 60000];

/** A 4xx other than timeout / rate limit will fail the same way again. */
export function isPermanentFailure(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function outboxReduce(entry: OutboxEntry, event: OutboxEvent): OutboxEntry | null {
  switch (event.type) {
    case 'start':
      return entry.status === 'pending' ? { ...entry, status: 'sending' } : entry;
    case 'ok':
      return null;
    case 'reset':
      return entry.status === 'sending' ? { ...entry, status: 'pending' } : entry;
    case 'retry':
      return entry.status === 'failed'
        ? { ...entry, status: 'pending', attempts: 0, error: null, next_attempt_at: 0 }
        : entry;
    case 'error': {
      const attempts = entry.attempts + 1;
      const message = event.message || null;
      if (isPermanentFailure(event.status) || attempts >= MAX_ATTEMPTS) {
        return { ...entry, status: 'failed', attempts, error: message };
      }
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      return { ...entry, status: 'pending', attempts, error: message, next_attempt_at: event.now + wait };
    }
  }
}

/** Is an entry due for an automatic send? (`force` = the network just came back / a chat opened.) */
export function outboxDue(entry: OutboxEntry, now: number, force = false): boolean {
  if (entry.status !== 'pending') return false;
  return force || !entry.next_attempt_at || entry.next_attempt_at <= now;
}

// ---------- Storage ----------

class ChatOutboxDb extends Dexie {
  items!: Table<OutboxEntry, string>;
  constructor() {
    super('chat-outbox');
    this.version(1).stores({ items: 'client_id, conversation_id, created_at' });
  }
}

let dbInstance: ChatOutboxDb | null = null;
function store(): ChatOutboxDb {
  if (!dbInstance) dbInstance = new ChatOutboxDb();
  return dbInstance;
}

export function newClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* insecure context */
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type Listener = () => void;
type DeliveredListener = (message: MessageWithSender, entry: OutboxEntry) => void;
const listeners = new Set<Listener>();
const deliveredListeners = new Set<DeliveredListener>();

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a listener's problem */
    }
  });
}

/** Called after any outbox change (enqueue, status, delivery). */
export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called with the server's message when an entry is delivered (replaces its bubble by client_id). */
export function onOutboxDelivered(listener: DeliveredListener): () => void {
  deliveredListeners.add(listener);
  return () => deliveredListeners.delete(listener);
}

export async function listOutbox(conversationId: string): Promise<OutboxEntry[]> {
  try {
    const rows = await store().items.where('conversation_id').equals(conversationId).toArray();
    return rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  } catch {
    return [];
  }
}

let lastCreated = 0;
/** Strictly increasing ISO times, so two sends in the same millisecond keep their order. */
function monotonicNow(): string {
  lastCreated = Math.max(Date.now(), lastCreated + 1);
  return new Date(lastCreated).toISOString();
}

export async function enqueueOutbox(
  input: Omit<OutboxEntry, 'client_id' | 'created_at' | 'status' | 'attempts'> & { client_id?: string },
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    ...input,
    client_id: input.client_id || newClientId(),
    created_at: monotonicNow(),
    status: 'pending',
    attempts: 0,
  };
  await store().items.put(entry);
  emit();
  void flushOutbox({ conversationId: entry.conversation_id });
  return entry;
}

async function apply(clientId: string, event: OutboxEvent): Promise<OutboxEntry | null> {
  const table = store().items;
  const held = await table.get(clientId);
  if (!held) return null;
  const next = outboxReduce(held, event);
  if (next) await table.put(next);
  else await table.delete(clientId);
  emit();
  return next;
}

export async function retryOutbox(clientId: string): Promise<void> {
  const entry = await apply(clientId, { type: 'retry' });
  if (entry) void flushOutbox({ conversationId: entry.conversation_id, force: true });
}

export async function discardOutbox(clientId: string): Promise<void> {
  await store().items.delete(clientId);
  emit();
}

async function sendEntry(entry: OutboxEntry): Promise<MessageWithSender> {
  if (entry.kind === 'text') {
    return sendChatText(entry.conversation_id, {
      content: entry.content,
      client_id: entry.client_id,
      reply_to_message_id: entry.reply_to_message_id,
    });
  }
  if (!entry.blob) throw Object.assign(new Error('The recording or photo is missing'), { status: 400 });
  return sendChatMedia(entry.conversation_id, {
    kind: entry.kind,
    blob: entry.blob,
    client_id: entry.client_id,
    caption: entry.content || null,
    reply_to_message_id: entry.reply_to_message_id,
    duration_ms: entry.duration_ms,
  });
}

let flushing: Promise<void> | null = null;
let again = false;
let againForce = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let resetDone = false;

/**
 * Send what is due, oldest first. Within one conversation a retryable failure
 * stops the rest (order is kept); permanently failed entries are skipped.
 */
export function flushOutbox(opts: { conversationId?: string; force?: boolean } = {}): Promise<void> {
  if (flushing) {
    again = true;
    againForce = againForce || !!opts.force;
    return flushing;
  }
  flushing = (async () => {
    let force = !!opts.force;
    do {
      again = false;
      await flushOnce(force);
      force = againForce;
      againForce = false;
    } while (again);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function flushOnce(force: boolean): Promise<void> {
  let rows: OutboxEntry[];
  try {
    if (!resetDone) {
      resetDone = true;
      // A tab that died mid-send leaves 'sending' rows behind: they go back to pending.
      const stale = await store().items.filter((e) => e.status === 'sending').toArray();
      for (const e of stale) await store().items.put(outboxReduce(e, { type: 'reset' })!);
    }
    rows = await store().items.toArray();
  } catch {
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const blocked = new Set<string>();
  const now = Date.now();
  for (const row of rows) {
    if (blocked.has(row.conversation_id)) continue;
    if (row.status === 'failed') continue;
    if (!outboxDue(row, now, force)) {
      blocked.add(row.conversation_id);
      continue;
    }
    await apply(row.client_id, { type: 'start' });
    try {
      const message = await sendEntry(row);
      await apply(row.client_id, { type: 'ok' });
      deliveredListeners.forEach((l) => {
        try {
          l(message, row);
        } catch {
          /* ignore */
        }
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      const next = await apply(row.client_id, {
        type: 'error',
        status,
        message: err instanceof Error ? err.message : String(err),
        now: Date.now(),
      });
      if (next?.status === 'pending') blocked.add(row.conversation_id);
    }
  }
  scheduleNext();
}

async function scheduleNext() {
  if (timer) clearTimeout(timer);
  timer = null;
  let rows: OutboxEntry[];
  try {
    rows = await store().items.filter((e) => e.status === 'pending').toArray();
  } catch {
    return;
  }
  if (rows.length === 0) return;
  const soonest = Math.min(...rows.map((r) => r.next_attempt_at || 0));
  timer = setTimeout(() => void flushOutbox(), Math.max(500, soonest - Date.now()));
}

let started = false;
/** Flush when the browser comes back online (idempotent). */
export function startOutbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void flushOutbox({ force: true }));
  void flushOutbox();
}

/** Test hook: wait for any running flush, empty the store, forget module state. */
export async function __resetOutboxForTests(): Promise<void> {
  while (flushing) await flushing.catch(() => undefined);
  if (timer) clearTimeout(timer);
  timer = null;
  again = false;
  againForce = false;
  resetDone = false;
  await store().items.clear();
}
