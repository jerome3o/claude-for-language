/** API client for 🎬 Clips (experimental; worker routes/clips.ts, docs/CLIPS.md). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { ClipEvent, ClipLessonState, ClipRecord, ClipSpec } from '@shared/clips';

async function json<T>(url: string, options?: RequestInit): Promise<T> {
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
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status, problems: error.problems as string[] | undefined });
  }
  return response.json();
}

export const listClips = () => json<{ clips: ClipRecord[] }>('/clips');
export const getClip = (id: string) => json<{ clip: ClipRecord }>(`/clips/${encodeURIComponent(id)}`);
export const importClip = (spec: ClipSpec) => json<{ clip: ClipRecord }>('/clips', { method: 'POST', body: JSON.stringify({ spec }) });
export const deleteClip = (id: string) => json<{ deleted: boolean }>(`/clips/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const generateClips = (body: { topic?: string; words?: string[]; count?: number }) =>
  json<{ clips: ClipRecord[] }>('/clips/generate', { method: 'POST', body: JSON.stringify(body) });
export const retryClip = (id: string) => json<{ clip: ClipRecord }>(`/clips/${encodeURIComponent(id)}/retry`, { method: 'POST' });
export const postClipEvents = (events: ClipEvent[]) =>
  json<{ accepted: number; stored: number; rejected: number }>('/clips/events', { method: 'POST', body: JSON.stringify({ events }) });

export type LearnMoreResult =
  | { lesson: ClipLessonState; started: boolean }
  | { reader: { id: string; status: string } }
  | { audio_lesson: { id: string; status: string } }
  | { clips: ClipRecord[] };

export const clipLearnMore = (id: string, action: 'lesson' | 'reader' | 'podcast' | 'more') =>
  json<LearnMoreResult>(`/clips/${encodeURIComponent(id)}/learn-more`, { method: 'POST', body: JSON.stringify({ action }) });
