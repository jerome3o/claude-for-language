/** API client for 梗 Meme review (prototype; worker routes/meme-review.ts, docs/MEME_REVIEW.md). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { MemeIssueRecord, MemeIssueSummary, MemeLessonJob } from '@shared/meme-review';

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
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status });
  }
  return response.json();
}

export interface MemeIssueList {
  issues: MemeIssueSummary[];
  current_month: string;
  can_generate: boolean;
}

export interface MemeIssueStats {
  rounds?: number;
  searches?: number;
  fetches?: number;
  images?: number;
  cost_usd?: number;
}

export function listMemeIssues(): Promise<MemeIssueList> {
  return json('/meme-review');
}

export function getMemeIssue(month: string): Promise<{ issue: MemeIssueRecord; lesson: MemeLessonJob | null; stats?: MemeIssueStats }> {
  return json(`/meme-review/${encodeURIComponent(month)}`);
}

/** Admin only. */
export function generateMemeIssue(month: string, regenerate = false): Promise<{ issue: MemeIssueRecord; started: boolean }> {
  return json('/meme-review/generate', { method: 'POST', body: JSON.stringify({ month, ...(regenerate ? { regenerate: true } : {}) }) });
}

export function startMemeLesson(month: string): Promise<{ job: MemeLessonJob }> {
  return json(`/meme-review/${encodeURIComponent(month)}/lesson`, { method: 'POST', body: '{}' });
}

export function getMemeLessonJob(jobId: string): Promise<{ job: MemeLessonJob }> {
  return json(`/meme-review/lessons/${encodeURIComponent(jobId)}`);
}
