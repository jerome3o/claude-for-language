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
import { findFolderByPath, folderNameKey, folderPath, movedMessage, parseFolderPath, MAX_FOLDER_DEPTH, type Folder, type FolderKind } from '../../../shared/folders';

export type ApiFolder = Folder & { item_count?: number };

const KIND = z.enum(['deck', 'lesson', 'reader']).describe("What the folder holds: 'deck' (vocabulary decks), 'lesson' (Lesson Library lessons) or 'reader' (graded readers)");

/** The optional folder params the create tools share. */
export const folderParams = {
  folder_id: z.string().optional().describe('File it in this folder (id from list_folders, same kind). Omit for Unfiled.'),
  folder: z.string().optional().describe('Or file it by folder NAME or PATH, e.g. "HSK 2" or "HSK 2 / Week 1" — the folder at that path is used; missing folders on the path are made (a single name: top-level match first, then any depth). Ignored when folder_id is given.'),
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
 * Find the folder at a path ("HSK 2 / Week 1 / Monday"), making every missing step inside
 * the one before (POST /api/folders with parent_id). Returns the last folder and whether
 * anything was made; `name` is the full path.
 */
export async function findOrCreateFolderPath(
  api: ApiClient,
  kind: FolderKind,
  path: string[],
): Promise<{ id: string; name: string; created: boolean }> {
  let all = await listFolders(api, kind);
  const hit = findFolderByPath(all, kind, path);
  if (hit) return { id: hit.id, name: folderPath(hit, all, ' / '), created: false };
  let parent: ApiFolder | null = null;
  let created = false;
  for (let i = 0; i < path.length; i++) {
    const existing = findFolderByPath(all, kind, path.slice(0, i + 1)) as ApiFolder | null;
    if (existing && (existing.parent_id ?? null) === (parent?.id ?? null)) {
      parent = existing;
      continue;
    }
    const res: { folder: ApiFolder } = await api.post<{ folder: ApiFolder }>('/api/folders', { kind, name: path[i], ...(parent ? { parent_id: parent.id } : {}) });
    parent = res.folder;
    created = true;
    all = [...all, res.folder];
  }
  return { id: parent!.id, name: folderPath(parent!, all, ' / '), created };
}

/**
 * Turn `folder_id` / `folder` (a name or a path) into a folder id: the id as given, else
 * the folder at that path, else it is made (with any missing parents). Undefined when
 * neither is set.
 */
export async function resolveFolder(
  api: ApiClient,
  kind: FolderKind,
  args: { folder_id?: string; folder?: string },
): Promise<{ id: string; name: string; created: boolean } | undefined> {
  if (args.folder_id) return { id: args.folder_id, name: '', created: false };
  const path = parseFolderPath(args.folder ?? '');
  if (!path.length) return undefined;
  return findOrCreateFolderPath(api, kind, path);
}

/** "HSK 2" / "HSK 2 / Week 1 / Monday" per folder id — the full path, for list tools. */
export function folderNames(folders: ApiFolder[]): Map<string, string> {
  return new Map(folders.map((f) => [f.id, folderPath(f, folders, ' / ')]));
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
    `List the signed-in user's folders for decks, Lesson Library lessons and graded readers: id, kind, name, path (the full path, "HSK 2 / Week 1 / Monday"), parent_id, depth (0 = top level; folders nest up to ${MAX_FOLDER_DEPTH} levels), position (among siblings) and item_count. Folders are organisation only — they never change what is studied or in what order. Pass kind to list one kind. The list tools (list_decks, list_lesson_library, list_readers) show each item's folder.`,
    { kind: KIND.optional() },
    async ({ kind }) => guard(async () => {
      const folders = await listFolders(api, kind);
      const paths = folderNames(folders);
      return jsonResult({
        count: folders.length,
        folders: folders.map((f) => ({ id: f.id, kind: f.kind, name: f.name, path: paths.get(f.id), parent_id: f.parent_id, depth: (paths.get(f.id) ?? '').split(' / ').length - 1, position: f.position, item_count: f.item_count ?? 0 })),
      });
    }),
  );

  server.tool(
    'create_folder',
    `Create a folder for decks, lessons or readers. Folders nest up to ${MAX_FOLDER_DEPTH} levels: parent_id puts it inside any folder of the same kind (the server refuses a sixth level). Or pass path ("HSK 2 / Week 1 / Monday") to make the folder at that path — missing parents are made too, existing ones reused. Names are trimmed, at most 60 characters each. To file things in it use move_to_folder, or pass folder_id / folder to create_deck, create_library_lesson, create_reader or generate_reader.`,
    {
      kind: KIND,
      name: z.string().optional().describe('Folder name, e.g. "HSK 2" or "Restaurant topic" (with parent_id, or alone for the top level)'),
      parent_id: z.string().optional().describe('A folder of the same kind to put it in (any level)'),
      path: z.string().optional().describe('Instead of name: a path of names separated by " / ", e.g. "HSK 2 / Week 1"'),
    },
    async ({ kind, name, parent_id, path }) => guard(async () => {
      if (path?.trim()) {
        const steps = parseFolderPath(path);
        if (!steps.length) return errorResult('The path has no folder names.');
        const r = await findOrCreateFolderPath(api, kind, steps);
        return jsonResult({ folder_id: r.id, path: r.name, created: r.created, message: r.created ? `Made ${kind} folder "${r.name}" (id=${r.id}).` : `${kind} folder "${r.name}" already exists (id=${r.id}).` });
      }
      if (!name) return errorResult('Pass name (with parent_id for a subfolder) or path.');
      const { folder } = await api.post<{ folder: ApiFolder }>('/api/folders', { kind, name, parent_id: parent_id ?? null });
      return jsonResult({ folder, message: `Created ${kind} folder "${folder.name}" (id=${folder.id}).` });
    }),
  );

  server.tool(
    'rename_folder',
    `Rename a folder, and/or move it (with everything inside it) into another folder of the same kind (parent_id) or back to the top level (parent_id: null). Refused when it would go inside itself or one of its own folders, or deeper than ${MAX_FOLDER_DEPTH} levels.`,
    {
      folder_id: z.string().describe('The folder id (from list_folders)'),
      name: z.string().optional().describe('New name'),
      parent_id: z.string().nullable().optional().describe('New parent (any folder of the same kind), or null for the top level; omit to keep'),
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
    'Delete a folder. NOTHING inside is deleted: its own decks / lessons / readers move to Unfiled and its subfolders (with everything in them) move up one level — into its parent folder, or to the top level.',
    { folder_id: z.string().describe('The folder id (from list_folders)') },
    async ({ folder_id }) => guard(async () => {
      const res = await api.delete<{ deleted: boolean; unfiled: number; lifted: number }>(`/api/folders/${encodeURIComponent(folder_id)}`);
      return jsonResult({ ...res, message: `Deleted the folder. ${res.unfiled} item(s) moved to Unfiled${res.lifted ? `, ${res.lifted} subfolder(s) moved up one level` : ''}; nothing was deleted.` });
    }),
  );

  server.tool(
    'move_to_folder',
    "File decks, Lesson Library lessons or readers into a folder (or back to Unfiled with folder_id: null). ids are deck ids (list_decks), library lesson ids (list_lesson_library) or reader ids (list_readers) — all of the given kind. Pass folder (a name or a path like 'HSK 2 / Week 1') instead of folder_id to use or make that folder. The study queue is not affected.",
    {
      kind: KIND,
      ids: z.array(z.string()).min(1).max(500).describe('Item ids of that kind'),
      folder_id: z.string().nullable().optional().describe('Target folder id, or null for Unfiled'),
      folder: z.string().optional().describe('Target folder by name or path, e.g. "HSK 2 / Week 1" (found or made); used when folder_id is omitted'),
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
