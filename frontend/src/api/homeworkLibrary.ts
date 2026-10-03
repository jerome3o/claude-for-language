/**
 * The homework library, link homework and updating students' copies
 * (worker routes/homework-library.ts, docs/HOMEWORK.md §8–10). Tutor side.
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import { localDate, type LibraryItem, type LibraryKind, type LibraryStatus } from '@shared/homework';

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

export interface RelationshipLibrary {
  items: LibraryItem[];
  counts: Record<LibraryStatus, number>;
  today: string;
}

export interface TutorLibrary extends RelationshipLibrary {
  students: Array<{ relationship_id: string; student_id: string; student_name: string }>;
}

export function getRelationshipLibrary(relId: string): Promise<RelationshipLibrary> {
  return request<RelationshipLibrary>(`/relationships/${encodeURIComponent(relId)}/homework-library?today=${localDate()}`);
}

export function getTutorLibrary(): Promise<TutorLibrary> {
  return request<TutorLibrary>(`/tutor/homework-library?today=${localDate()}`);
}

// ============ Links ============

export interface HomeworkLink {
  id: string;
  title: string;
  url: string;
  instructions: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  sent_count?: number;
}

export function listHomeworkLinks(): Promise<HomeworkLink[]> {
  return request<{ links: HomeworkLink[] }>('/homework-links').then((r) => r.links);
}

export function createHomeworkLink(body: { title: string; url: string; instructions?: string | null }): Promise<HomeworkLink> {
  return request<{ link: HomeworkLink }>('/homework-links', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.link);
}

export function updateHomeworkLink(id: string, body: { title?: string; url?: string; instructions?: string | null }): Promise<HomeworkLink> {
  return request<{ link: HomeworkLink }>(`/homework-links/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.link);
}

export function deleteHomeworkLink(id: string): Promise<void> {
  return request<unknown>(`/homework-links/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined);
}

// ============ Students' copies ============

export interface StudentCopy {
  relationship_id: string;
  student_id: string;
  student_name: string;
  target_id: string;
  share_id: string | null;
  behind: number | null;
}

export interface CopyUpdateResult {
  relationship_id: string;
  student_name: string;
  ok: boolean;
  detail: string;
  error?: string;
}

export function listStudentCopies(kind: LibraryKind, sourceId: string): Promise<StudentCopy[]> {
  return request<{ copies: StudentCopy[] }>(`/student-copies?kind=${kind}&source_id=${encodeURIComponent(sourceId)}`).then((r) => r.copies);
}

export function updateStudentCopies(kind: LibraryKind, sourceId: string, relationshipIds?: string[]): Promise<{ updated: number; results: CopyUpdateResult[] }> {
  return request(`/student-copies/update`, { method: 'POST', body: JSON.stringify({ kind, source_id: sourceId, relationship_ids: relationshipIds }) });
}
