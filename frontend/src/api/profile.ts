/**
 * API client for the Profile screen (worker routes/profile.ts).
 * A 400 carries `problems` (shared/profile pickProfileUpdate / picture checks),
 * surfaced on the thrown error so the form can show them inline.
 */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { Profile, ProfileUpdate } from '@shared/profile';

const API_PATH = `${API_BASE}/api`;

export class ProfileError extends Error {
  constructor(message: string, readonly problems: string[] = [], readonly status?: number) {
    super(message);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_PATH}${url}`, {
      ...options,
      credentials: 'include',
      headers: { ...getAuthHeaders(), ...(options?.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new ProfileError('You\'re offline — your profile will need a connection to save.');
  }
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new ProfileError('Unauthorized', [], 401);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; problems?: string[] };
    throw new ProfileError(body.error || `HTTP ${response.status}`, body.problems ?? [], response.status);
  }
  return response.json();
}

export function getProfile(): Promise<Profile> {
  return request('/profile');
}

export function updateProfile(update: ProfileUpdate): Promise<Profile> {
  return request('/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
}

/** Upload an already-cropped picture (the server checks the bytes, ≤ 2 MB). */
export function uploadProfilePicture(image: Blob): Promise<Profile> {
  return request('/profile/picture', {
    method: 'POST',
    headers: { 'Content-Type': image.type || 'image/jpeg' },
    body: image,
  });
}

/** Drop the uploaded picture: back to the Google photo, or no photo at all. */
export function removeProfilePicture(use: 'google' | 'none'): Promise<Profile> {
  return request(`/profile/picture?use=${use}`, { method: 'DELETE' });
}
