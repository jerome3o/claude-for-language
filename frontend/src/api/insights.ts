/**
 * API client for the tutor "Student Insights" feature.
 * Same auth/fetch conventions as client.ts (cookie + optional bearer token).
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type {
  InsightsReport,
  TutorLessonLogEntry,
  StudentSummary,
  RecordingMark,
  RecordingMarkStatus,
  HistoryPage,
  HistoryQuery,
} from '../types/insights';

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

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ---------- Lesson log ----------

export async function getLessonLog(relId: string): Promise<TutorLessonLogEntry[]> {
  const res = await request<{ entries: TutorLessonLogEntry[] }>(`/relationships/${relId}/lesson-log`);
  return res.entries;
}

export async function logLesson(
  relId: string,
  input: { lesson_at: string; notes?: string }
): Promise<{ entry: TutorLessonLogEntry; student_lesson_note_id: string | null }> {
  return request(`/relationships/${relId}/lesson-log`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteLessonLogEntry(relId: string, id: string): Promise<void> {
  await request<{ success: boolean }>(`/relationships/${relId}/lesson-log/${id}`, { method: 'DELETE' });
}

// ---------- Insights ----------

export async function getStudentInsights(relId: string, range?: { from?: string; to?: string }): Promise<InsightsReport> {
  return request<InsightsReport>(`/relationships/${relId}/insights${qs({ from: range?.from, to: range?.to })}`);
}

export async function writeStudentSummary(relId: string, range: { from: string; to: string }): Promise<StudentSummary> {
  const res = await request<{ summary: StudentSummary }>(`/relationships/${relId}/insights/summary`, {
    method: 'POST',
    body: JSON.stringify(range),
  });
  return res.summary;
}

export async function getStudentSummaries(relId: string): Promise<StudentSummary[]> {
  const res = await request<{ summaries: StudentSummary[] }>(`/relationships/${relId}/insights/summaries`);
  return res.summaries;
}

// ---------- Recording marks ----------

export async function markRecording(
  relId: string,
  eventId: string,
  input: { status: RecordingMarkStatus; comment?: string | null }
): Promise<RecordingMark> {
  const res = await request<{ mark: RecordingMark }>(`/relationships/${relId}/recordings/${eventId}/mark`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return res.mark;
}

export async function clearRecordingMark(relId: string, eventId: string): Promise<void> {
  await request<{ success: boolean }>(`/relationships/${relId}/recordings/${eventId}/mark`, { method: 'DELETE' });
}

// ---------- History ----------

export async function getStudentHistory(relId: string, query: HistoryQuery = {}): Promise<HistoryPage> {
  return request<HistoryPage>(
    `/relationships/${relId}/history${qs({
      from: query.from,
      to: query.to,
      deck_id: query.deck_id,
      card_type: query.card_type || undefined,
      rating: query.rating === '' ? undefined : query.rating,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit,
    })}`
  );
}
