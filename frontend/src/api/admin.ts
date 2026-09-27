/** Admin: account inspection, role, deletion (worker/src/routes/admin.ts). */
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { UserRole } from '../types';

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
  return response.json() as Promise<T>;
}

const user = (id: string) => `/admin/users/${encodeURIComponent(id)}`;

export interface AdminShareRow {
  id: string;
  relationship_id: string;
  shared_at: string;
  source_deck_id: string;
  source_name: string | null;
  source_owner: string | null;
  target_deck_id: string;
  target_name: string | null;
  target_owner: string | null;
  source_exists: boolean;
  target_exists: boolean;
}

export interface AdminUserDecks {
  decks: Array<{ id: string; name: string; created_at: string; updated_at: string; study_priority: number | null; note_count: number }>;
  deleted_decks: Array<{ id: string; deleted_at: string; name_hint: string | null; notes_deleted_with_it: number }>;
  shares_sent: AdminShareRow[];
  shares_received: AdminShareRow[];
  untombstoned_deleted_sources: string[];
}

export interface AdminUserInspection {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    role: UserRole;
    is_admin: boolean;
    can_invite: boolean;
    landing_page: string | null;
    created_at: string;
    last_login_at: string | null;
  };
  counts: {
    decks: number;
    notes: number;
    review_events: number;
    last_review_at: string | null;
    readers: number;
    custom_lessons: number;
    library_lessons: number;
    deleted_decks: number;
    deleted_notes: number;
  };
  sync: {
    last_opened_at: string | null;
    install_kind: string | null;
    cached_audio_count: number | null;
    last_event_sync_at: string | null;
    last_event_at: string | null;
    active_sessions: number;
    last_session_created_at: string | null;
    mcp_tokens: number;
  };
  relationships: Array<{ id: string; status: string; my_role: 'tutor' | 'student'; other: { id: string; email: string | null; name: string | null } }>;
  recent_feature_requests: Array<{ id: string; created_at: string; content: string; page_context: string | null; status: string; screenshot_url: string | null }>;
  decks: AdminUserDecks;
}

export interface DeletionPreview {
  user: { id: string; email: string | null; name: string | null; role: string };
  blockers: string[];
  will_delete: Record<string, number>;
  will_keep: Record<string, number>;
  r2_objects: number;
}

export interface DeletionResult {
  deleted: Record<string, number>;
  kept: Record<string, number>;
  r2_objects_deleted: number;
}

export const inspectAdminUser = (id: string) => apiFetch<AdminUserInspection>(`${user(id)}/inspect`);

export const setAdminUserRole = (id: string, role: UserRole) =>
  apiFetch<{ id: string; role: UserRole }>(`${user(id)}/role`, { method: 'PUT', body: JSON.stringify({ role }) });

export const getDeletionPreview = (id: string) => apiFetch<DeletionPreview>(`${user(id)}/deletion-preview`);

export const deleteAdminUser = (id: string, confirmEmail: string) =>
  apiFetch<DeletionResult>(user(id), { method: 'DELETE', body: JSON.stringify({ confirm_email: confirmEmail }) });
