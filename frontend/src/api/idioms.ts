/** API client for 成语 Idioms (worker routes/idioms.ts, docs/IDIOMS.md). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { IdiomRecord, IdiomSummary } from '@shared/idioms';

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  // API_BASE read per call (not at import): the explorer imports this module everywhere.
  const response = await fetch(`${API_BASE}/api${url}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(options?.headers as Record<string, string> | undefined) },
  });
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

export function listIdioms(): Promise<{ starter: IdiomSummary[]; more: IdiomSummary[] }> {
  return json('/idioms');
}

export function getIdiom(hanzi: string): Promise<{ idiom: IdiomRecord }> {
  return json(`/idioms/${encodeURIComponent(hanzi)}`);
}

/** Get-or-generate (202 while generating). */
export function requestIdiom(hanzi: string, retry = false): Promise<{ idiom: IdiomRecord }> {
  return json('/idioms', { method: 'POST', body: JSON.stringify({ hanzi, ...(retry ? { retry: true } : {}) }) });
}
