/**
 * API client for session-notes agent jobs (worker routes/tutor-notes.ts).
 * Same auth/fetch conventions as client.ts.
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { SessionNotesJob, SubmitSessionNotesInput } from '../types/tutorNotes';

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
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

const base = (relId: string) => `/relationships/${encodeURIComponent(relId)}/session-notes`;

export async function submitSessionNotes(relId: string, input: SubmitSessionNotesInput): Promise<SessionNotesJob> {
  const r = await request<{ job: SessionNotesJob }>(base(relId), { method: 'POST', body: JSON.stringify(input) });
  return r.job;
}

export async function listSessionNotesJobs(relId: string, limit = 50): Promise<SessionNotesJob[]> {
  const r = await request<{ jobs: SessionNotesJob[] }>(`${base(relId)}?limit=${limit}`);
  return r.jobs;
}

export async function getSessionNotesJob(relId: string, id: string): Promise<SessionNotesJob> {
  const r = await request<{ job: SessionNotesJob }>(`${base(relId)}/${encodeURIComponent(id)}`);
  return r.job;
}

export async function retrySessionNotesJob(relId: string, id: string): Promise<SessionNotesJob> {
  const r = await request<{ job: SessionNotesJob }>(`${base(relId)}/${encodeURIComponent(id)}/retry`, { method: 'POST' });
  return r.job;
}

export async function cancelSessionNotesJob(relId: string, id: string): Promise<SessionNotesJob> {
  const r = await request<{ job: SessionNotesJob }>(`${base(relId)}/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  return r.job;
}

export async function deleteSessionNotesJob(relId: string, id: string): Promise<void> {
  await request<{ success: boolean }>(`${base(relId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Homework from a recorded video lesson (POST /api/calls/:id/homework): the call's transcript, board, chat and report become the notes. */
export async function makeHomeworkFromCall(callId: string, input: Pick<SubmitSessionNotesInput, 'priority' | 'auto_share' | 'log_lesson'> = {}): Promise<SessionNotesJob> {
  const r = await request<{ job: SessionNotesJob }>(`/calls/${encodeURIComponent(callId)}/homework`, { method: 'POST', body: JSON.stringify(input) });
  return r.job;
}

export async function listCallHomework(callId: string): Promise<SessionNotesJob[]> {
  const r = await request<{ jobs: SessionNotesJob[] }>(`/calls/${encodeURIComponent(callId)}/homework`);
  return r.jobs;
}
