/**
 * A card's Claude threads on the device (Ask Claude on a study card, docs/STUDY_SESSION.md "Ask
 * Claude"): the threads about one note from the same Dexie table the Chats tab and the thread view
 * read (`claudeThreads`), brought up to date from `GET /api/claude/threads?context_kind=card&note_id=`
 * when online, so the sheet resumes the card's recent thread (`resumeThreadFor`, 30 minutes) and lists
 * the earlier ones — offline too. The card hub, the History modal and "Claude conversations" list
 * the same rows (components/claude/CardClaudeThreads.tsx).
 *
 * Also which replies' card tools this device already applied (`markCardEffectsApplied`), so reopening
 * a thread never applies an edit twice.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { listClaudeThreads } from '../api/claudeThreads';
import { applyThreadList } from './claudeInbox';
import type { LocalClaudeThread } from './claudeThreads';

export function isCardThreadOf(t: Pick<LocalClaudeThread, 'context_kind' | 'context'>, noteId: string): boolean {
  return t.context_kind === 'card' && t.context.kind === 'card' && t.context.note_id === noteId;
}

/** The note's threads on this device (archived included — the rules leave them out). */
export async function localCardThreads(noteId: string): Promise<LocalClaudeThread[]> {
  const all = await db.claudeThreads.toArray();
  return all.filter((t) => isCardThreadOf(t, noteId));
}

/** Live: the note's threads on this device (undefined while loading). */
export function useCardThreads(noteId: string): LocalClaudeThread[] | undefined {
  return useLiveQuery(() => localCardThreads(noteId), [noteId]);
}

/** Every card thread on this device ("Claude conversations"; archived included — the list leaves them out). */
export async function localAllCardThreads(): Promise<LocalClaudeThread[]> {
  const all = await db.claudeThreads.toArray();
  return all.filter((t) => t.context_kind === 'card' && t.context.kind === 'card');
}

export function useAllCardThreads(): LocalClaudeThread[] | undefined {
  return useLiveQuery(() => localAllCardThreads(), []);
}

/** The server's card threads (newest first, up to `limit`) into the cache. Throws on a network / server error. */
export async function refreshAllCardThreads(limit = 200): Promise<void> {
  const res = await listClaudeThreads({ contextKind: 'card', limit });
  await applyThreadList(res.threads, []);
}

/** The server's threads about the note into the cache. Throws on a network / server error. */
export async function refreshCardThreads(noteId: string): Promise<void> {
  const res = await listClaudeThreads({ contextKind: 'card', noteId, limit: 50 });
  await applyThreadList(res.threads, []);
}

// ---------- Card tools applied once per reply ----------

const APPLIED_KEY = 'claude-card-effects-v1';
const APPLIED_MAX = 200;

function readApplied(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(APPLIED_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * True the first time for a reply id (and remembers it): its card tools are applied to this device's
 * study state once. Storage blocked → always true (the effects are idempotent enough: an edit writes
 * the server's own note, a sync, a refresh).
 */
export function markCardEffectsApplied(replyId: string): boolean {
  const list = readApplied();
  if (list.includes(replyId)) return false;
  list.push(replyId);
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify(list.slice(-APPLIED_MAX)));
  } catch {
    /* storage blocked */
  }
  return true;
}
