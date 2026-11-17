/**
 * Claude threads on a device — how what the server sends is merged over what the device already has
 * (docs/CHAT.md "Claude thread view"). Pure: the web keeps the result in IndexedDB
 * (`frontend/src/services/claudeThreads.ts`, `claudeInbox.ts`), the Lab app in its JsonCache
 * (`data/claude/ClaudeThreads.kt`, `ClaudeThreadList.kt`) through the Kotlin port
 * `core/…/claude/ClaudeThreadCache.kt` (parity-tested, `parity/fixtures/claude-thread-cache.ts`).
 *
 * - `sortMessages`: a thread's messages in order.
 * - `mergeMessage`: one server row over the device's copy (a streamed reply keeps its longer text).
 * - `mergeThreadMessages`: a thread / messages response over the device's rows (optimistic rows replaced).
 * - `applyTurnFrame`: a live `claude_turn` frame on the pending reply.
 * - `mergeThreadList`: list rows over the device's threads (deletions, a thread started offline that
 *   the server now lists under its own id).
 *
 * A thread started offline is titled / previewed with `titleFor` / `previewOf` (./context).
 */

/** The fields of a cached message the rules read (`_seq` = the highest live frame applied here). */
export interface CachedMessageFields {
  id: string;
  client_id: string | null;
  role: 'user' | 'assistant';
  created_at: string;
  status: 'pending' | 'failed' | null;
  content: string;
  streaming: boolean;
  error: string | null;
  /** Written without a connection, waiting in the outbox (never dropped by a full refresh). */
  queued?: boolean;
  _seq?: number;
}

/** A thread's messages in order: created_at, then my message before its reply (stable). */
export function sortMessages<T extends Pick<CachedMessageFields, 'created_at' | 'role'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.role === b.role ? 0 : a.role === 'user' ? -1 : 1));
}

/**
 * A server row over what the device has: a reply still being written keeps the longer text this
 * device already streamed (the row is written ≤ every 400 ms, the socket ≤ every 120 ms); anything
 * finished, failed or newer wins. The device's live seq is kept.
 */
export function mergeMessage<T extends Pick<CachedMessageFields, 'status' | 'content' | 'streaming' | '_seq'>>(local: T | undefined, server: T): T {
  if (local && server.status === 'pending' && local.status === 'pending' && local.content.length > server.content.length && local.content.startsWith(server.content)) {
    return { ...server, content: local.content, streaming: true, _seq: local._seq };
  }
  return { ...server, ...(local?._seq !== undefined ? { _seq: local._seq } : {}) };
}

/**
 * A thread / messages response over the device's rows of that thread. `full` = the server's whole
 * list: anything else but my still-queued messages is gone. My optimistic row (its id = its client
 * id) is replaced by the server's row with the same client id. Returns the rows in order and the ids
 * that left.
 */
export function mergeThreadMessages<T extends CachedMessageFields>(prev: readonly T[], server: readonly T[], opts: { full?: boolean } = {}): { messages: T[]; removed: string[] } {
  let rows = [...prev];
  const removed: string[] = [];
  const drop = (keep: (m: T) => boolean) => {
    const next: T[] = [];
    for (const m of rows) {
      if (keep(m)) next.push(m);
      else removed.push(m.id);
    }
    rows = next;
  };
  if (opts.full) {
    const keep = new Set(server.map((m) => m.id));
    drop((m) => keep.has(m.id) || !!m.queued);
  }
  for (const m of server) {
    if (m.client_id) drop((r) => !(r.client_id === m.client_id && r.id !== m.id));
    const i = rows.findIndex((r) => r.id === m.id);
    const merged = mergeMessage(i >= 0 ? rows[i] : undefined, m);
    if (i >= 0) rows[i] = merged;
    else rows.push(merged);
  }
  const live = new Set(rows.map((r) => r.id));
  return { messages: sortMessages(rows), removed: [...new Set(removed)].filter((id) => !live.has(id)) };
}

/** The parts of a live `claude_turn` frame the rule reads. */
export interface TurnFrame {
  seq: number;
  status: string;
  text?: string;
  error?: string;
}

/**
 * A live `claude_turn` frame on the pending reply: the reply's whole text so far (`seq` only grows —
 * an older frame is ignored). Null when nothing changes (an old frame, a reply already finished).
 */
export function applyTurnFrame<T extends Pick<CachedMessageFields, 'status' | 'content' | 'streaming' | 'error' | '_seq'>>(row: T, frame: TurnFrame): T | null {
  if (row._seq !== undefined && frame.seq <= row._seq) return null;
  if (row.status !== 'pending' && frame.status !== 'failed') return null;
  const next: T = { ...row, _seq: frame.seq };
  if (typeof frame.text === 'string' && frame.text.length >= row.content.length) {
    next.content = frame.text;
    next.streaming = frame.text.length > 0;
  }
  if (frame.status === 'failed') {
    next.status = 'failed';
    next.streaming = false;
    next.error = frame.error ?? row.error;
  }
  return next;
}

/** The fields of a cached thread the list rule reads (`local` = started offline, its id is its client id). */
export interface CachedThreadFields {
  id: string;
  client_id: string | null;
  local?: boolean;
}

/**
 * List rows over the device's threads: a row is laid over its old copy (device-only fields kept) or
 * added at the end, `deletedIds` leave (all listed in `removed`, cached or not), and a thread started offline (`local`) that the server now
 * lists under its own id (by the row's client id) leaves — `moved` says where its messages go.
 */
export function mergeThreadList<T extends CachedThreadFields>(
  prev: readonly T[],
  rows: readonly T[],
  deletedIds: readonly string[] = [],
): { threads: T[]; removed: string[]; moved: { from: string; to: string }[] } {
  const byId = new Map<string, T>();
  for (const t of prev) byId.set(t.id, t);
  for (const r of rows) {
    const old = byId.get(r.id);
    byId.set(r.id, old ? { ...old, ...r } : r);
  }
  const removed: string[] = [];
  const moved: { from: string; to: string }[] = [];
  for (const t of [...byId.values()]) {
    if (t.local || !t.client_id || t.client_id === t.id) continue;
    const local = byId.get(t.client_id);
    if (local?.local) {
      byId.delete(t.client_id);
      moved.push({ from: t.client_id, to: t.id });
    }
  }
  for (const id of deletedIds) {
    byId.delete(id);
    if (!removed.includes(id)) removed.push(id);
  }
  return { threads: [...byId.values()], removed, moved };
}
