/** API client for the ＋ Add tab (worker routes/add-words.ts; docs/ADD_TAB.md). */
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { OcrLine } from '@shared/add/add';

const API_PATH = `${API_BASE}/api`;

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PATH}${url}`, {
    ...options,
    credentials: 'include',
    headers: { ...getAuthHeaders(), ...(options?.headers as Record<string, string> | undefined) },
  });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status, retryable: error.retryable });
  }
  return response.json() as Promise<T>;
}

/** A (resized) photo → the Chinese lines on it, most prominent first. */
export function readPhotoWords(image: Blob): Promise<{ lines: OcrLine[]; ms: number }> {
  return json('/ocr/words', { method: 'POST', headers: { 'Content-Type': image.type || 'image/jpeg' }, body: image });
}

export interface ChineseCandidate {
  hanzi: string;
  pinyin: string;
  english: string;
  note?: string;
}

/** English (or toneless pinyin) → up to 4 Chinese words, most common first. */
export function englishWords(text: string): Promise<{ words: ChineseCandidate[] }> {
  return json('/ai/english-words', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
}

export interface LessonRequest {
  id: string;
  prompt: string;
  status: 'generating' | 'ready' | 'failed';
  lesson_id: string | null;
  error: string | null;
  created_at: string;
}

/** "🎯 Mini lesson": Claude writes it into my Mini Lessons in the background. */
export function requestLesson(prompt: string): Promise<{ request: LessonRequest }> {
  return json('/custom-lessons/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
}

export function getLessonRequest(id: string): Promise<{ request: LessonRequest }> {
  return json(`/custom-lessons/requests/${encodeURIComponent(id)}`);
}
