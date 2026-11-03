/**
 * Claude threads API (worker/src/routes/claude-threads.ts; docs/CHAT.md "Claude threads"). Errors
 * carry `.status` (apiErrorStatus); a network error has none.
 */
import type { ClaudeThreadMessage, ClaudeThreadSummary } from '@shared/claude/api';
import type { ClaudeIntent, ClaudeThreadContext } from '@shared/claude/context';
import { API_BASE, getAuthHeaders } from './client';

export interface ThreadWithMessages {
  thread: ClaudeThreadSummary;
  messages: ClaudeThreadMessage[];
  server_time?: string;
  existing?: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export function listClaudeThreads(opts: { since?: string | null; contextKind?: string; noteId?: string; contextRef?: string; limit?: number } = {}): Promise<{
  threads: ClaudeThreadSummary[];
  deleted_ids: string[];
  server_time: string;
}> {
  const q = new URLSearchParams();
  if (opts.since) q.set('since', opts.since);
  if (opts.contextKind) q.set('context_kind', opts.contextKind);
  if (opts.noteId) q.set('note_id', opts.noteId);
  if (opts.contextRef) q.set('context_ref', opts.contextRef);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return call(`/claude/threads${qs ? `?${qs}` : ''}`);
}

export function createClaudeThread(body: {
  client_id: string;
  context: ClaudeThreadContext;
  /** Default ask. */
  intent?: ClaudeIntent;
  /** '' = Claude speaks first (a role-play). */
  text: string;
  message_client_id?: string;
  language?: 'zh' | 'en';
  title?: string;
  /** A suggestion chip (the app wrote it): not checked. */
  quick?: boolean;
}): Promise<ThreadWithMessages> {
  return call('/claude/threads', { method: 'POST', body: JSON.stringify(body) });
}

export function getClaudeThread(id: string, since?: string | null): Promise<ThreadWithMessages> {
  return call(`/claude/threads/${encodeURIComponent(id)}${since ? `?since=${encodeURIComponent(since)}` : ''}`);
}

export function sendClaudeThreadMessage(
  id: string,
  body: {
    client_id: string;
    text: string;
    intent?: ClaudeIntent;
    language?: 'zh' | 'en';
    /** A suggestion chip (the app wrote it): not checked. */
    quick?: boolean;
    /** A card thread: the answer typed on this showing of the card (null = none). */
    typed?: { answer: string; correct?: string } | null;
    /** A reader thread's looked-up / misread words, an exercise thread's answer (null = none). */
    looked_up?: unknown;
    said_wrong?: unknown;
    answer?: unknown;
  },
): Promise<ThreadWithMessages> {
  return call(`/claude/threads/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify(body) });
}

export function retryClaudeThreadMessage(id: string, messageId: string): Promise<ThreadWithMessages> {
  return call(`/claude/threads/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/retry`, { method: 'POST', body: '{}' });
}

export function patchClaudeThread(id: string, patch: { title?: string; archived?: boolean; read?: true; language?: 'zh' | 'en' | null }): Promise<{ thread: ClaudeThreadSummary }> {
  return call(`/claude/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteClaudeThread(id: string): Promise<{ deleted: true }> {
  return call(`/claude/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
