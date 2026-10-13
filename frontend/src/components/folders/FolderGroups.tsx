/**
 * Items shown in collapsible folder groups (shared/folders `groupIntoFolders`): the
 * folder tree (folders inside folders, up to MAX_FOLDER_DEPTH levels), then Unfiled.
 * Used by the Decks list, the Library and the Readers list; each page renders its own
 * items per group.
 *
 * - Collapsed groups are remembered per device (`useCollapsedFolders`), per folder.
 * - Press and hold a folder's header to drag it among its siblings (any level).
 * - With no folders of this kind the items render as before (no Unfiled header).
 * - `flat` (searching): one plain list, nothing hidden in a collapsed folder.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  folderCountLabel,
  folderLevel,
  groupIntoFolders,
  movedMessage,
  MAX_FOLDER_DEPTH,
  UNFILED_LABEL,
  type Folder,
  type FolderGroup,
  type FolderKind,
} from '@shared/folders';
import { useLongPressReorder } from '../../services/dragReorder';
import { track } from '../../services/analytics';
import {
  createFolder,
  deleteFolder,
  moveFolder,
  moveItemsToFolder,
  renameFolder,
  reorderFolders,
  useCollapsedFolders,
  useFolders,
} from '../../services/folders';
import { DeleteFolderSheet, FolderNameSheet, MoveFolderSheet, MoveToFolderSheet } from './FolderSheets';
import './folders.css';

type SheetState =
  | { type: 'create'; parentId: string | null }
  | { type: 'rename'; folder: Folder }
  | { type: 'delete'; folder: Folder; itemCount: number; subfolderCount: number }
  | { type: 'move'; ids: string[]; currentFolderId?: string | null }
  | { type: 'move-folder'; folder: Folder }
  | null;

export interface FolderUi {
  kind: FolderKind;
  folders: Folder[];
  isCollapsed: (folderId: string | null) => boolean;
  toggle: (folderId: string | null) => void;
  openCreate: (parentId?: string | null) => void;
  openRename: (folder: Folder) => void;
  openDelete: (folder: Folder, itemCount: number, subfolderCount: number) => void;
  /** Move these items; `currentFolderId` ticks their folder when they share one. */
  openMove: (ids: string[], currentFolderId?: string | null) => void;
  /** Put a folder (with everything inside it) into another folder or at the top level. */
  openMoveFolder: (folder: Folder) => void;
  /** Render once on the page. */
  sheets: ReactNode;
}

/**
 * Everything a page needs for folders of one kind: the live folder list, collapsed
 * state, and the create / rename / delete / move sheets. `onChanged` runs after any
 * change that moved items (pages with a server-backed list refetch there);
 * `onToast` shows "Moved 3 decks to HSK 2".
 */
