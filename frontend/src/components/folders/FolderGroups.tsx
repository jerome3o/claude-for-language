/**
 * Items shown in collapsible folder groups (shared/folders `groupIntoFolders`): each
 * top-level folder with its subfolders, then Unfiled. Used by the Decks list, the
 * Library and the Readers list; each page renders its own items per group.
 *
 * - Collapsed groups are remembered per device (`useCollapsedFolders`).
 * - Press and hold a top-level folder's header to drag it to a new place.
 * - With no folders of this kind the items render as before (no Unfiled header).
 * - `flat` (searching): one plain list, nothing hidden in a collapsed folder.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  folderCountLabel,
  groupIntoFolders,
  movedMessage,
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
  moveItemsToFolder,
  renameFolder,
  reorderFolders,
  useCollapsedFolders,
  useFolders,
} from '../../services/folders';
import { DeleteFolderSheet, FolderNameSheet, MoveToFolderSheet } from './FolderSheets';
import './folders.css';

type SheetState =
  | { type: 'create'; parentId: string | null }
  | { type: 'rename'; folder: Folder }
  | { type: 'delete'; folder: Folder; itemCount: number; subfolderCount: number }
  | { type: 'move'; ids: string[]; currentFolderId?: string | null }
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
        onCreate={async (name) => {
          const folder = await createFolder(kind, name);
          track('folder.create', { kind, nested: false });
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
    sheets,
  };
}

function FolderMenu({ ui, group, isTop }: { ui: FolderUi; group: FolderGroup<unknown>; isTop: boolean }) {
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
  const items: Array<[string, string, () => void, boolean?]> = [
    ['rename', '✏️ Rename…', () => ui.openRename(folder)],
    ...(isTop ? [['sub', '📁 New folder inside…', () => ui.openCreate(folder.id)] as [string, string, () => void]] : []),
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
  ui, group, depth, dragProps, dragging,
}: {
  ui: FolderUi;
  group: FolderGroup<unknown>;
  depth: 0 | 1;
  dragProps?: Record<string, unknown>;
  dragging?: boolean;
}) {
  const id = group.folder?.id ?? null;
  const collapsed = ui.isCollapsed(id);
  const name = group.folder?.name ?? UNFILED_LABEL;
  return (
    <div className={`folder-head${depth ? ' folder-head--sub' : ''}${dragging ? ' folder-head--dragging' : ''}`} {...dragProps}>
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
      {group.folder && <FolderMenu ui={ui} group={group} isTop={depth === 0} />}
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
  const topIds = useMemo(() => groups.map((g) => g.folder!.id), [groups]);
  const drag = useLongPressReorder(
    topIds,
    async (ids) => {
      try {
        await reorderFolders(ui.kind, ids);
      } catch (err) {
        console.error('[Folders] reorder failed', err);
      }
    },
    { selector: ':scope > [data-folder-id]' },
  );

  if (flat || groups.length === 0) return <>{renderItems(items, null)}</>;

  const byId = new Map(groups.map((g) => [g.folder!.id, g]));
  const ordered = drag.order.map((id) => byId.get(id)).filter((g): g is FolderGroup<T> => !!g);

  const body = (group: FolderGroup<T>, depth: 0 | 1) => {
    if (ui.isCollapsed(group.folder?.id ?? null)) return null;
    return (
      <div className="folder-body">
        {group.children.map((child) => (
          <div key={child.folder!.id} className="folder-group folder-group--sub" data-testid="folder-group">
            <GroupHeader ui={ui} group={child as FolderGroup<unknown>} depth={1} />
            {body(child, 1)}
          </div>
        ))}
        {group.items.length > 0
          ? renderItems(group.items, group.folder)
          : depth === 0 && group.children.length > 0
            ? null
            : <p className="folder-empty">{group.folder ? emptyFolderText : 'Everything is in a folder.'}</p>}
      </div>
    );
  };

  return (
    <div className="folder-groups" data-testid="folder-groups">
      <div ref={drag.listRef} className="folder-groups-list">
        {ordered.map((group) => (
          <div key={group.folder!.id} className="folder-group" data-folder-id={group.folder!.id} data-testid="folder-group">
            <GroupHeader
              ui={ui}
              group={group as FolderGroup<unknown>}
              depth={0}
              dragProps={drag.cardProps(group.folder!.id) as unknown as Record<string, unknown>}
              dragging={drag.dragId === group.folder!.id}
            />
            {body(group, 0)}
          </div>
        ))}
      </div>
      {unfiled.items.length > 0 && (
        <div className="folder-group folder-group--unfiled" data-testid="folder-group-unfiled">
          <GroupHeader ui={ui} group={unfiled as FolderGroup<unknown>} depth={0} />
          {body(unfiled, 0)}
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
