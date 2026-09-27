/**
 * The tutor's private profile of a student (worker routes/student-profile.ts,
 * shared/students/profile.ts). Tutor only — the student never reads it.
 * (Not the user's own profile: name, picture, bio.)
 */
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { StudentProfile, StudentProfileFields } from '@shared/students';

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
    throw new Error(error.problems?.length ? error.problems.join(' · ') : error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

const path = (relId: string) => `/relationships/${encodeURIComponent(relId)}/student-profile`;

export async function getStudentProfile(relId: string): Promise<StudentProfile | null> {
  const r = await request<{ profile: StudentProfile | null }>(path(relId));
  return r.profile;
}

/** Replaces the whole profile; an empty one is deleted (→ null). */
export async function saveStudentProfile(relId: string, fields: StudentProfileFields): Promise<StudentProfile | null> {
  const r = await request<{ profile: StudentProfile | null }>(path(relId), { method: 'PUT', body: JSON.stringify(fields) });
  return r.profile;
}