export function useFolderUi(kind: FolderKind, { onChanged, onToast }: { onChanged?: () => void; onToast?: (msg: string) => void } = {}): FolderUi {
  const folders = useFolders(kind);
  const { isCollapsed, toggle } = useCollapsedFolders(kind);
  const [sheet, setSheet] = useState<SheetState>(null);
  const close = () => setSheet(null);
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const justCreated = useRef<Folder | null>(null);

  let sheets: ReactNode = null;
  if (sheet?.type === 'create' || sheet?.type === 'rename') {
    sheets = (
      <FolderNameSheet
        kind={kind}
        folders={folders}
        mode={sheet.type}
        initial={sheet.type === 'rename' ? sheet.folder.name : ''}
        initialParent={sheet.type === 'create' ? sheet.parentId : null}
        onClose={close}
        onSave={async (name, parentId) => {
          if (sheet.type === 'rename') {
            await renameFolder(sheet.folder.id, name);
            track('folder.rename', { kind });
          } else {
            await createFolder(kind, name, parentId);
            track('folder.create', { kind, nested: !!parentId });
          }
          close();
        }}
      />
    );
  } else if (sheet?.type === 'delete') {
    sheets = (
      <DeleteFolderSheet
        kind={kind}
        folder={sheet.folder}
        itemCount={sheet.itemCount}
        subfolderCount={sheet.subfolderCount}
        parentName={sheet.folder.parent_id ? byId.get(sheet.folder.parent_id)?.name ?? null : null}
        onClose={close}
        onConfirm={async () => {
          await deleteFolder(sheet.folder);
          track('folder.delete', { kind, items: sheet.itemCount });
          close();
          onChanged?.();
        }}
      />
    );
  } else if (sheet?.type === 'move') {
    sheets = (
      <MoveToFolderSheet
        kind={kind}
        folders={folders}
        count={sheet.ids.length}
        currentFolderId={sheet.currentFolderId}
        onClose={close}
        onCreate={async (name, parentId) => {
          const folder = await createFolder(kind, name, parentId);
          track('folder.create', { kind, nested: !!parentId });
          justCreated.current = folder;
          return folder;
        }}
        onMove={async (folderId) => {
          const moved = await moveItemsToFolder(kind, sheet.ids, folderId);
          track('folder.move_items', { kind, count: moved || sheet.ids.length, unfiled: !folderId });
          close();
          onChanged?.();
          const name = folderId ? (byId.get(folderId) ?? (justCreated.current?.id === folderId ? justCreated.current : null))?.name ?? null : null;
          onToast?.(movedMessage(kind, moved || sheet.ids.length, name));
        }}
      />
    );
  } else if (sheet?.type === 'move-folder') {
    sheets = (
      <MoveFolderSheet
        kind={kind}
        folders={folders}
        folder={sheet.folder}
        onClose={close}
        onMove={async (parentId) => {
          await moveFolder(sheet.folder.id, parentId);
          const parent = parentId ? byId.get(parentId) : undefined;
          track('folder.move_folder', { kind, depth: parent ? folderLevel(parent, folders) : 0 });
          close();
          onToast?.(`Moved “${sheet.folder.name}” to ${parent ? parent.name : 'the top level'}`);
        }}
      />
    );
  }

  return {
    kind,
    folders,
    isCollapsed,
    toggle,
    openCreate: (parentId = null) => setSheet({ type: 'create', parentId }),
    openRename: (folder) => setSheet({ type: 'rename', folder }),
    openDelete: (folder, itemCount, subfolderCount) => setSheet({ type: 'delete', folder, itemCount, subfolderCount }),
    openMove: (ids, currentFolderId) => setSheet({ type: 'move', ids, currentFolderId }),
    openMoveFolder: (folder) => setSheet({ type: 'move-folder', folder }),
    sheets,
  };
}

