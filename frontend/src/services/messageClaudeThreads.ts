/**
 * A chat message's Claude threads on the device (Discuss with Claude, docs/CHAT.md "Discuss with
 * Claude"): the `chat_message` threads about one message from the same Dexie table the Chats tab and
 * the thread view read (`claudeThreads`), brought up to date from
 * `GET /api/claude/threads?context_kind=chat_message` when online, so the sheet resumes the message's
 * thread (`resumeThreadFor`: one per message) — offline too.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { listClaudeThreads } from '../api/claudeThreads';
import { applyThreadList } from './claudeInbox';
import type { LocalClaudeThread } from './claudeThreads';

export function isMessageThreadOf(t: Pick<LocalClaudeThread, 'context_kind' | 'context'>, messageId: string): boolean {
  return t.context_kind === 'chat_message' && t.context.kind === 'chat_message' && t.context.message_id === messageId;
}

/** Live: the message's threads on this device (undefined while loading). */
export function useMessageThreads(messageId: string): LocalClaudeThread[] | undefined {
  return useLiveQuery(async () => (await db.claudeThreads.toArray()).filter((t) => isMessageThreadOf(t, messageId)), [messageId]);
}

/** The server's Discuss threads into the cache. Throws on a network / server error. */
export async function refreshMessageThreads(): Promise<void> {
  const res = await listClaudeThreads({ contextKind: 'chat_message', limit: 100 });
  await applyThreadList(res.threads, []);
}
