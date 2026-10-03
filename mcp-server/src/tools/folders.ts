/**
 * Folders for decks, Lesson Library lessons and graded readers (shared/folders,
 * worker routes/folders.ts) — organisation only, never the study queue.
 *
 * Tools: list_folders, create_folder, rename_folder, delete_folder, move_to_folder.
 * The create / list tools elsewhere take `folder_id` or `folder` (a name, found or
 * made) through `folderParams` + `resolveFolder`, so Claude can file what it makes.
 * Everything goes through the main API as the signed-in user.
 */
import { z } from 'zod';
import type { ApiClient } from '../api.js';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';
import { folderNameKey, folderPath, movedMessage, type Folder, type FolderKind } from '../../../shared/folders';

export type ApiFolder = Folder & { item_count?: number };

const KIND = z.enum(['deck', 'lesson', 'reader']).describe("What the folder holds: 'deck' (vocabulary decks), 'lesson' (Lesson Library lessons) or 'reader' (graded readers)");

/** The optional folder params the create tools share. */
export const folderParams = {
  folder_id: z.string().optional().describe('File it in this folder (id from list_folders, same kind). Omit for Unfiled.'),
  folder: z.string().optional().describe('Or file it by folder NAME, e.g. "HSK 2" — a top-level folder with that name is used, or made if none exists. Ignored when folder_id is given.'),
};

/** A folder matched by name (case / spacing ignored), top-level first. Pure. */
export function matchFolderByName(folders: ApiFolder[], kind: FolderKind, name: string): ApiFolder | null {
  const key = folderNameKey(name);
  if (!key) return null;
  const mine = folders.filter((f) => f.kind === kind && folderNameKey(f.name) === key);
  return mine.find((f) => !f.parent_id) ?? mine[0] ?? null;
}

export async function listFolders(api: ApiClient, kind?: FolderKind): Promise<ApiFolder[]> {
  const res = await api.get<{ folders: ApiFolder[] }>('/api/folders', kind ? { kind } : undefined);
  return res.folders ?? [];
}

/**
 * Turn `folder_id` / `folder` (name) into a folder id: the id as given, else the
 * folder with that name, else a new top-level folder. Undefined when neither is set.
 */
export async function resolveFolder(
  api: ApiClient,
  kind: FolderKind,
  args: { folder_id?: string; folder?: string },
): Promise<{ id: string; name: string; created: boolean } | undefined> {
  if (args.folder_id) return { id: args.folder_id, name: '', created: false };
  const name = args.folder?.trim();
  if (!name) return undefined;
  const hit = matchFolderByName(await listFolders(api, kind), kind, name);
  if (hit) return { id: hit.id, name: hit.name, created: false };
  const { folder } = await api.post<{ folder: ApiFolder }>('/api/folders', { kind, name });
  return { id: folder.id, name: folder.name, created: true };
}

/** "HSK 2" / "HSK 2 › Week 1" per folder id, for list tools. */
export function folderNames(folders: ApiFolder[]): Map<string, string> {
  return new Map(folders.map((f) => [f.id, folderPath(f, folders)]));
}

/** A short line for a create tool's reply. */
export function filedNote(filed: { name: string; created: boolean } | undefined): string {
  if (!filed) return '';
  if (!filed.name) return ' Filed in the folder.';
  return filed.created ? ` Filed in a new folder "${filed.name}".` : ` Filed in "${filed.name}".`;
}

