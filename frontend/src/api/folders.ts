/** Folders API (worker/src/routes/folders.ts). */
import type { Folder, FolderKind } from '@shared/folders';
import { API_BASE, getAuthHeaders } from './client';

export type FolderWithCount = Folder & { item_count: number };

export class FolderApiError extends Error {
  constructor(message: string, public status: number, public problems: string[] = []) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[] };
    throw new FolderApiError(body.error || `HTTP ${res.status}`, res.status, body.problems ?? []);
  }
  return res.json() as Promise<T>;
}

export function listFoldersApi(kind?: FolderKind): Promise<{ folders: FolderWithCount[] }> {
  return call(`/folders${kind ? `?kind=${kind}` : ''}`);
}

export function createFolderApi(input: { kind: FolderKind; name: string; parent_id?: string | null; id?: string }): Promise<{ folder: Folder }> {
  return call('/folders', { method: 'POST', body: JSON.stringify(input) });
}

export function updateFolderApi(id: string, patch: { name?: string; parent_id?: string | null }): Promise<{ folder: Folder }> {
  return call(`/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteFolderApi(id: string): Promise<{ deleted: true; unfiled: number; lifted: number }> {
  return call(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function reorderFoldersApi(kind: FolderKind, folderIds: string[]): Promise<{ reordered: number }> {
  return call('/folders/reorder', { method: 'PUT', body: JSON.stringify({ kind, folder_ids: folderIds }) });
}

export function moveToFolderApi(kind: FolderKind, ids: string[], folderId: string | null): Promise<{ moved: number; not_found: string[]; folder_id: string | null }> {
  return call('/folders/move', { method: 'POST', body: JSON.stringify({ kind, ids, folder_id: folderId }) });
}
