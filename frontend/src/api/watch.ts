/** API client for 📺 Watch (worker routes/watch.ts, docs/WATCH.md). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { WatchVideoDetail, WatchVideoSummary } from '@shared/watch';

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

export function listWatchVideos(): Promise<{ videos: WatchVideoSummary[]; available: boolean }> {
  return json('/watch');
}

export function getWatchVideo(id: string): Promise<{ video: WatchVideoDetail }> {
  return json(`/watch/videos/${encodeURIComponent(id)}`);
}

export function addWatchVideo(body: { video_id: string; duration_ms: number; title?: string; source?: 'paste' | 'share' | 'show' }): Promise<{ video: WatchVideoDetail; existing: boolean }> {
  return json('/watch/videos', { method: 'POST', body: JSON.stringify(body) });
}

export function saveWatchPosition(id: string, positionMs: number, keepalive = false): Promise<{ saved: boolean }> {
  return json(`/watch/videos/${encodeURIComponent(id)}/position`, { method: 'PUT', body: JSON.stringify({ position_ms: Math.round(positionMs) }), keepalive });
}

export function retryWatchVideo(id: string): Promise<{ video: WatchVideoDetail }> {
  return json(`/watch/videos/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export function removeWatchVideo(id: string): Promise<{ removed: boolean }> {
  return json(`/watch/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
