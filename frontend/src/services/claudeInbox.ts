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

/** A list row over what the device has (keeping the thread view's message cursor). */
export function mergeListRow(prev: LocalClaudeThread | undefined, row: ClaudeThreadSummary): LocalClaudeThread {
  return { ...prev, ...row, local: false, _cursor: prev?._cursor ?? null };
}

/** The list rows + deletions into the cache. */
export async function applyThreadList(rows: ClaudeThreadSummary[], deletedIds: string[]): Promise<void> {
  await db.transaction('rw', db.claudeThreads, db.claudeMessages, async () => {
    for (const row of rows) {
      const prev = await db.claudeThreads.get(row.id);
      await db.claudeThreads.put(mergeListRow(prev, row));
      // A thread started offline that the server has now (sent by the outbox elsewhere): one row.
      if (row.client_id && row.client_id !== row.id) {
        const local = await db.claudeThreads.get(row.client_id);
        if (local?.local) {
          await db.claudeThreads.delete(row.client_id);
          const moved = await db.claudeMessages.where('thread_id').equals(row.client_id).toArray();
          for (const m of moved) await db.claudeMessages.put({ ...m, thread_id: row.id });
        }
      }
    }
    for (const id of deletedIds) {
      await db.claudeThreads.delete(id);
      await db.claudeMessages.where('thread_id').equals(id).delete();
    }
  });
}

let running: Promise<void> | null = null;

/**
 * Bring the device's thread list up to date (whole the first time, then `?since=`). Concurrent calls
 * share one request. Throws on a network / server error (the cached list stays).
 */
export function syncClaudeThreadList(userId: string, opts: { full?: boolean } = {}): Promise<void> {
  if (running) return running;
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
