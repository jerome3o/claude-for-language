/** API client for audio lessons (worker routes/audio-lessons.ts, docs/AUDIO_LESSONS.md). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { AudioLessonDetail, AudioLessonFormat, AudioLessonSummary, PodcastFeedInfo } from '@shared/audio-lesson';

const API_PATH = `${API_BASE}/api`;

async function send(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_PATH}${url}`, {
    ...options,
    credentials: 'include',
    headers: { ...getAuthHeaders(), ...(options?.headers as Record<string, string> | undefined) },
  });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status });
  }
  return response;
}

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await send(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers as Record<string, string> | undefined) } });
  return response.json();
}

export function listAudioLessons(): Promise<{ lessons: AudioLessonSummary[] }> {
  return json('/audio-lessons');
}

export function getAudioLesson(id: string): Promise<{ lesson: AudioLessonDetail }> {
  return json(`/audio-lessons/${encodeURIComponent(id)}`);
}

export interface NewAudioLesson {
  format: AudioLessonFormat;
  description?: string;
  dialogue?: string;
  text?: string;
  title?: string;
  target_minutes?: number;
}

/** `notice` / `chunks`: a story lesson — "The text is long: …" when only its first part fits, and how many lines it has. */
export function createAudioLesson(body: NewAudioLesson): Promise<{ lesson: AudioLessonSummary; notice?: string; chunks?: number }> {
  return json('/audio-lessons', { method: 'POST', body: JSON.stringify(body) });
}

export function retryAudioLesson(id: string): Promise<{ lesson: AudioLessonSummary }> {
  return json(`/audio-lessons/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export function deleteAudioLesson(id: string): Promise<{ ok: true }> {
  return json(`/audio-lessons/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** The private podcast feed of my audio lessons (made on first use; worker routes/podcast.ts). */
export function getPodcastFeed(): Promise<{ feed: PodcastFeedInfo }> {
  return json('/me/podcast-feed');
}

/** A new feed link: the old one stops working at once. */
export function resetPodcastFeed(): Promise<{ feed: PodcastFeedInfo }> {
  return json('/me/podcast-feed/reset', { method: 'POST' });
}

/** Turn the feed off (opening the section again makes a new link). */
export function deletePodcastFeed(): Promise<{ ok: true }> {
  return json('/me/podcast-feed', { method: 'DELETE' });
}

/** The lesson's MP3 as a stream (the caller reads it for progress). */
export function fetchAudioLessonFile(id: string): Promise<Response> {
  return send(`/audio-lessons/${encodeURIComponent(id)}/audio`);
}
