/** API client for 📱 Phone practice's persona chats (worker routes/phone.ts, docs/PHONE_PRACTICE.md). */
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { PersonaMessage, PersonaReply } from '@shared/phone';

export class PersonaError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status: number) {
    super(message);
  }
}

export async function requestPersonaReply(body: { scenario_id: string; persona_id: string; messages: PersonaMessage[]; context?: string }, signal?: AbortSignal): Promise<PersonaReply> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/phone/persona-reply`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new PersonaError(err instanceof Error ? err.message : 'Network error', true, 0);
  }
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new PersonaError('Unauthorized', false, 401);
  }
  if (!response.ok) {
    const e = (await response.json().catch(() => ({}))) as { error?: string; retryable?: boolean };
    throw new PersonaError(e.error || `HTTP ${response.status}`, e.retryable ?? response.status >= 500, response.status);
  }
  return (await response.json()) as PersonaReply;
}
