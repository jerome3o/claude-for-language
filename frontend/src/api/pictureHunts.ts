/** API client for picture hunts (worker routes/picture-hunts.ts). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { PictureHunt, PictureHuntPlay, PictureHuntSummary } from '@shared/picture-hunt';

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

export function listPictureHunts(): Promise<{ hunts: PictureHuntSummary[] }> {
  return json('/picture-hunts');
}

export function getPictureHunt(id: string): Promise<{ hunt: PictureHunt }> {
  return json(`/picture-hunts/${id}`);
}

export function createPictureHunt(input: { prompt: string; deck_ids?: string[]; use_learning_words?: boolean }): Promise<{ hunt: PictureHuntSummary }> {
  return json('/picture-hunts', { method: 'POST', body: JSON.stringify(input) });
}

/** Upload a (resized, EXIF-free) JPEG as the picture of a new hunt. */
export async function uploadPictureHunt(image: Blob, caption?: string): Promise<{ hunt: PictureHuntSummary }> {
  const qs = caption?.trim() ? `?caption=${encodeURIComponent(caption.trim())}` : '';
  const response = await send(`/picture-hunts/upload${qs}`, { method: 'POST', headers: { 'Content-Type': image.type || 'image/jpeg' }, body: image });
  return response.json();
}

export async function fetchPictureHuntImage(id: string): Promise<Blob> {
  const response = await send(`/picture-hunts/${id}/image`);
  return response.blob();
}

export function retryPictureHunt(id: string): Promise<{ hunt: PictureHuntSummary }> {
  return json(`/picture-hunts/${id}/retry`, { method: 'POST' });
}

export function deletePictureHunt(id: string): Promise<{ ok: true }> {
  return json(`/picture-hunts/${id}`, { method: 'DELETE' });
}

export function uploadPictureHuntPlays(plays: PictureHuntPlay[]): Promise<{ accepted: number; stored: string[]; rejected: string[]; hunts: PictureHuntSummary[] }> {
  return json('/picture-hunts/plays', { method: 'POST', body: JSON.stringify({ plays }) });
}
