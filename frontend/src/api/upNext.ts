/** "Up next" API (worker/src/routes/up-next.ts). */
import { API_BASE, getAuthHeaders } from './client';

export interface ApiUpNext {
  id: string;
  note_id: string;
  position: number;
  created_at: string;
  source: string;
  added_by: string | null;
  added_by_name: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  status: 'new' | 'started';
  new_cards: number;
  total_cards: number;
}

export interface UpNextAddResult {
  up_next: ApiUpNext[];
  added: Array<{ note_id: string; hanzi: string }>;
  already: Array<{ note_id: string; hanzi: string }>;
  moved: Array<{ note_id: string; hanzi: string }>;
  no_new_cards: Array<{ note_id: string; hanzi: string }>;
  not_found: string[];
  over_limit: string[];
}

/** A student's note, from the tutor's search (to pick words for their list). */
export interface StudentNoteHit {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  new_cards: number;
  total_cards: number;
  on_up_next: boolean;
}

export class UpNextApiError extends Error {
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
  // A 404 from an add carries the normal result body (nothing matched).
  if (!res.ok && !(res.status === 404 && init?.method === 'POST')) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new UpNextApiError(body.error || `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

const base = (relId?: string) => (relId ? `/relationships/${encodeURIComponent(relId)}/student-up-next` : '/me/up-next');

export function listUpNextApi(relId?: string): Promise<{ up_next: ApiUpNext[] }> {
  return call(base(relId));
}

export function addUpNextApi(
  body: { items?: Array<{ id: string; note_id: string; created_at?: string }>; note_ids?: string[]; position?: 'top' | 'bottom' | number; source?: string },
  relId?: string
): Promise<UpNextAddResult> {
  return call(base(relId), { method: 'POST', body: JSON.stringify(body) });
}

export function reorderUpNextApi(noteIds: string[], relId?: string): Promise<{ up_next: ApiUpNext[] }> {
  return call(`${base(relId)}/order`, { method: 'PUT', body: JSON.stringify({ note_ids: noteIds }) });
}

export function removeUpNextApi(noteId: string, relId?: string): Promise<{ removed: number; up_next: ApiUpNext[] }> {
  return call(`${base(relId)}/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
}

export function searchStudentNotesApi(relId: string, q: string): Promise<{ notes: StudentNoteHit[] }> {
  return call(`/relationships/${encodeURIComponent(relId)}/student-notes/search?q=${encodeURIComponent(q)}&limit=20`);
}
