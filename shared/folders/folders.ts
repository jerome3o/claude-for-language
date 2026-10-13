/**
 * Folders: organisation only, for decks, Lesson Library items and graded readers.
 *
 * One model for all three (`folders` table, migration 0105): a folder belongs to one
 * user and one `kind`, has a name, an optional parent (folders nest up to MAX_FOLDER_DEPTH levels:
 * a folder inside a folder inside …), and a `position` among its siblings. Items carry a
 * nullable `folder_id`; NULL = Unfiled. Folders never touch the study queue — the deck
 * queue (`study_priority`) is the same with or without them.
 *
 * Everything here is pure and shared by the worker (validation), the web app (grouping,
 * collapsed state) and — ported, parity-tested — the Lab app.
 */

export type FolderKind = 'deck' | 'lesson' | 'reader';
export const FOLDER_KINDS: readonly FolderKind[] = ['deck', 'lesson', 'reader'];

export const FOLDER_NAME_MAX = 60;
/** Per user and kind — generous, but a runaway agent can't make thousands. */
export const MAX_FOLDERS_PER_KIND = 200;

export interface Folder {
  id: string;
  user_id: string;
  kind: FolderKind;
  name: string;
  /** The folder it sits in, or null = top level. At most MAX_FOLDER_DEPTH levels deep. */
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export function isFolderKind(v: unknown): v is FolderKind {
  return v === 'deck' || v === 'lesson' || v === 'reader';
}

/** What the person calls the things a kind of folder holds. */
export function folderItemNoun(kind: FolderKind, count = 2): string {
  const one = kind === 'deck' ? 'deck' : kind === 'lesson' ? 'lesson' : 'reader';
  return count === 1 ? one : `${one}s`;
}

/** Trimmed, inner whitespace collapsed; '' when blank. */
export function cleanFolderName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** Problems with a folder name (empty list = fine). */
export function folderNameProblems(raw: unknown): string[] {
  const name = cleanFolderName(raw);
  if (!name) return ['Give the folder a name'];
  if ([...name].length > FOLDER_NAME_MAX) return [`Folder names are at most ${FOLDER_NAME_MAX} characters`];
  return [];
}

/** Case- and space-insensitive key for matching a folder by name (MCP `folder: "HSK 2"`). */
export function folderNameKey(name: string): string {
  return cleanFolderName(name).toLocaleLowerCase();
}

/** How deep folders nest: a top-level folder is level 1, its subfolders level 2, … */
export const MAX_FOLDER_DEPTH = 5;

type FolderLink = Pick<Folder, 'id' | 'parent_id'>;

/**
 * A folder's ancestors, the top-level one first (not the folder itself). Walks `parent_id`
 * through `all`; stops at an unknown parent or a cycle (bad data never loops forever).
 */
export function folderAncestors<F extends FolderLink>(folder: F, all: F[]): F[] {
  const byId = new Map(all.map((f) => [f.id, f]));
  const out: F[] = [];
  const seen = new Set<string>([folder.id]);
  let cur = folder.parent_id ? byId.get(folder.parent_id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

/** The level a folder sits at: 1 = top level. */
export function folderLevel(folder: FolderLink, all: FolderLink[]): number {
  return folderAncestors(folder, all).length + 1;
}

/** Every folder inside `folderId`, at any depth (not the folder itself), breadth-first. */
export function folderDescendantIds(folderId: string, all: FolderLink[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const f of all) {
      if (f.parent_id === id && !seen.has(f.id)) {
        seen.add(f.id);
        out.push(f.id);
        queue.push(f.id);
      }
    }
  }
  return out;
}

/** Levels in a folder's subtree, itself included: 1 = no subfolders. */
export function subtreeLevels(folderId: string, all: FolderLink[]): number {
  const seen = new Set<string>([folderId]);
  let level = [folderId];
  let levels = 0;
  while (level.length) {
    levels++;
    const ids = new Set(level);
    level = all.filter((f) => f.parent_id != null && ids.has(f.parent_id) && !seen.has(f.id)).map((f) => f.id);
    for (const id of level) seen.add(id);
  }
  return levels;
}

/**
 * Where a folder may be placed: `parentId` must be a folder of the same kind owned by the
 * same person, not the folder itself nor one of its own subfolders (no cycles), and the
 * folder with everything inside it must still fit within MAX_FOLDER_DEPTH levels.
 * `folder.id` null = a new folder. Returns a problem or null.
 */
export function parentProblem(
  folder: { id: string | null; kind: FolderKind },
  parentId: string | null,
  all: Array<Pick<Folder, 'id' | 'kind' | 'parent_id'>>,
): string | null {
  if (parentId == null) return null;
  if (folder.id && parentId === folder.id) return "A folder can't go inside itself";
  const parent = all.find((f) => f.id === parentId);
  if (!parent || parent.kind !== folder.kind) return 'That folder does not exist';
  if (folder.id && folderDescendantIds(folder.id, all).includes(parentId)) return "A folder can't go inside one of its own folders";
  const height = folder.id ? subtreeLevels(folder.id, all) : 1;
  if (folderLevel(parent, all) + height > MAX_FOLDER_DEPTH) {
    return height > 1
      ? `Folders go ${MAX_FOLDER_DEPTH} levels deep: this folder and the folders inside it don't fit there`
      : `Folders go ${MAX_FOLDER_DEPTH} levels deep: pick a folder higher up`;
  }
  return null;
}

/** Siblings in display order: position, then name, then id. */
export function sortFolders<T extends Pick<Folder, 'position' | 'name' | 'id'>>(folders: T[]): T[] {
  return folders.slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface FolderGroup<T> {
  /** null = Unfiled. */
  folder: Folder | null;
  items: T[];
  /** Subfolders in order, each with theirs (any depth). Always empty on Unfiled. */
  children: FolderGroup<T>[];
  /** Items here and in every subfolder below. */
  total: number;
  /** 0 = top level (and Unfiled), 1 = inside a top-level folder, … */
  depth: number;
}

/**
 * The parent each folder is drawn under, or null = top level. A folder is drawn under its
 * parent only when walking up its parents reaches a top-level folder; an unknown parent or
 * a cycle (data no server write makes) puts it at the top level — nothing is hidden.
 */
function displayParents(mine: Folder[]): Map<string, string | null> {
  const byId = new Map(mine.map((f) => [f.id, f]));
  const out = new Map<string, string | null>();
  for (const f of mine) {
    const seen = new Set<string>([f.id]);
    let cur = f;
    let rooted = false;
    for (;;) {
      const p = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      if (!p) { rooted = true; break; }
      if (seen.has(p.id)) break;
      seen.add(p.id);
      cur = p;
    }
    const parent = f.parent_id ? byId.get(f.parent_id) : undefined;
    out.set(f.id, rooted && parent ? parent.id : null);
  }
  return out;
}

/**
 * Group items into the folder tree for display: top-level folders in order, each with
 * its items (in the order given) and its subfolders, at any depth; then Unfiled. An item
 * whose folder is unknown (deleted on another device, not synced yet) is Unfiled, and a
 * folder whose parent is unknown shows at the top level — nothing is ever hidden.
 * Folders of other kinds are ignored. Empty folders are kept (so a new one shows).
 */
export function groupIntoFolders<T>(
  items: T[],
  folderIdOf: (item: T) => string | null | undefined,
  folders: Folder[],
  kind: FolderKind,
): { groups: FolderGroup<T>[]; unfiled: FolderGroup<T> } {
  const mine = folders.filter((f) => f.kind === kind);
  const parents = displayParents(mine);
  const itemsOf = new Map<string, T[]>();
  for (const f of mine) itemsOf.set(f.id, []);
  const unfiledItems: T[] = [];
  for (const item of items) {
    const fid = folderIdOf(item);
    const list = fid ? itemsOf.get(fid) : undefined;
    (list ?? unfiledItems).push(item);
  }
  const childrenOf = new Map<string | null, Folder[]>();
  for (const f of mine) {
    const p = parents.get(f.id) ?? null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(f);
  }
  const built = new Set<string>();
  const build = (f: Folder, depth: number): FolderGroup<T> => {
    built.add(f.id);
    const children = sortFolders((childrenOf.get(f.id) ?? []).filter((c) => !built.has(c.id))).map((c) => build(c, depth + 1));
    const own = itemsOf.get(f.id) ?? [];
    return { folder: f, items: own, children, total: own.length + children.reduce((s, c) => s + c.total, 0), depth };
  };
  const groups = sortFolders(childrenOf.get(null) ?? []).map((f) => build(f, 0));
  return { groups, unfiled: { folder: null, items: unfiledItems, children: [], total: unfiledItems.length, depth: 0 } };
}

/** Every folder group of a tree, each before its subfolders (depth-first, in order). */
export function flattenFolderGroups<T>(groups: FolderGroup<T>[]): FolderGroup<T>[] {
  const out: FolderGroup<T>[] = [];
  const walk = (g: FolderGroup<T>) => { out.push(g); g.children.forEach(walk); };
  groups.forEach(walk);
  return out;
}

/** Folders in picker order: depth-first, each folder followed by its subfolders, with their depth. */
export function folderOptions(folders: Folder[], kind: FolderKind): Array<{ folder: Folder; depth: number }> {
  const { groups } = groupIntoFolders<never>([], () => null, folders, kind);
  return flattenFolderGroups(groups).map((g) => ({ folder: g.folder!, depth: g.depth }));
}

/** "HSK 2 › Week 1 › Monday" — a folder with every parent's name. */
export function folderPath(folder: Folder, folders: Folder[], separator = ' › '): string {
  return [...folderAncestors(folder, folders).map((f) => f.name), folder.name].join(separator);
}

/** "HSK 2 / Week 1" or "HSK 2 › Week 1" → ["HSK 2", "Week 1"] (cleaned, blanks dropped). */
export function parseFolderPath(path: string): string[] {
  return path.split(/[/›>]/).map(cleanFolderName).filter(Boolean);
}

/**
 * The folder at a path of names (case / spacing ignored), from the top level down; null
 * when a step is missing. A one-name path also finds that name at any depth (top level
 * first, then the tree in order), the way a person says "Week 1".
 */
export function findFolderByPath(folders: Folder[], kind: FolderKind, path: string[]): Folder | null {
  if (!path.length) return null;
  const tree = groupIntoFolders<never>([], () => null, folders, kind);
  let level = tree.groups;
  let hit: FolderGroup<never> | undefined;
  for (const name of path) {
    const key = folderNameKey(name);
    hit = level.find((g) => folderNameKey(g.folder!.name) === key);
    if (!hit) break;
    level = hit.children;
  }
  if (hit) return hit.folder;
  if (path.length === 1) {
    const key = folderNameKey(path[0]);
    return flattenFolderGroups(tree.groups).find((g) => folderNameKey(g.folder!.name) === key)?.folder ?? null;
  }
  return null;
}

/**
 * A group's items reordered inside the whole list: the group's slots in `all` keep their
 * places and are refilled in `groupOrder`. Used when a deck is dragged within its folder
 * — the deck queue is global, so the rest of the queue does not move.
 */
export function spliceGroupOrder(all: string[], groupOrder: string[]): string[] {
  const inGroup = new Set(groupOrder);
  let i = 0;
  return all.map((id) => (inGroup.has(id) ? groupOrder[i++] ?? id : id));
}

/** Key for a collapsed folder in per-device storage; Unfiled is `unfiled`. */
export function collapseKey(folderId: string | null): string {
  return folderId ?? 'unfiled';
}

/** Toggle one key in a collapsed set (returns a new array, sorted, no duplicates). */
export function toggleCollapsed(collapsed: string[], key: string): string[] {
  const set = new Set(collapsed);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set].sort();
}

// ---- Copy (the same words on the web and in the Lab app) ----

export const UNFILED_LABEL = 'Unfiled';

/**
 * Body of the delete confirmation. A deleted folder's own items go to Unfiled; its
 * subfolders (with everything in them) move up one level — into `parentName`, or to the
 * top level when the folder was at the top.
 */
export function deleteFolderMessage(kind: FolderKind, name: string, itemCount: number, subfolderCount = 0, parentName: string | null = null): string {
  const items = itemCount === 0
    ? `“${name}” is empty.`
    : `${itemCount === 1 ? 'Its' : `All ${itemCount}`} ${folderItemNoun(kind, itemCount)} ${itemCount === 1 ? 'moves' : 'move'} to ${UNFILED_LABEL}.`;
  const where = parentName ? `into “${parentName}”` : 'to the top level';
  const subs = subfolderCount > 0 ? ` ${subfolderCount === 1 ? 'Its folder moves' : `Its ${subfolderCount} folders move`} ${where}.` : '';
  return `${items}${subs} Nothing is deleted.`;
}

/** Toast after a move: "Moved 3 decks to HSK 2" / "Moved 1 lesson to Unfiled". */
export function movedMessage(kind: FolderKind, count: number, folderName: string | null): string {
  return `Moved ${count} ${folderItemNoun(kind, count)} to ${folderName ?? UNFILED_LABEL}`;
}

/** Folder header count: "3 decks" / "1 lesson" / "Empty". */
export function folderCountLabel(kind: FolderKind, count: number): string {
  return count === 0 ? 'Empty' : `${count} ${folderItemNoun(kind, count)}`;
}