function FolderMenu({ ui, group }: { ui: FolderUi; group: FolderGroup<unknown> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const folder = group.folder!;
  // A folder at the deepest level can't hold another (MAX_FOLDER_DEPTH levels).
  const canNest = group.depth + 1 < MAX_FOLDER_DEPTH;
  const items: Array<[string, string, () => void, boolean?]> = [
    ['rename', '✏️ Rename…', () => ui.openRename(folder)],
    ...(canNest ? [['sub', '📁 New folder inside…', () => ui.openCreate(folder.id)] as [string, string, () => void]] : []),
    ['move', '↪ Move folder…', () => ui.openMoveFolder(folder)],
    ['delete', '🗑 Delete folder…', () => ui.openDelete(folder, group.items.length, group.children.length), true],
  ];
  return (
    <span className="folder-menu-wrap" ref={ref}>
      <button
        type="button"
        className="folder-menu-btn"
        aria-label={`Folder ${folder.name} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        data-testid="folder-menu"
      >
        ⋯
      </button>
      {open && (
        <span className="folder-menu" role="menu">
          {items.map(([key, label, fn, danger]) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className={danger ? 'folder-menu-danger' : undefined}
              onClick={(e) => { e.stopPropagation(); setOpen(false); fn(); }}
              data-testid={`folder-menu-${key}`}
            >
              {label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function GroupHeader({
  ui, group, dragProps, dragging,
}: {
  ui: FolderUi;
  group: FolderGroup<unknown>;
  dragProps?: Record<string, unknown>;
  dragging?: boolean;
}) {
  const id = group.folder?.id ?? null;
  const collapsed = ui.isCollapsed(id);
  const name = group.folder?.name ?? UNFILED_LABEL;
  return (
    <div className={`folder-head${group.depth ? ' folder-head--sub' : ''}${dragging ? ' folder-head--dragging' : ''}`} {...dragProps}>
      <button
        type="button"
        className="folder-toggle"
        onClick={() => ui.toggle(id)}
        aria-expanded={!collapsed}
        data-testid={`folder-toggle-${id ?? 'unfiled'}`}
      >
        <span className={`folder-chevron${collapsed ? '' : ' folder-chevron--open'}`} aria-hidden="true">▸</span>
        <span aria-hidden="true">{group.folder ? (collapsed ? '📁' : '📂') : '📄'}</span>
        <span className="folder-name">{name}</span>
        <span className="folder-count">{folderCountLabel(ui.kind, group.total)}</span>
      </button>
      {group.folder && <FolderMenu ui={ui} group={group} />}
    </div>
  );
}

/**
 * One level of the tree: sibling folders, each with its header, its subfolders (another
 * level, any depth) and its items. Press and hold a header to drag it among its siblings —
 * every level reorders on its own (`reorderFolders` with that level's ids).
 */
function FolderLevel<T>({
  ui, groups, depth, renderItems, emptyFolderText,
}: {
  ui: FolderUi;
  groups: FolderGroup<T>[];
  depth: number;
  renderItems: (items: T[], folder: Folder | null) => ReactNode;
  emptyFolderText: string;
}) {
  const ids = useMemo(() => groups.map((g) => g.folder!.id), [groups]);
  const drag = useLongPressReorder(
    ids,
    async (order) => {
      try {
        await reorderFolders(ui.kind, order);
      } catch (err) {
        console.error('[Folders] reorder failed', err);
      }
    },
    { selector: ':scope > [data-folder-id]' },
  );
  const byId = new Map(groups.map((g) => [g.folder!.id, g]));
  const ordered = drag.order.map((id) => byId.get(id)).filter((g): g is FolderGroup<T> => !!g);
  return (
    <div ref={drag.listRef} className={depth === 0 ? 'folder-groups-list' : 'folder-subgroups'}>
      {ordered.map((group) => {
        const id = group.folder!.id;
        return (
          <div
            key={id}
            className={`folder-group${depth ? ' folder-group--sub' : ''}`}
            data-folder-id={id}
            data-depth={depth}
            data-testid="folder-group"
          >
            <GroupHeader
              ui={ui}
              group={group as FolderGroup<unknown>}
              dragProps={drag.cardProps(id) as unknown as Record<string, unknown>}
              dragging={drag.dragId === id}
            />
            {!ui.isCollapsed(id) && (
              <div className="folder-body">
                {group.children.length > 0 && (
                  <FolderLevel ui={ui} groups={group.children} depth={depth + 1} renderItems={renderItems} emptyFolderText={emptyFolderText} />
                )}
                {group.items.length > 0
                  ? renderItems(group.items, group.folder)
                  : group.children.length > 0
                    ? null
                    : <p className="folder-empty">{emptyFolderText}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FolderGroups<T>({
  ui,
  items,
  folderIdOf,
  renderItems,
  flat = false,
  emptyFolderText = 'Empty — move something here from its ⋯ menu.',
}: {
  ui: FolderUi;
  items: T[];
  folderIdOf: (item: T) => string | null | undefined;
  /** The items of one group (in the order given), e.g. a deck grid. */
  renderItems: (items: T[], folder: Folder | null) => ReactNode;
  flat?: boolean;
  emptyFolderText?: string;
}) {
  const { groups, unfiled } = useMemo(() => groupIntoFolders(items, folderIdOf, ui.folders, ui.kind), [items, folderIdOf, ui.folders, ui.kind]);

  if (flat || groups.length === 0) return <>{renderItems(items, null)}</>;

  return (
    <div className="folder-groups" data-testid="folder-groups">
      <FolderLevel ui={ui} groups={groups} depth={0} renderItems={renderItems} emptyFolderText={emptyFolderText} />
      {unfiled.items.length > 0 && (
        <div className="folder-group folder-group--unfiled" data-testid="folder-group-unfiled">
          <GroupHeader ui={ui} group={unfiled as FolderGroup<unknown>} />
          {!ui.isCollapsed(null) && <div className="folder-body">{renderItems(unfiled.items, null)}</div>}
        </div>
      )}
    </div>
  );
}

/** Multi-select bar: "3 selected · Move to folder… · Cancel". */
export function SelectionBar({ count, onMove, onCancel, kindLabel }: { count: number; onMove: () => void; onCancel: () => void; kindLabel: string }) {
  return (
    <div className="folder-select-bar" role="toolbar" aria-label="Selection" data-testid="folder-select-bar">
      <span>{count === 0 ? `Tap ${kindLabel} to select them` : `${count} selected`}</span>
      <span className="folder-select-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={count === 0} onClick={onMove} data-testid="folder-select-move">Move to folder…</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </span>
    </div>
  );
}

/** "＋ Folder" and "Select" for a list's toolbar. */
export function FolderToolbar({ ui, selecting, onSelect, itemCount }: { ui: FolderUi; selecting: boolean; onSelect: () => void; itemCount: number }) {
  return (
    <div className="folder-toolbar">
      <button type="button" className="folder-tool" onClick={() => ui.openCreate(null)} data-testid="new-folder">＋ Folder</button>
      {itemCount > 1 && !selecting && (
        <button type="button" className="folder-tool" onClick={onSelect} data-testid="folder-select">☑ Select</button>
      )}
    </div>
  );
}
