/**
 * API calls behind the practice exercise types and lesson attempts:
 * Claude's check of a made sentence, and reading attempts (the learner's own
 * and, for a tutor, a student's).
 */

import type { CustomLessonSpec, LessonAttemptData, SentenceFeedback } from '@shared/lesson';
import { sentenceCheckCacheText, type SentenceFix } from '@shared/lesson/sentenceCheck';
import { spokenCheckAnswer } from '@shared/cards/answer';
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

export class FeedbackUnavailable extends Error {
  /** offline = no connection (vs Claude busy / declined / not set up). */
  constructor(message: string, readonly offline = false) { super(message); }
}

type SentenceInputMode = 'spoken' | 'edited' | 'typed';

/** POST a sentence call; retries once on a retryable 503; throws FeedbackUnavailable when there is no answer to be had. */
async function postSentence<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine) throw new FeedbackUnavailable('offline', true);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_PATH}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new FeedbackUnavailable('network', true);
    }
    if (response.ok) return (await response.json()) as T;
    const err = await response.json().catch(() => ({})) as { error?: string; retryable?: boolean };
    if (response.status === 503 && err.retryable && attempt === 0) continue;
    throw new FeedbackUnavailable(err.error || `HTTP ${response.status}`);
  }
  throw new FeedbackUnavailable('busy');
}

/**
 * Claude's grade of a sentence the learner made (right / needs_work / wrong; shared/lesson/sentenceCheck.ts). A spoken
 * sentence is sent with `input` so the server reads it without the recogniser's punctuation. Throws
 * FeedbackUnavailable when there is no answer (offline, no API key, declined) → the exercise self-assesses.
 */
export async function checkMadeSentence(
  words: string[], task: string | undefined, sentence: string, input?: SentenceInputMode | null,
): Promise<{ feedback: SentenceFeedback; cached: boolean; ms?: number }> {
  const r = await postSentence<{ feedback: SentenceFeedback; cached?: boolean; ms?: number }>('/lessons/sentence-feedback', { words, task, sentence, input: input ?? undefined });
  return { feedback: r.feedback, cached: !!r.cached, ms: r.ms };
}

/** ✨ Show a fixed version: his sentence minimally fixed. Cached per (exercise, sentence) on the device for the session. */
const fixCache = new Map<string, SentenceFix>();
export async function fixMadeSentence(
  words: string[], task: string | undefined, sentence: string, input?: SentenceInputMode | null,
): Promise<{ fix: SentenceFix; cached: boolean }> {
  const key = sentenceCheckCacheText({ words, task, sentence: spokenCheckAnswer(sentence, input) }, 'fix');
  const hit = fixCache.get(key);
  if (hit) return { fix: hit, cached: true };
  const r = await postSentence<{ fix: SentenceFix; cached?: boolean }>('/lessons/sentence-fix', { words, task, sentence, input: input ?? undefined });
  fixCache.set(key, r.fix);
  return { fix: r.fix, cached: !!r.cached };
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
