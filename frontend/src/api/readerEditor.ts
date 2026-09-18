/**
 * API client for the graded-reader editor: whole-reader spec read/save,
 * JSON import, exports and the form's text assist. The Claude side-chat
 * uses the shared editor-chat functions in api/lessonEditor.ts with target
 * "reader".
 */

import type { ReaderSpec } from '@shared/reader';
import { API_BASE, getAuthHeaders, authEvents } from './client';
import { LessonApiError } from './lessonEditor';
import type { EditableReader, ImportedReader, ReaderAssistField } from '../types/readerEditor';
import type { ExportFormat } from '../types/lessonEditor';

const API_PATH = `${API_BASE}/api`;

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

export async function getReaderSpec(id: string): Promise<EditableReader> {
  return request<EditableReader>(`/readers/${id}/spec`);
}

export async function saveReaderSpec(id: string, spec: ReaderSpec): Promise<EditableReader> {
  return request<EditableReader>(`/readers/${id}/spec`, { method: 'PUT', body: JSON.stringify({ spec }) });
}

export async function importReader(spec: unknown): Promise<ImportedReader> {
  return request<ImportedReader>('/readers/import', { method: 'POST', body: JSON.stringify({ spec }) });
}

/** Server-side export URL (the frontend builds the same files client-side
 * from shared/reader/export.ts, which also works offline). */
export function readerExportUrl(id: string, format: ExportFormat): string {
  return `${API_PATH}/readers/${id}/export.${format}`;
}

/** Translate a page or draft its illustration prompt — works for text that
 * isn't saved yet. */
export async function readerAssist(id: string, field: ReaderAssistField, chinese: string, english?: string): Promise<string> {
  const r = await request<{ text: string }>(`/readers/${id}/assist`, {
    method: 'POST',
    body: JSON.stringify({ field, chinese, english }),
  });
  return r.text;
}
