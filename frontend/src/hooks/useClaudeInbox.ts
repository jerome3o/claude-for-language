/**
 * The Claude threads of the Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"):
 * read from the device (Dexie `claudeThreads`, so the list shows offline at once) and refreshed from
 * `GET /api/claude/threads?since=` on open, on focus, every minute, when the live socket (re)opens and
 * when a reply finishes (a `claude_turn` frame with status done / failed). A reply starting elsewhere
 * marks its row "Writing a reply…" at once.
 */
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { chatLive } from '../services/chatLive';
import { markThreadPending, syncClaudeThreadList } from '../services/claudeInbox';
import type { LocalClaudeThread } from '../services/claudeThreads';

const REFRESH_MS = 60_000;

export function useClaudeInbox(userId: string | undefined, { live = true }: { live?: boolean } = {}): {
  threads: LocalClaudeThread[] | null;
} {
  const threads = useLiveQuery(() => db.claudeThreads.toArray(), []);

  useEffect(() => {
    if (!userId) return;
    const refresh = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void syncClaudeThreadList(userId).catch(() => {
        /* offline / server error: the cached list stays */
      });
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    let offStatus = () => {};
    let offEvent = () => {};
    let release = () => {};
    if (live) {
      release = chatLive.acquire();
      offStatus = chatLive.onStatus((s) => {
        if (s === 'open') refresh();
      });
      offEvent = chatLive.onEvent((e) => {
        if (e.type !== 'claude_turn') return;
        if (e.status === 'done' || e.status === 'failed') refresh();
        else void markThreadPending(e.thread_id);
      });
    }
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      offEvent();
      offStatus();
      release();
    };
  }, [userId, live]);

  return { threads: threads ?? null };
}
