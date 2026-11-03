/**
 * The Claude threads of ONE context on the device — a graded reader's page ("📖 Ask Claude about this
 * page") or a mini lesson's exercise ("💬 Ask Claude") — from the same Dexie table the Chats tab and the
 * thread view read (`claudeThreads`), brought up to date from
 * `GET /api/claude/threads?context_kind=&context_ref=` when online, so the sheet resumes the recent
 * thread (`resumeThreadFor`, 30 minutes) — offline too. The card's version is cardClaudeThreads.ts.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { contextRef, type ClaudeContextKind, type ClaudeThreadContext } from '@shared/claude/context';
import { db } from '../db/database';
import { listClaudeThreads } from '../api/claudeThreads';
import { applyThreadList } from './claudeInbox';
import type { LocalClaudeThread } from './claudeThreads';

export function isThreadOf(t: Pick<LocalClaudeThread, 'context_kind' | 'context'>, kind: ClaudeContextKind, ref: string): boolean {
  return t.context_kind === kind && t.context.kind === kind && contextRef(t.context) === ref;
}

/** The context's threads on this device (archived included — the rules leave them out). */
export async function localContextThreads(kind: ClaudeContextKind, ref: string): Promise<LocalClaudeThread[]> {
  const all = await db.claudeThreads.toArray();
  return all.filter((t) => isThreadOf(t, kind, ref));
}

/** Live: the context's threads on this device (undefined while loading). */
export function useContextThreads(ctx: ClaudeThreadContext): LocalClaudeThread[] | undefined {
  const ref = contextRef(ctx) ?? '';
  return useLiveQuery(() => localContextThreads(ctx.kind, ref), [ctx.kind, ref]);
}

/** The server's threads of the context into the cache. Throws on a network / server error. */
export async function refreshContextThreads(ctx: ClaudeThreadContext): Promise<void> {
  const ref = contextRef(ctx);
  if (!ref) return;
  const res = await listClaudeThreads({ contextKind: ctx.kind, contextRef: ref, limit: 20 });
  await applyThreadList(res.threads, []);
}
