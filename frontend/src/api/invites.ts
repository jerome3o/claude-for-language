import { API_BASE, getAuthHeaders, authEvents } from './client';
import type {
  Invite,
  CreateInviteInput,
  PublicInvite,
  AccessRequest,
  RedeemResult,
} from '../types/invites';

const API_PATH = `${API_BASE}/api`;

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_PATH}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/** Where "Continue with Google" on /join sends the visitor. */
export function getInviteLoginUrl(token: string): string {
  return `${API_PATH}/auth/login?invite=${encodeURIComponent(token)}`;
}

// ---------- Public ----------

/** No auth. 404 → "not found"; anything else is a network problem. */
export async function getPublicInvite(token: string): Promise<PublicInvite | null> {
  const response = await fetch(`${API_PATH}/invites/${encodeURIComponent(token)}/public`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ---------- Mine ----------

export async function listInvites(all = false): Promise<Invite[]> {
  return apiFetch<Invite[]>(all ? '/invites?all=1' : '/invites');
}

export async function createInvite(input: CreateInviteInput): Promise<Invite> {
  return apiFetch<Invite>('/invites', { method: 'POST', body: JSON.stringify(input) });
}

export async function revokeInvite(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** A signed-in user accepting someone's /join link. */
export async function redeemInvite(token: string): Promise<RedeemResult> {
  return apiFetch<RedeemResult>(`/invites/${encodeURIComponent(token)}/redeem`, { method: 'POST' });
}

// ---------- Admin ----------

export async function listAccessRequests(status: 'pending' | 'all' = 'pending'): Promise<AccessRequest[]> {
  return apiFetch<AccessRequest[]>(`/admin/access-requests?status=${status}`);
}

export async function approveAccessRequest(id: string): Promise<{ request: AccessRequest; invite: Invite }> {
  return apiFetch(`/admin/access-requests/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export async function dismissAccessRequest(id: string): Promise<AccessRequest> {
  return apiFetch(`/admin/access-requests/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}

export async function setUserCanInvite(userId: string, canInvite: boolean): Promise<void> {
  await apiFetch(`/admin/users/${encodeURIComponent(userId)}/can-invite`, {
    method: 'PUT',
    body: JSON.stringify({ can_invite: canInvite }),
  });
}
