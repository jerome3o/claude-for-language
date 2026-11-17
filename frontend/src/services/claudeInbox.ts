/**
 * The Claude half of the unified Chats tab (docs/CHAT.md "Chats tab — one list for people and
 * Claude"): the thread list (`GET /api/claude/threads`) kept on the device in the same Dexie table the
 * thread view reads (`claudeThreads`, v37), so the list renders offline. The first fetch is the whole
 * list; after that `?since=<server_time>` brings only what changed and the ids deleted since. The
 * cursor is kept per account (localStorage).
 *
 * A row's per-thread message cursor (`_cursor`, the thread view's `?since=`) and a thread started
 * offline (`local`) are never overwritten by a list row.
 */
import type { ClaudeThreadSummary } from '@shared/claude/api';
import { db } from '../db/database';
import { mergeThreadList } from '@shared/claude/threadCache';
import { listClaudeThreads } from '../api/claudeThreads';
import type { LocalClaudeThread } from './claudeThreads';

const CURSOR_PREFIX = 'claude-thread-list-cursor-v1:';

function readCursor(userId: string): string | null {
  try {
    return localStorage.getItem(CURSOR_PREFIX + userId);
  } catch {
    return null;
  }
}

function writeCursor(userId: string, value: string): void {
  try {
    localStorage.setItem(CURSOR_PREFIX + userId, value);
  } catch {
    /* storage blocked: the next sync is a full one */
  }
}

/**
 * The list rows + deletions into the cache (the rule: `mergeThreadList`, shared/claude/threadCache.ts —
 * a row laid over its cached copy keeps the thread view's message cursor; a thread started offline
 * that the server lists now becomes one row, its messages moved to the server id).
 */
export async function applyThreadList(rows: ClaudeThreadSummary[], deletedIds: string[]): Promise<void> {
  await db.transaction('rw', db.claudeThreads, db.claudeMessages, async () => {
    const ids = [...new Set(rows.flatMap((r) => (r.client_id ? [r.id, r.client_id] : [r.id])))];
    const prev = (await db.claudeThreads.bulkGet(ids)).filter((t): t is LocalClaudeThread => !!t);
    const merged = mergeThreadList<LocalClaudeThread>(prev, rows.map((r) => ({ ...r, local: false })), deletedIds);
    for (const { from, to } of merged.moved) {
      await db.claudeThreads.delete(from);
      const moved = await db.claudeMessages.where('thread_id').equals(from).toArray();
      for (const m of moved) await db.claudeMessages.put({ ...m, thread_id: to });
    }
    await db.claudeThreads.bulkPut(merged.threads.map((t) => ({ ...t, _cursor: t._cursor ?? null })));
    for (const id of merged.removed) {
      await db.claudeThreads.delete(id);
      await db.claudeMessages.where('thread_id').equals(id).delete();
    }
  });
}

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * Bring the device's thread list up to date (whole the first time, then `?since=`). A call while a
 * request is in flight runs ONE more request after it (shared by every call meanwhile): the one in
 * flight may have been answered before what prompted this call (a reply finishing — its `claude_turn`
 * frame), and dropping it left the row "✦ Writing…" until the next minute's refresh. Throws on a
 * network / server error (the cached list stays).
 */
export function syncClaudeThreadList(userId: string, opts: { full?: boolean } = {}): Promise<void> {
  if (running) {
    if (!queued) {
      queued = running
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return syncClaudeThreadList(userId, opts);
        });
    }
    return queued;
  }
  running = (async () => {
    // Nothing on the device (a cleared database, a new sign-in): the whole list, whatever the cursor says.
    const since = opts.full || (await db.claudeThreads.count()) === 0 ? null : readCursor(userId);
    const res = await listClaudeThreads({ since, limit: 200 });
    await applyThreadList(res.threads, res.deleted_ids ?? []);
    if (res.server_time) writeCursor(userId, res.server_time);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** A reply started in a thread (a live `claude_turn` frame): show "Writing a reply…" on its row now. */
export async function markThreadPending(threadId: string): Promise<void> {
  const t = await db.claudeThreads.get(threadId);
  if (t && !t.pending) await db.claudeThreads.update(threadId, { pending: true, failed: false });
}
