/**
 * Prepared in-call activities + "What <student> has covered" (worker
 * routes/prepared-activities.ts; docs/VIDEO_CALLS.md "Prepared activities").
 * Tutor only.
 */
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { PrepareJob, PreparedActivity } from '@shared/call-activities';
import type { StudentCoverage } from '@shared/students/coverage';

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

export interface PreparedActivitiesResponse {
  activities: PreparedActivity[];
  job: PrepareJob | null;
  can_prepare: boolean;
}

const rel = (relId: string) => `/relationships/${encodeURIComponent(relId)}`;

export const preparedActivitiesKey = (relId: string) => ['prepared-activities', relId] as const;
export const coverageKey = (relId: string) => ['student-coverage', relId] as const;

export function getPreparedActivities(relId: string): Promise<PreparedActivitiesResponse> {
  return request(`${rel(relId)}/prepared-activities`);
}

export function prepareActivities(relId: string, count?: number): Promise<{ job: PrepareJob; started: boolean }> {
  return request(`${rel(relId)}/prepared-activities`, { method: 'POST', body: JSON.stringify(count ? { count } : {}) });
}

export function dismissPreparedActivity(id: string): Promise<{ activity: PreparedActivity }> {
  return request(`/prepared-activities/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}

export function restorePreparedActivity(id: string): Promise<{ activity: PreparedActivity }> {
  return request(`/prepared-activities/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

export function getStudentCoverage(relId: string): Promise<{ coverage: StudentCoverage }> {
  return request(`${rel(relId)}/coverage`);
}