export function registerFolderTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_folders',
    "List the signed-in user's folders for decks, Lesson Library lessons and graded readers: id, kind, name, parent_id (folders nest ONE level), position and item_count. Folders are organisation only — they never change what is studied or in what order. Pass kind to list one kind. The list tools (list_decks, list_lesson_library, list_readers) show each item's folder.",
    { kind: KIND.optional() },
    async ({ kind }) => guard(async () => {
      const folders = await listFolders(api, kind);
      const paths = folderNames(folders);
      return jsonResult({
        count: folders.length,
        folders: folders.map((f) => ({ id: f.id, kind: f.kind, name: f.name, path: paths.get(f.id), parent_id: f.parent_id, position: f.position, item_count: f.item_count ?? 0 })),
      });
    }),
  );

  server.tool(
    'create_folder',
    "Create a folder for decks, lessons or readers. parent_id puts it inside a TOP-LEVEL folder of the same kind (one level of nesting only). Names are trimmed, at most 60 characters. To file things in it use move_to_folder, or pass folder_id / folder to create_deck, create_library_lesson, create_reader or generate_reader.",
    {
      kind: KIND,
      name: z.string().describe('Folder name, e.g. "HSK 2" or "Restaurant topic"'),
      parent_id: z.string().optional().describe('A top-level folder of the same kind to put it in'),
    },
    async ({ kind, name, parent_id }) => guard(async () => {
      const { folder } = await api.post<{ folder: ApiFolder }>('/api/folders', { kind, name, parent_id: parent_id ?? null });
      return jsonResult({ folder, message: `Created ${kind} folder "${folder.name}" (id=${folder.id}).` });
    }),
  );

  server.tool(
    'rename_folder',
    'Rename a folder, and/or move it inside a top-level folder (parent_id) or back to the top level (parent_id: null).',
    {
      folder_id: z.string().describe('The folder id (from list_folders)'),
      name: z.string().optional().describe('New name'),
      parent_id: z.string().nullable().optional().describe('New parent (a top-level folder of the same kind), or null for the top level; omit to keep'),
    },
    async ({ folder_id, name, parent_id }) => guard(async () => {
      if (name === undefined && parent_id === undefined) return errorResult('Pass name and/or parent_id.');
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (parent_id !== undefined) body.parent_id = parent_id;
      const { folder } = await api.patch<{ folder: ApiFolder }>(`/api/folders/${encodeURIComponent(folder_id)}`, body);
      return jsonResult({ folder });
    }),
  );

  server.tool(
    'delete_folder',
    'Delete a folder. NOTHING inside is deleted: its decks / lessons / readers move to Unfiled and its subfolders move to the top level.',
    { folder_id: z.string().describe('The folder id (from list_folders)') },
    async ({ folder_id }) => guard(async () => {
      const res = await api.delete<{ deleted: boolean; unfiled: number; lifted: number }>(`/api/folders/${encodeURIComponent(folder_id)}`);
      return jsonResult({ ...res, message: `Deleted the folder. ${res.unfiled} item(s) moved to Unfiled${res.lifted ? `, ${res.lifted} subfolder(s) moved to the top level` : ''}; nothing was deleted.` });
    }),
  );

  server.tool(
    'move_to_folder',
    "File decks, Lesson Library lessons or readers into a folder (or back to Unfiled with folder_id: null). ids are deck ids (list_decks), library lesson ids (list_lesson_library) or reader ids (list_readers) — all of the given kind. Pass folder (a name) instead of folder_id to use or make a top-level folder by name. The study queue is not affected.",
    {
      kind: KIND,
      ids: z.array(z.string()).min(1).max(500).describe('Item ids of that kind'),
      folder_id: z.string().nullable().optional().describe('Target folder id, or null for Unfiled'),
      folder: z.string().optional().describe('Target folder by name (found or made); used when folder_id is omitted'),
    },
    async ({ kind, ids, folder_id, folder }) => guard(async () => {
      let target: string | null;
      let name: string | null = null;
      if (folder_id !== undefined) target = folder_id;
      else if (folder?.trim()) {
        const r = await resolveFolder(api, kind, { folder });
        target = r!.id;
        name = r!.name;
      } else return errorResult('Pass folder_id (null for Unfiled) or folder (a name).');
      const res = await api.post<{ moved: number; not_found: string[]; folder_id: string | null }>('/api/folders/move', { kind, ids, folder_id: target });
      if (target && !name) name = (await listFolders(api, kind)).find((f) => f.id === target)?.name ?? null;
      return jsonResult({
        ...res,
        message: `${movedMessage(kind, res.moved, name)}.${res.not_found.length ? ` Not found (not yours, or not a ${kind}): ${res.not_found.join(', ')}.` : ''}`,
      });
    }),
  );
}
