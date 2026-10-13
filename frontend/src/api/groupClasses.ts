/** API client for group classes — EXPERIMENTAL prototype (worker routes/group-classes.ts, docs/GROUP_CLASSES.md). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import { callSocketUrl } from './calls';
import type { CallJoinInfo } from '../types/calls';

const API_PATH = `${API_BASE}/api`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PATH}${url}`, {
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
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status, problems: error.problems as string[] | undefined });
  }
  return response.json();
}

export interface GroupMember {
  user_id: string;
  name: string;
  picture_url: string | null;
  relationship_id: string;
}

export interface GroupSession {
  id: string;
  group_id: string;
  tutor_id: string;
  status: 'live' | 'ended';
  created_at: number;
  ended_at: number | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  tutor_id: string;
  tutor_name: string;
  created_at: string;
  members: GroupMember[];
  live_session: GroupSession | null;
}

export const listGroups = () => request<{ teaching: GroupSummary[]; member_of: GroupSummary[] }>('/groups');
export const listGroupCandidates = () => request<{ students: GroupMember[] }>('/groups/candidates');
export const createGroup = (name: string, studentIds: string[]) =>
  request<{ group: GroupSummary }>('/groups', { method: 'POST', body: JSON.stringify({ name, student_ids: studentIds }) });
export const updateGroup = (id: string, body: { name?: string; student_ids?: string[] }) =>
  request<{ group: GroupSummary }>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteGroup = (id: string) => request<{ archived: true }>(`/groups/${id}`, { method: 'DELETE' });
export const startGroupSession = (groupId: string) =>
  request<{ session: GroupSession; reused: boolean }>(`/groups/${groupId}/sessions`, { method: 'POST' });
export const getGroupSession = (id: string) =>
  request<{ session: GroupSession; group: GroupSummary; role: 'tutor' | 'student' }>(`/group-sessions/${id}`);
export const notifyGroupSession = (id: string) => request<{ sent: number; failed: string[] }>(`/group-sessions/${id}/notify`, { method: 'POST' });
export const joinGroupSession = (id: string) => request<CallJoinInfo>(`/group-sessions/${id}/join`, { method: 'POST' });
export const endGroupSession = (id: string) => request<{ ended: true }>(`/group-sessions/${id}/end`, { method: 'POST' });

export const groupSocketUrl = callSocketUrl;

/** "I've left" from a page that is going away (see api/calls.ts sendLeaveBeacon). */
export function sendGroupLeaveBeacon(sessionId: string, clientId: string, token: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  try {
    return navigator.sendBeacon(`${API_PATH}/group-sessions/${encodeURIComponent(sessionId)}/leave`, new Blob([JSON.stringify({ client_id: clientId, token })], { type: 'text/plain' }));
  } catch {
    return false;
  }
}
