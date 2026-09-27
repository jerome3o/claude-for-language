/**
 * API calls behind the practice exercise types and lesson attempts:
 * Claude's check of a made sentence, and reading attempts (the learner's own
 * and, for a tutor, a student's).
 */

import type { CustomLessonSpec, LessonAttemptData, SentenceFeedback } from '@shared/lesson';
import { API_BASE, getAuthHeaders } from './client';

const API_PATH = `${API_BASE}/api`;

async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(`${API_PATH}${url}`, { credentials: 'include', headers: getAuthHeaders() });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export class FeedbackUnavailable extends Error {}

/**
 * Claude's verdict on a sentence the learner made. Retries once when the
 * server says Claude is busy (503); throws FeedbackUnavailable when there is
 * no answer to be had (offline, no API key, declined) so the exercise falls
 * back to self-assessment.
 */
export async function checkMadeSentence(words: string[], task: string | undefined, sentence: string): Promise<SentenceFeedback> {
  if (!navigator.onLine) throw new FeedbackUnavailable('offline');
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_PATH}/lessons/sentence-feedback`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ words, task, sentence }),
      });
    } catch {
      throw new FeedbackUnavailable('network');
    }
    if (response.ok) return ((await response.json()) as { feedback: SentenceFeedback }).feedback;
    const body = await response.json().catch(() => ({})) as { error?: string; retryable?: boolean };
    if (response.status === 503 && body.retryable && attempt === 0) continue;
    throw new FeedbackUnavailable(body.error || `HTTP ${response.status}`);
  }
  throw new FeedbackUnavailable('busy');
}

export interface AttemptSummary {
  id: string;
  lesson_id: string;
  lesson_title: string;
  lesson_icon: string | null;
  started_at: string | null;
  completed_at: string;
  duration_ms: number;
  correct: number | null;
  total: number | null;
  rating: number | null;
  recordings: number;
}

export interface AttemptMedia {
  media_key: string;
  /** R2 key — play with getAudioUrl(audio_key). */
  audio_key: string;
  audio_url: string;
  content_type: string | null;
  transcript_status: string;
  transcript: string | null;
  transcript_translation: string | null;
}

export interface AttemptDetail {
  id: string;
  lesson_id: string;
  started_at: string | null;
  completed_at: string;
  duration_ms: number;
  correct: number | null;
  total: number | null;
  rating: number | null;
  spec: CustomLessonSpec;
  data: LessonAttemptData;
  media: AttemptMedia[];
}

/** relId set = a tutor reading a student's attempts; unset = my own. */
export async function listAttempts(relId: string | null, lessonId?: string): Promise<AttemptSummary[]> {
  const base = relId ? `/relationships/${relId}/lesson-attempts` : '/lesson-attempts';
  const r = await getJSON<{ attempts: AttemptSummary[] }>(`${base}${lessonId ? `?lesson_id=${encodeURIComponent(lessonId)}` : ''}`);
  return r.attempts;
}

export async function getAttempt(relId: string | null, attemptId: string): Promise<AttemptDetail> {
  const base = relId ? `/relationships/${relId}/lesson-attempts` : '/lesson-attempts';
  const r = await getJSON<{ attempt: AttemptDetail }>(`${base}/${attemptId}`);
  return r.attempt;
}

/** Absolute URL for a server audio path (/api/audio/…). */
export function audioUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}
