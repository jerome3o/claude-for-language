/** "Forget this card" API (worker/src/routes/card-forgets.ts). */
import { API_BASE, getAuthHeaders } from './client';

export interface ApiCardForget {
  id: string;
  card_id: string;
  forgotten_at: string;
  source?: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(init?.headers as Record<string, string>) },
  });
  // 404 = none of those cards are the account's any more: a normal result for a queued upload.
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listForgetsApi(): Promise<{ forgets: ApiCardForget[] }> {
  return call('/me/card-forgets');
}

export function addForgetsApi(items: Array<{ id: string; card_id: string; forgotten_at: string; source: string }>): Promise<{ forgets?: ApiCardForget[] }> {
  return call('/me/card-forgets', { method: 'POST', body: JSON.stringify({ items }) });
}

export function undoForgetsApi(ids: string[]): Promise<{ undone: number; forgets?: ApiCardForget[] }> {
  return call('/me/card-forgets/undo', { method: 'POST', body: JSON.stringify({ ids }) });
}
