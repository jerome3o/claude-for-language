/**
 * API client for card flags, Ask-Claude history and the card hub
 * (worker routes/card-flags.ts and routes/claude-chats.ts).
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { CardFlag, CardFlagStatus, ClaudeChatsResponse, NoteHub } from '../types/cardFlags';

const API_PATH = `${API_BASE}/api`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${API_PATH}${url}`, { ...options, credentials: 'include', headers });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export interface CreateCardFlagInput {
  id?: string;
  relationship_id: string;
  note_id: string;
  card_id?: string | null;
  message: string;
  created_at?: string;
}

export async function createCardFlag(input: CreateCardFlagInput): Promise<{ flag: CardFlag; created: boolean }> {
  return request('/card-flags', { method: 'POST', body: JSON.stringify(input) });
}

export async function listCardFlags(relId: string, status: CardFlagStatus | 'all' = 'all'): Promise<{ flags: CardFlag[]; open: number }> {
  return request(`/relationships/${relId}/card-flags?status=${status}`);
}

export async function replyToCardFlag(flagId: string, reply: string): Promise<{ flag: CardFlag }> {
  return request(`/card-flags/${flagId}/reply`, { method: 'POST', body: JSON.stringify({ reply }) });
}

export async function resolveCardFlag(flagId: string): Promise<{ flag: CardFlag }> {
  return request(`/card-flags/${flagId}/resolve`, { method: 'POST' });
}

export async function reopenCardFlag(flagId: string): Promise<{ flag: CardFlag }> {
  return request(`/card-flags/${flagId}/reopen`, { method: 'POST' });
}

export async function deleteCardFlag(flagId: string): Promise<void> {
  await request(`/card-flags/${flagId}`, { method: 'DELETE' });
}

function chatsQuery(opts: { limit?: number; before?: string | null; noteId?: string | null }): string {
  const p = new URLSearchParams();
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.before) p.set('before', opts.before);
  if (opts.noteId) p.set('note_id', opts.noteId);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listMyClaudeChats(opts: { limit?: number; before?: string | null; noteId?: string | null } = {}): Promise<ClaudeChatsResponse> {
  return request(`/me/claude-chats${chatsQuery(opts)}`);
}

export async function listStudentClaudeChats(
  relId: string,
  opts: { limit?: number; before?: string | null; noteId?: string | null } = {}
): Promise<ClaudeChatsResponse> {
  return request(`/relationships/${relId}/claude-chats${chatsQuery(opts)}`);
}

export async function getMyNoteHub(noteId: string): Promise<NoteHub> {
  return request(`/notes/${noteId}/hub`);
}

export async function getStudentNoteHub(relId: string, noteId: string): Promise<NoteHub> {
  return request(`/relationships/${relId}/notes/${noteId}/hub`);
}
