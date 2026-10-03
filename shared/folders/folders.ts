/**
 * Folders: organisation only, for decks, Lesson Library items and graded readers.
 *
 * One model for all three (`folders` table, migration 0105): a folder belongs to one
 * user and one `kind`, has a name, an optional parent (ONE level of nesting: a folder
 * inside a top-level folder), and a `position` among its siblings. Items carry a
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
  /** A top-level folder's id, or null. Never deeper than one level. */
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

/**
 * Where a folder may be placed: `parentId` must be a top-level folder of the same kind
 * owned by the same person, not the folder itself, and a folder that has subfolders
 * can't go inside another (that would make two levels). Returns a problem or null.
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
  if (parent.parent_id) return 'Folders go one level deep: pick a top-level folder';
  if (folder.id && all.some((f) => f.parent_id === folder.id)) return 'This folder has folders inside it, so it has to stay at the top level';
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
  /** Subfolders (one level). Always empty on a subfolder and on Unfiled. */
  children: FolderGroup<T>[];
  /** Items here and in the subfolders. */
  total: number;
}

/**
 * Group items into the folder tree for display: top-level folders in order, each with
 * its items (in the order given) and its subfolders; then Unfiled. An item whose
 * folder is unknown (deleted on another device, not synced yet) is Unfiled, and a
 * subfolder whose parent is unknown shows at the top level — nothing is ever hidden.
 * Folders of other kinds are ignored. Empty folders are kept (so a new one shows).
 */
export function groupIntoFolders<T>(
  items: T[],
  folderIdOf: (item: T) => string | null | undefined,
  folders: Folder[],
  kind: FolderKind,
): { groups: FolderGroup<T>[]; unfiled: FolderGroup<T> } {
  const mine = folders.filter((f) => f.kind === kind);
  const byId = new Map(mine.map((f) => [f.id, f]));
  const isTop = (f: Folder) => !f.parent_id || !byId.has(f.parent_id) || byId.get(f.parent_id)!.parent_id != null;
  const groupOf = new Map<string, FolderGroup<T>>();
  for (const f of mine) groupOf.set(f.id, { folder: f, items: [], children: [], total: 0 });
  const unfiled: FolderGroup<T> = { folder: null, items: [], children: [], total: 0 };
  for (const item of items) {
    const fid = folderIdOf(item);
    const g = fid ? groupOf.get(fid) : undefined;
    (g ?? unfiled).items.push(item);
  }
  const tops = sortFolders(mine.filter(isTop));
  for (const top of tops) {
    const g = groupOf.get(top.id)!;
    g.children = sortFolders(mine.filter((f) => !isTop(f) && f.parent_id === top.id)).map((c) => {
      const cg = groupOf.get(c.id)!;
      cg.total = cg.items.length;
      return cg;
    });
    g.total = g.items.length + g.children.reduce((s, c) => s + c.total, 0);
  }
  unfiled.total = unfiled.items.length;
  return { groups: tops.map((t) => groupOf.get(t.id)!), unfiled };
}

/** Folders in picker order: each top-level folder followed by its subfolders (depth 0 / 1). */
export function folderOptions(folders: Folder[], kind: FolderKind): Array<{ folder: Folder; depth: 0 | 1 }> {
  const { groups } = groupIntoFolders<never>([], () => null, folders, kind);
  const out: Array<{ folder: Folder; depth: 0 | 1 }> = [];
  for (const g of groups) {
    out.push({ folder: g.folder!, depth: 0 });
    for (const c of g.children) out.push({ folder: c.folder!, depth: 1 });
  }
  return out;
}

/** "HSK 2 › Week 1" — a subfolder carries its parent's name. */
export function folderPath(folder: Folder, folders: Folder[]): string {
  const parent = folder.parent_id ? folders.find((f) => f.id === folder.parent_id) : undefined;
  return parent ? `${parent.name} › ${folder.name}` : folder.name;
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

/** Body of the delete confirmation. */
export function deleteFolderMessage(kind: FolderKind, name: string, itemCount: number, subfolderCount = 0): string {
  const items = itemCount === 0
    ? `“${name}” is empty.`
    : `${itemCount === 1 ? 'Its' : `All ${itemCount}`} ${folderItemNoun(kind, itemCount)} ${itemCount === 1 ? 'moves' : 'move'} to ${UNFILED_LABEL}.`;
  const subs = subfolderCount > 0 ? ` ${subfolderCount === 1 ? 'Its folder moves' : `Its ${subfolderCount} folders move`} to the top level.` : '';
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
