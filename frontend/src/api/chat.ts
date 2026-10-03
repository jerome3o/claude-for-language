/**
 * API client for the live chat & rich messages (docs/CHAT.md PR 2): the live
 * ticket, idempotent text / media sends, edit / delete / pin, and the media bytes.
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { ChatWord, MessageWithSender, ProposedChatCard } from '../types';

const API_PATH = `${API_BASE}/api`;

/** An error with the HTTP status (undefined for a network failure). */
export type ChatApiError = Error & { status?: number };

async function request<T>(url: string, options?: RequestInit & { rawBody?: boolean }): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.rawBody ? {} : { 'Content-Type': 'application/json' }),
    ...getAuthHeaders(),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${API_PATH}${url}`, { ...options, credentials: 'include', headers });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status });
  }
  return response.json();
}

export function getLiveTicket(): Promise<{ ticket: string; ws_path: string }> {
  return request('/live/ticket', { method: 'POST', body: '{}' });
}

/** The WebSocket URL for a live ticket (dev: the worker on :8787, like the call room). */
export function liveSocketUrl(wsPath: string, ticket: string): string {
  const base = API_BASE || (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:8787` : window.location.origin);
  const url = new URL(wsPath, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

export function sendChatText(
  conversationId: string,
  input: { content: string; client_id: string; reply_to_message_id?: string | null },
): Promise<MessageWithSender> {
  return request(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: input.content,
      client_id: input.client_id,
      ...(input.reply_to_message_id ? { reply_to_message_id: input.reply_to_message_id } : {}),
    }),
  });
}

export function sendChatMedia(
  conversationId: string,
  input: {
    kind: 'image' | 'voice' | 'file' | 'video';
    blob: Blob;
    client_id: string;
    caption?: string | null;
    reply_to_message_id?: string | null;
    duration_ms?: number | null;
    /** A file's name (kind file). */
    name?: string | null;
    width?: number | null;
    height?: number | null;
  },
): Promise<MessageWithSender> {
  const q = new URLSearchParams({ kind: input.kind, client_id: input.client_id });
  if (input.caption) q.set('caption', input.caption);
  if (input.reply_to_message_id) q.set('reply_to_message_id', input.reply_to_message_id);
  if (input.duration_ms != null) q.set('duration_ms', String(Math.round(input.duration_ms)));
  if (input.name) q.set('name', input.name);
  if (input.width) q.set('width', String(Math.round(input.width)));
  if (input.height) q.set('height', String(Math.round(input.height)));
  return request(`/conversations/${conversationId}/media?${q.toString()}`, {
    method: 'POST',
    rawBody: true,
    headers: { 'Content-Type': input.blob.type || 'application/octet-stream' },
    body: input.blob,
  });
}

/** Forward a message into another of my conversations (round 2 PR 3); idempotent by client_id. */
export function forwardChatMessage(messageId: string, conversationId: string, clientId: string): Promise<MessageWithSender> {
  return request(`/messages/${messageId}/forward`, { method: 'POST', body: JSON.stringify({ conversation_id: conversationId, client_id: clientId }) });
}

export function editChatMessage(messageId: string, content: string): Promise<MessageWithSender> {
  return request(`/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ content }) });
}

export function deleteChatMessage(messageId: string): Promise<MessageWithSender | { ok: boolean }> {
  return request(`/messages/${messageId}`, { method: 'DELETE' });
}

export function pinChatMessage(messageId: string, pinned: boolean): Promise<MessageWithSender | { ok: boolean }> {
  return request(`/messages/${messageId}/pin`, { method: 'POST', body: JSON.stringify({ pinned }) });
}

/** The media bytes of a message (auth needed: the R2 key never reaches the client). */
export async function fetchChatMediaBlob(mediaUrl: string): Promise<Blob> {
  const url = /^https?:/.test(mediaUrl) ? mediaUrl : `${API_BASE}${mediaUrl}`;
  const res = await fetch(url, { credentials: 'include', headers: getAuthHeaders() });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.blob();
}

// ---------- Listening mode (docs/CHAT.md "Listening mode") ----------

export interface ListeningStateResponse {
  default_on: boolean;
  conversations: Array<{ conversation_id: string; on: boolean; since: string | null; updated_at: string }>;
}

export function getChatListening(): Promise<ListeningStateResponse> {
  return request('/me/chat-listening');
}

export function putConversationListening(conversationId: string, on: boolean, since: string | null): Promise<{ conversation_id: string; on: boolean; since: string | null; updated_at: string }> {
  return request(`/conversations/${conversationId}/listening`, { method: 'PUT', body: JSON.stringify({ on, since }) });
}

export function putChatListeningDefault(on: boolean): Promise<{ default_on: boolean }> {
  return request('/profile/chat-listening', { method: 'PUT', body: JSON.stringify({ on }) });
}

export function getChatClips(perConversation?: number): Promise<{ clips: Array<{ message_id: string; conversation_id: string; text: string; voice_id: string; speed: number }> }> {
  return request(`/me/chat-clips${perConversation ? `?per_conversation=${perConversation}` : ''}`);
}

// ---------- Learning tools (docs/CHAT.md PR 3) ----------

/** The message's word chips, made now when missing (null = no Chinese / not transcribed yet). */
export function requestMessageWords(
  messageId: string,
): Promise<{ words: ChatWord[] | null; source: 'content' | 'transcript' | null; cached: boolean }> {
  return request(`/messages/${messageId}/words`, { method: 'POST', body: '{}' });
}

export interface ProposeFlashcardsBody {
  message_ids?: string[];
  since?: string;
  focus?: 'correction';
}

/** Claude's proposed cards from some of the chat (nothing is saved). */
export function proposeChatFlashcards(conversationId: string, body: ProposeFlashcardsBody): Promise<{ cards: ProposedChatCard[] }> {
  return request(`/conversations/${conversationId}/flashcards/propose`, { method: 'POST', body: JSON.stringify(body) });
}

/** The tutor's correction of the other person's message → the message. */
export function setMessageCorrection(messageId: string, text: string, note?: string | null): Promise<MessageWithSender> {
  return request(`/messages/${messageId}/correction`, {
    method: 'PUT',
    body: JSON.stringify({ text, ...(note ? { note } : {}) }),
  });
}

export function clearMessageCorrection(messageId: string): Promise<MessageWithSender> {
  return request(`/messages/${messageId}/correction`, { method: 'DELETE' });
}

/** A link's preview card (docs/CHAT.md "Round 2"); null when the page has nothing to show. */
export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  try {
    return await request<LinkPreviewData>(`/link-preview?url=${encodeURIComponent(url)}`);
  } catch (err) {
    const status = (err as ChatApiError).status;
    if (status === 404 || status === 400) return null;
    throw err;
  }
}

/** The Chats tab: every conversation with its last message and my unread count (`GET /api/me/chats`). */
export function getChatList(): Promise<import('@shared/chats/inbox').ChatListResponse> {
  return request('/me/chats');
}
