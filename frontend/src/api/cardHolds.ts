/** Suspend & snooze API (worker/src/routes/card-holds.ts). */
import { API_BASE, getAuthHeaders } from './client';

export interface ApiCardHold {
  id: string;
  card_id: string;
  kind: 'suspend' | 'snooze';
  until: string | null;
  source: string | null;
  created_at: string;
  note_id: string;
  card_type: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface HoldApiResult {
  holds: ApiCardHold[];
  added: string[];
  already: string[];
  not_found: string[];
  invalid: Array<{ card_id: string; error: string }>;
}

export class HoldApiError extends Error {
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
  // 404 = none of those cards are the account's any more: a normal result for a queued upload.
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new HoldApiError(body.error || `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export function listHoldsApi(): Promise<{ holds: ApiCardHold[] }> {
  return call('/me/card-holds');
}

export function addHoldsApi(items: Array<{ id: string; card_id: string; kind: 'suspend' | 'snooze'; until: string | null; created_at: string; source: string }>): Promise<HoldApiResult> {
  return call('/me/card-holds', { method: 'POST', body: JSON.stringify({ items }) });
}

export function clearHoldsApi(cardIds: string[], clearedAt: string): Promise<{ cleared: number; holds: ApiCardHold[] }> {
  return call('/me/card-holds/clear', { method: 'POST', body: JSON.stringify({ card_ids: cardIds, cleared_at: clearedAt }) });
}

export function setBurySiblingsApi(on: boolean): Promise<{ bury_siblings: boolean }> {
  return call('/profile/bury-siblings', { method: 'PUT', body: JSON.stringify({ bury_siblings: on }) });
}
