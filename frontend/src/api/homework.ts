/**
 * API client for homework assignments (worker routes/homework.ts,
 * docs/HOMEWORK.md). The student's own homework syncs through
 * services/homework.ts; this module is the tutor's side.
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import { localDate, type HomeworkAssignment, type HomeworkLoad, type HomeworkMode } from '@shared/homework';

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

const rel = (relId: string) => `/relationships/${encodeURIComponent(relId)}`;

export interface RelationshipHomework {
  assignments: HomeworkAssignment[];
  load: HomeworkLoad;
  today: string;
}

export function getRelationshipHomework(relId: string): Promise<RelationshipHomework> {
  return request<RelationshipHomework>(`${rel(relId)}/homework?today=${localDate()}`);
}

export interface AssignItem {
  kind: 'deck' | 'lesson' | 'reader';
  source_id: string;
  mode: HomeworkMode;
  due_date?: string | null;
  split_days?: number;
  priority?: 'core' | 'non_urgent';
  skip_known?: boolean;
  include_known?: string[];
  title?: string;
}

export interface AssignResponse {
  assignments: HomeworkAssignment[];
  skipped: Array<{ source_id: string; hanzi: string[] }>;
  errors: Array<{ source_id: string; error: string }>;
}

export function assignHomework(relId: string, items: AssignItem[]): Promise<AssignResponse> {
  return request<AssignResponse>(`${rel(relId)}/homework`, { method: 'POST', body: JSON.stringify({ items, today: localDate() }) });
}

export function updateHomeworkAssignment(relId: string, id: string, patch: { due_date?: string | null; status?: 'cancelled' | 'active' }): Promise<{ assignment: HomeworkAssignment }> {
  return request<{ assignment: HomeworkAssignment }>(`${rel(relId)}/homework/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
