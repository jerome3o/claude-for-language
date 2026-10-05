/** API client for lesson materials (worker routes/materials.ts). */

import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { KeptAnnotations } from '@shared/calls';
import type { MaterialKind, MaterialStatus, MaterialTocEntry } from '@shared/materials';

const API_PATH = `${API_BASE}/api`;

export interface MaterialInfo {
  id: string;
  owner_id: string;
  title: string;
  kind: MaterialKind;
  file_name: string | null;
  mime_type: string | null;
  original_size: number | null;
  status: MaterialStatus;
  page_count: number;
  render_note: string | null;
  has_text: boolean;
  created_at: number;
  updated_at: number;
  mine: boolean;
  owner_name?: string | null;
  /** Relationship ids it is shared in (mine only). */
  shared_with?: string[];
  /** Contents (shared/materials/toc.ts) — on one material only; null = never computed (an older upload). */
  toc?: MaterialTocEntry[] | null;
}

export interface MaterialPageInfo {
  page_index: number;
  width: number | null;
  height: number | null;
  text: string;
  notes: string;
  image_url: string | null;
}

async function send(url: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...getAuthHeaders(), ...(options?.headers as Record<string, string> | undefined) };
  const response = await fetch(url.startsWith('http') ? url : `${API_BASE}${url.startsWith('/api') ? url : `/api${url}`}`, { ...options, credentials: 'include', headers });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status });
  }
  return response;
}

const json = async <T,>(url: string, options?: RequestInit & { body?: BodyInit | null }): Promise<T> =>
  (await send(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers as Record<string, string> | undefined) } })).json() as Promise<T>;

export const listMaterials = (relationshipId?: string) =>
  json<{ materials: MaterialInfo[] }>(`${API_PATH}/materials${relationshipId ? `?relationship_id=${encodeURIComponent(relationshipId)}` : ''}`);
export const getMaterial = (id: string) => json<{ material: MaterialInfo; pages: MaterialPageInfo[] }>(`${API_PATH}/materials/${id}`);
export const createMaterial = (input: { title?: string; file_name: string; mime_type: string; size: number }) =>
  json<{ material: MaterialInfo }>(`${API_PATH}/materials`, { method: 'POST', body: JSON.stringify(input) });
export const uploadOriginal = (id: string, file: Blob) => send(`${API_PATH}/materials/${id}/original`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
export const uploadPage = (id: string, n: number, image: Blob) => send(`${API_PATH}/materials/${id}/pages/${n}`, { method: 'PUT', body: image, headers: { 'Content-Type': image.type || 'image/jpeg' } });
export const completeMaterial = (id: string, pages: { index: number; text: string; notes: string }[], renderNote?: string | null, toc?: MaterialTocEntry[] | null) =>
  json<{ material: MaterialInfo }>(`${API_PATH}/materials/${id}/complete`, { method: 'POST', body: JSON.stringify({ pages, render_note: renderNote ?? null, toc: toc ?? null }) });
/** The uploader's device fills in an older material's Contents. */
export const setMaterialToc = (id: string, toc: MaterialTocEntry[]) => json<{ material: MaterialInfo }>(`${API_PATH}/materials/${id}`, { method: 'PATCH', body: JSON.stringify({ toc }) });
export const renameMaterial = (id: string, title: string) => json<{ material: MaterialInfo }>(`${API_PATH}/materials/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
export const deleteMaterial = (id: string) => json<{ ok: true }>(`${API_PATH}/materials/${id}`, { method: 'DELETE' });
export const shareMaterial = (id: string, relationshipId: string) => json<{ ok: true }>(`${API_PATH}/materials/${id}/share`, { method: 'POST', body: JSON.stringify({ relationship_id: relationshipId }) });
export const unshareMaterial = (id: string, relationshipId: string) => json<{ ok: true }>(`${API_PATH}/materials/${id}/share/${relationshipId}`, { method: 'DELETE' });
export const materialAnnotations = (id: string, lessonId: string) =>
  json<{ pages: Record<number, KeptAnnotations> }>(`${API_PATH}/materials/${id}/annotations?lesson_id=${encodeURIComponent(lessonId)}`);

/** A page picture (with the session), as a blob. */
export async function fetchPageImage(imageUrl: string): Promise<Blob> {
  return (await send(imageUrl)).blob();
}
