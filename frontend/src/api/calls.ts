/** API client for video calls (worker routes/calls.ts). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { CallDetail, CallJoinInfo, CallListItem, CallInfo, CallReportWord } from '../types/calls';

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
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status });
  }
  return response.json();
}

/** The text board's tab-complete: pinyin + a short meaning for Chinese just typed (Haiku, cached server-side). */
export function glossBoardText(callId: string, text: string, signal?: AbortSignal): Promise<{ text: string; pinyin: string; english: string; cached?: boolean }> {
  return request(`/calls/${callId}/gloss`, { method: 'POST', body: JSON.stringify({ text }), signal });
}

export function listCalls(opts: { relationshipId?: string; live?: boolean } = {}): Promise<{ calls: CallListItem[] }> {
  const q = new URLSearchParams();
  if (opts.relationshipId) q.set('relationship_id', opts.relationshipId);
  if (opts.live) q.set('live', '1');
  const qs = q.toString();
  return request(`/calls${qs ? `?${qs}` : ''}`);
}

export function createCall(input: { relationship_id?: string | null; title?: string | null }): Promise<{ call: CallInfo }> {
  return request('/calls', { method: 'POST', body: JSON.stringify(input) });
}

export function getCall(callId: string): Promise<CallDetail> {
  return request(`/calls/${callId}`);
}

export function deleteCall(callId: string): Promise<{ ok: true }> {
  return request(`/calls/${callId}`, { method: 'DELETE' });
}

export function joinCall(callId: string): Promise<CallJoinInfo> {
  return request(`/calls/${callId}/join`, { method: 'POST' });
}

/**
 * "I've left" from a page that is going away (pagehide): a beacon, which
 * survives the page closing but can't carry the session header — so it
 * carries the socket's client id and the leave token the room gave it.
 * Text body = a CORS-simple request (no preflight). Returns whether the
 * browser queued it.
 */
export function sendLeaveBeacon(callId: string, clientId: string, token: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  try {
    const body = new Blob([JSON.stringify({ client_id: clientId, token })], { type: 'text/plain' });
    return navigator.sendBeacon(`${API_PATH}/calls/${encodeURIComponent(callId)}/leave`, body);
  } catch {
    return false;
  }
}

export function endCall(callId: string): Promise<{ ok: true }> {
  return request(`/calls/${callId}/end`, { method: 'POST' });
}

export function processCall(callId: string): Promise<{ ok: true; closed: number }> {
  return request(`/calls/${callId}/process`, { method: 'POST' });
}

export function makeCallFlashcards(
  callId: string,
  input: { deck_id?: string; deck_name?: string; words: CallReportWord[] },
): Promise<{ deck_id: string; created: number; failed: Array<{ index: number; hanzi: string; error: string }> }> {
  return request(`/calls/${callId}/flashcards`, { method: 'POST', body: JSON.stringify(input) });
}

// ---- Recording uploads (used by services/calls/uploads.ts)

export function registerPiece(callId: string, piece: { id: string; piece_index: number; started_at: number; mime_type: string }): Promise<unknown> {
  return request(`/calls/${callId}/pieces`, { method: 'POST', body: JSON.stringify(piece) });
}

export function uploadChunk(callId: string, pieceId: string, idx: number, blob: Blob): Promise<unknown> {
  return request(`/calls/${callId}/pieces/${pieceId}/chunks/${idx}`, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
  });
}

export function closePiece(callId: string, pieceId: string, body: { chunk_count: number; duration_ms: number }): Promise<unknown> {
  return request(`/calls/${callId}/pieces/${pieceId}/close`, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * ws(s):// URL of the call room: the Worker in production. In local dev the
 * API is proxied through Vite, whose proxy doesn't pass WebSocket upgrades
 * here, so the socket goes straight to `wrangler dev` on :8787.
 */
export function callSocketUrl(wsPath: string, ticket: string, instance?: string): string {
  const base = API_BASE || (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:8787` : window.location.origin);
  const url = new URL(wsPath, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  if (instance) url.searchParams.set('instance', instance);
  return url.toString();
}

/** A board page as the read-only views get it (worker routes/board-pages.ts). */
export interface BoardPageItem {
  id: string;
  /** 1-based, strip order. */
  number: number;
  title: string | null;
  text: string;
  chars: number;
  created_at: number;
  updated_at: number;
  call_id: string | null;
  relationship_id: string | null;
}

export interface CallBoardPage {
  page_id: string;
  /** Its number in the strip today (null: deleted since). */
  number: number | null;
  title: string | null;
  /** The page as it stood when the call ended. */
  text: string;
  edited: boolean;
}

export function listRelationshipBoardPages(relationshipId: string): Promise<{ pages: BoardPageItem[] }> {
  return request(`/relationships/${relationshipId}/board-pages`);
}

/** Every page I can see (the device's offline copy). */
export function listMyBoardPages(): Promise<{ pages: BoardPageItem[] }> {
  return request('/me/board-pages');
}

export function listCallBoardPages(callId: string): Promise<{ pages: CallBoardPage[] }> {
  return request(`/calls/${callId}/board-pages`);
}
