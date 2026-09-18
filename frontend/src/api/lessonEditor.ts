/**
 * API client for the lesson editor, its Claude side-chat and the lesson
 * library. Same auth pattern as client.ts (session token header + cookies).
 */

import type { CustomLessonSpec } from '@shared/lesson';
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type {
  LibraryItemSummary,
  LibraryItem,
  EditableLesson,
  LibraryAssignment,
  AssignResult,
  PushUpdateResult,
  StudentLessonSummary,
  EditorTargetType,
  EditorChatState,
  SendEditorMessageResult,
  ExportFormat,
} from '../types/lessonEditor';

const API_PATH = `${API_BASE}/api`;

/** Error carrying the server's validation problems, when it sent any. */
export class LessonApiError extends Error {
  problems: string[];
  status: number;
  constructor(message: string, status: number, problems: string[] = []) {
    super(message);
    this.problems = problems;
    this.status = status;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PATH}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new LessonApiError('Unauthorized', 401);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; problems?: string[] };
    throw new LessonApiError(body.error || `HTTP ${response.status}`, response.status, body.problems ?? []);
  }
  return response.json();
}

// ============ Library ============

export async function listLibrary(): Promise<LibraryItemSummary[]> {
  const r = await request<{ items: LibraryItemSummary[] }>('/lesson-library');
  return r.items;
}

export async function getLibraryItem(id: string): Promise<LibraryItem> {
  return request<LibraryItem>(`/lesson-library/${id}`);
}

export async function createLibraryItem(spec: CustomLessonSpec, tags: string[] = []): Promise<LibraryItem> {
  return request<LibraryItem>('/lesson-library', { method: 'POST', body: JSON.stringify({ spec, tags }) });
}

export async function generateLibraryItem(prompt: string, learner?: string): Promise<LibraryItem> {
  return request<LibraryItem>('/lesson-library', {
    method: 'POST',
    body: JSON.stringify({ generate: { prompt, learner } }),
  });
}

export async function importLibraryItem(spec: unknown, tags: string[] = []): Promise<LibraryItem> {
  return request<LibraryItem>('/lesson-library/import', { method: 'POST', body: JSON.stringify({ spec, tags }) });
}

export async function updateLibraryItem(id: string, spec: CustomLessonSpec, tags?: string[]): Promise<LibraryItem> {
  return request<LibraryItem>(`/lesson-library/${id}`, {
    method: 'PUT',
    body: JSON.stringify(tags === undefined ? { spec } : { spec, tags }),
  });
}

export async function archiveLibraryItem(id: string): Promise<void> {
  await request(`/lesson-library/${id}`, { method: 'DELETE' });
}

export async function duplicateLibraryItem(id: string): Promise<LibraryItem> {
  return request<LibraryItem>(`/lesson-library/${id}/duplicate`, { method: 'POST' });
}

export async function assignLibraryItem(id: string, relationshipIds: string[]): Promise<AssignResult> {
  return request<AssignResult>(`/lesson-library/${id}/assign`, {
    method: 'POST',
    body: JSON.stringify({ relationship_ids: relationshipIds }),
  });
}

export async function getLibraryAssignments(id: string): Promise<LibraryAssignment[]> {
  const r = await request<{ assignments: LibraryAssignment[] }>(`/lesson-library/${id}/assignments`);
  return r.assignments;
}

export async function pushLibraryUpdate(id: string, relationshipIds?: string[]): Promise<PushUpdateResult> {
  return request<PushUpdateResult>(`/lesson-library/${id}/push-update`, {
    method: 'POST',
    body: JSON.stringify(relationshipIds ? { relationship_ids: relationshipIds } : {}),
  });
}

// ============ Lessons ============

export async function getEditableLesson(id: string): Promise<EditableLesson> {
  return request<EditableLesson>(`/lessons/${id}`);
}

export async function saveEditableLesson(id: string, spec: CustomLessonSpec): Promise<EditableLesson> {
  return request<EditableLesson>(`/lessons/${id}`, { method: 'PUT', body: JSON.stringify({ spec }) });
}

export async function getStudentLessons(relationshipId: string): Promise<StudentLessonSummary[]> {
  const r = await request<{ lessons: StudentLessonSummary[] }>(`/relationships/${relationshipId}/student-lessons`);
  return r.lessons;
}

/** Server-side export URL (used for the download links; the auth cookie
 * rides along). Offline, the frontend builds the same files itself. */
export function exportUrl(target: EditorTargetType, id: string, format: ExportFormat): string {
  const base = target === 'library' ? 'lesson-library' : target === 'reader' ? 'readers' : 'lessons';
  return `${API_PATH}/${base}/${id}/export.${format}`;
}

// ============ Editor chat (lesson, library or reader target) ============

export async function getEditorChat<TSpec = CustomLessonSpec, TDiff = unknown>(
  target: EditorTargetType,
  id: string,
): Promise<EditorChatState<TSpec, TDiff>> {
  return request<EditorChatState<TSpec, TDiff>>(`/editor-chat/${target}/${id}`);
}

export async function sendEditorMessage<TSpec = CustomLessonSpec, TDiff = unknown>(
  target: EditorTargetType,
  id: string,
  message: string,
  currentSpec: TSpec,
): Promise<SendEditorMessageResult<TSpec, TDiff>> {
  return request<SendEditorMessageResult<TSpec, TDiff>>(`/editor-chat/${target}/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message, current_spec: currentSpec }),
  });
}

export async function setProposalStatus(
  target: EditorTargetType,
  id: string,
  messageId: string,
  status: 'accept' | 'reject',
): Promise<void> {
  await request(`/editor-chat/${target}/${id}/messages/${messageId}/${status}`, { method: 'POST' });
}
