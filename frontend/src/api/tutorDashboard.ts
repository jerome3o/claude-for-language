/**
 * API client for the tutor dashboard / student page (worker routes/tutor-dashboard.ts).
 * Same auth/fetch conventions as client.ts (cookie + optional bearer token).
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { MessageWithSender } from '../types';
import type { TutorDashboard, StudentOverview, SharedDeckUpdateResult } from '../types/tutorDashboard';

const API_PATH = `${API_BASE}/api`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${API_PATH}${url}`, {
    ...options,
    credentials: 'include',
    headers,
  });
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

/** Days ("studied today", streak) are bucketed in the viewer's zone. */
function tzQuery(): string {
  return `?tz_offset=${new Date().getTimezoneOffset()}`;
}

/** Cache window for the dashboard (react-query staleTime). */
export const DASHBOARD_STALE_MS = 60_000;

export async function getTutorDashboard(): Promise<TutorDashboard> {
  return request<TutorDashboard>(`/tutor/dashboard${tzQuery()}`);
}

export async function getStudentOverview(relId: string): Promise<StudentOverview> {
  return request<StudentOverview>(`/relationships/${relId}/overview${tzQuery()}`);
}

/** The most recent conversation in the relationship, created if there is none. */
export async function openConversation(relId: string): Promise<{ conversation_id: string; created: boolean }> {
  return request(`/relationships/${relId}/conversations/open`, { method: 'POST' });
}

/** Sends the install how-to (Android app via Obtainium / home-screen shortcut) as a chat message. */
export async function sendInstallHowTo(relId: string): Promise<{ conversation_id: string; message: MessageWithSender }> {
  return request(`/relationships/${relId}/send-howto`, { method: 'POST' });
}

/** Adds the tutor's new notes to the student's existing copy (keeps their progress). */
export async function updateSharedDeckCopy(relId: string, sharedDeckId: string): Promise<SharedDeckUpdateResult> {
  return request<SharedDeckUpdateResult>(`/relationships/${relId}/shared-decks/${sharedDeckId}/update`, { method: 'POST' });
}

export async function reportClientState(state: {
  install_kind: 'pwa' | 'android' | 'browser';
  cached_audio_count: number | null;
}): Promise<void> {
  await request<{ ok: boolean }>('/me/client-state', { method: 'POST', body: JSON.stringify(state) });
}
