/**
 * Folders on the device (shared/folders; docs in CLAUDE.md "Folders").
 *
 * The folder list lives in IndexedDB (`db.folders`), replaced whole by every sync
 * (`/api/sync/changes` carries `folders`; a full sync asks `GET /api/folders`), so the
 * grouped Decks / Library / Readers lists render offline. Writes go to the server and
 * are applied to IndexedDB at once (decks' `folder_id` too), so the list moves under the
 * finger; the next sync confirms them. Collapsed groups are remembered per device.
 */
import { useCallback, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { collapseKey, toggleCollapsed, type Folder, type FolderKind } from '@shared/folders';
import { db } from '../db/database';
import {
  createFolderApi,
  deleteFolderApi,
  listFoldersApi,
  moveToFolderApi,
  reorderFoldersApi,
  updateFolderApi,
} from '../api/folders';

/** Replace the local folder list with the server's (all kinds). */
export async function replaceLocalFolders(folders: Folder[]): Promise<void> {
  const clean = folders.map(({ id, user_id, kind, name, parent_id, position, created_at, updated_at }) => ({
    id, user_id, kind, name, parent_id: parent_id ?? null, position, created_at, updated_at,
  }));
  await db.transaction('rw', db.folders, async () => {
    await db.folders.clear();
    if (clean.length) await db.folders.bulkPut(clean);
  });
}

/** Pull every folder down (full sync, or on demand). Never throws. */
export async function syncFolders(): Promise<void> {
  try {
    const { folders } = await listFoldersApi();
    await replaceLocalFolders(folders);
  } catch (err) {
    console.error('[Folders] sync failed:', err);
  }
}

/** The folders of one kind, live from IndexedDB ([] while loading). */
export function useFolders(kind: FolderKind): Folder[] {
  return useLiveQuery(() => db.folders.where('kind').equals(kind).toArray(), [kind]) ?? [];
}

export async function createFolder(kind: FolderKind, name: string, parentId: string | null = null): Promise<Folder> {
  const { folder } = await createFolderApi({ kind, name, parent_id: parentId, id: crypto.randomUUID() });
  await db.folders.put(folder);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const { folder } = await updateFolderApi(id, { name });
  await db.folders.put(folder);
  return folder;
}

/** Delete a folder: its items go back to Unfiled, its subfolders to the top level. */
export async function deleteFolder(folder: Folder): Promise<void> {
  await deleteFolderApi(folder.id);
  await db.transaction('rw', db.folders, db.decks, async () => {
    await db.folders.delete(folder.id);
    const subs = await db.folders.filter((f) => f.parent_id === folder.id).toArray();
    for (const s of subs) await db.folders.update(s.id, { parent_id: null });
    if (folder.kind === 'deck') {
      const decks = await db.decks.filter((d) => d.folder_id === folder.id).toArray();
      for (const d of decks) await db.decks.update(d.id, { folder_id: null });
    }
  });
}

/** Put items in a folder (null = Unfiled). Decks are updated on the device at once. */
export async function moveItemsToFolder(kind: FolderKind, ids: string[], folderId: string | null): Promise<number> {
  if (kind === 'deck') {
    await db.transaction('rw', db.decks, async () => {
      for (const id of ids) await db.decks.update(id, { folder_id: folderId });
    });
  }
  const { moved } = await moveToFolderApi(kind, ids, folderId);
  return moved;
}

/** Sibling folders in their new order. */
export async function reorderFolders(kind: FolderKind, orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.folders, async () => {
    for (let i = 0; i < orderedIds.length; i++) await db.folders.update(orderedIds[i], { position: i });
  });
  await reorderFoldersApi(kind, orderedIds);
}

// ---- Collapsed groups, per device ----

const COLLAPSED_PREFIX = 'folders-collapsed-v1:';

export function readCollapsed(kind: FolderKind): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_PREFIX + kind);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function useCollapsedFolders(kind: FolderKind) {
  const [collapsed, setCollapsed] = useState<string[]>(() => readCollapsed(kind));
  const toggle = useCallback(
    (folderId: string | null) => {
      setCollapsed((prev) => {
        const next = toggleCollapsed(prev, collapseKey(folderId));
        try {
          localStorage.setItem(COLLAPSED_PREFIX + kind, JSON.stringify(next));
        } catch {
          /* private mode */
        }
        return next;
      });
    },
    [kind],
  );
  const isCollapsed = useCallback((folderId: string | null) => collapsed.includes(collapseKey(folderId)), [collapsed]);
  return { isCollapsed, toggle };
}
