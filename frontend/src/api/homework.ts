/**
 * API client for homework assignments (worker routes/homework.ts,
 * docs/HOMEWORK.md). The student's own homework syncs through
 * services/homework.ts; this module is the tutor's side.
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import { localDate, type DraftPlan, type HomeworkAssignment, type HomeworkLoad, type HomeworkMode } from '@shared/homework';
import type { SessionNotesJob, SessionNotesJobStatus, SessionNotesResult, SessionNotesStep } from '../types/tutorNotes';

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

// ============ Lesson notes → homework drafts (routes/homework-drafts.ts) ============

export interface LessonNotesJobBrief {
  id: string;
  status: SessionNotesJobStatus;
  progress: string | null;
  review: boolean;
  assigned_at: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  result: SessionNotesResult;
}

export interface LessonNotesEntry {
  id: string;
  lesson_at: string;
  title: string | null;
  notes: string | null;
  created_at: string;
  job: LessonNotesJobBrief | null;
}

export interface DraftChatMessage {
  role: 'tutor' | 'assistant';
  text: string;
  at: string;
}

export interface DraftWord {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  known: { deck_name: string; state: string } | null;
  skipped: boolean;
}

export interface DraftView {
  student_name: string;
  job: Omit<SessionNotesJob, 'notes_chars'> & { review: number; assigned_at: string | null; chat: DraftChatMessage[]; steps: SessionNotesStep[] };
  plan: DraftPlan;
  words: DraftWord[];
  kept_count: number;
  skipped_count: number;
  load: HomeworkLoad;
  load_after: HomeworkLoad;
  assignments: HomeworkAssignment[];
}

export async function listLessonNotes(relId: string): Promise<LessonNotesEntry[]> {
  return (await request<{ entries: LessonNotesEntry[] }>(`${rel(relId)}/lesson-notes`)).entries;
}

export function addLessonNotes(relId: string, input: { notes: string; title?: string; lesson_at?: string; draft: boolean }): Promise<{ entry: LessonNotesEntry | null; job: LessonNotesJobBrief | null }> {
  return request(`${rel(relId)}/lesson-notes`, { method: 'POST', body: JSON.stringify(input) });
}

export function draftFromLessonNotes(relId: string, logId: string): Promise<{ job: LessonNotesJobBrief }> {
  return request(`${rel(relId)}/lesson-notes/${encodeURIComponent(logId)}/draft`, { method: 'POST' });
}

const draft = (relId: string, jobId: string) => `${rel(relId)}/homework-drafts/${encodeURIComponent(jobId)}`;

export function getHomeworkDraft(relId: string, jobId: string): Promise<DraftView> {
  return request<DraftView>(`${draft(relId, jobId)}?today=${localDate()}`);
}

export function saveDraftPlan(relId: string, jobId: string, plan: DraftPlan): Promise<DraftView> {
  return request<DraftView>(`${draft(relId, jobId)}/plan`, { method: 'PUT', body: JSON.stringify({ plan, today: localDate() }) });
}

export function sendDraftMessage(relId: string, jobId: string, message: string): Promise<{ job: LessonNotesJobBrief }> {
  return request(`${draft(relId, jobId)}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
}

export function assignHomeworkDraft(relId: string, jobId: string): Promise<AssignResponse> {
  return request<AssignResponse>(`${draft(relId, jobId)}/assign`, { method: 'POST', body: JSON.stringify({ today: localDate() }) });
}
