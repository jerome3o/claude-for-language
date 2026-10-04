/** "⚡ Study it today" API (worker/src/routes/study-bumps.ts). */
import { API_BASE, getAuthHeaders } from './client';

export interface ApiStudyBump {
  id: string;
  note_id: string;
  created_at: string;
  source: string;
  bumped_by: string | null;
  bumped_by_name: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface BumpApiResult {
  bumps: ApiStudyBump[];
  added: Array<{ note_id: string; hanzi: string }>;
  already: Array<{ note_id: string; hanzi: string }>;
  not_found: string[];
}

export class BumpApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new BumpApiError(body.error || `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export function listBumpsApi(): Promise<{ bumps: ApiStudyBump[] }> {
  return call('/me/bumps');
}

/** 404 (none of the notes are the account's any more) comes back as a normal result. */
export function addBumpsApi(items: Array<{ id: string; note_id: string; created_at: string; source: string }>): Promise<BumpApiResult> {
  return call('/me/bumps', { method: 'POST', body: JSON.stringify({ items }) });
}

export function clearBumpApi(noteId: string): Promise<{ cleared: number; bumps: ApiStudyBump[] }> {
  return call(`/me/bumps/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
}

/** The tutor bumps the student's own card (the student sees "⚡ from <tutor>"). */
export function bumpStudentCardsApi(relationshipId: string, noteIds: string[]): Promise<BumpApiResult> {
  return call(`/relationships/${encodeURIComponent(relationshipId)}/student-bumps`, { method: 'POST', body: JSON.stringify({ note_ids: noteIds }) });
}
