/**
 * The folder sheets shared by the Decks list, the Library and the Readers list:
 * name a folder (new / rename), move items to a folder, confirm a delete.
 */
import { useState } from 'react';
import {
  cleanFolderName,
  deleteFolderMessage,
  folderDescendantIds,
  folderNameProblems,
  folderOptions,
  folderItemNoun,
  folderPath,
  parentProblem,
  FOLDER_NAME_MAX,
  MAX_FOLDER_DEPTH,
  UNFILED_LABEL,
  type Folder,
  type FolderKind,
} from '@shared/folders';
import './folders.css';

function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <div className="folder-sheet-overlay" onClick={onClose}>
      <div className="folder-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="folder-sheet-head">
          <span>{title}</span>
          <button type="button" className="folder-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="folder-sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** New folder (with an optional "Inside" choice) or rename. */
export function FolderNameSheet({
  kind,
  folders,
  initial = '',
  initialParent = null,
  mode,
  onClose,
  onSave,
}: {
  kind: FolderKind;
  folders: Folder[];
  initial?: string;
  initialParent?: string | null;
  mode: 'create' | 'rename';
  onClose: () => void;
  onSave: (name: string, parentId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [parent, setParent] = useState<string | null>(initialParent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Any folder that can still hold another (MAX_FOLDER_DEPTH levels), shown with its path.
  const parents = nestableOptions(folders, kind);

  async function save() {
    const problems = folderNameProblems(name);
    if (problems.length) {
      setError(problems[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(cleanFolderName(name), parent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the folder');
      setBusy(false);
    }
  }

  return (
    <Sheet title={mode === 'create' ? 'New folder' : 'Rename folder'} onClose={onClose} testId="folder-name-sheet">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="folder-field">
          <span>Name</span>
          <input
            className="form-input"
            value={name}
            maxLength={FOLDER_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'deck' ? 'e.g. HSK 2' : kind === 'lesson' ? 'e.g. Grammar' : 'e.g. Short stories'}
            autoFocus
            data-testid="folder-name-input"
          />
        </label>
        {mode === 'create' && parents.length > 0 && (
          <InsidePicker folders={folders} options={parents} value={parent} onChange={setParent} />
        )}
        {error && <p className="folder-error" role="alert">{error}</p>}
        <div className="folder-sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()} data-testid="folder-name-save">
            {busy ? 'Saving…' : mode === 'create' ? 'Create folder' : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Folders that can hold one more level, in tree order (for "Inside" pickers). */
function nestableOptions(folders: Folder[], kind: FolderKind) {
  return folderOptions(folders, kind).filter((o) => o.depth + 1 < MAX_FOLDER_DEPTH);
}

/** "Inside: Top level / HSK 2 / HSK 2 › Week 1 …" — a select labelled with each folder's path. */
function InsidePicker({ folders, options, value, onChange }: {
  folders: Folder[];
  options: Array<{ folder: Folder; depth: number }>;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <label className="folder-field">
      <span>Inside</span>
      <select className="form-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} data-testid="folder-inside-select">
        <option value="">Top level</option>
        {options.map((o) => <option key={o.folder.id} value={o.folder.id}>{folderPath(o.folder, folders)}</option>)}
      </select>
    </label>
  );
}

/** One row of a folder tree picker: indented by depth, the path as its tooltip. */
function TreeRow({ id, label, path, depth, icon, current, disabled, hint, onPick }: {
  id: string | null; label: string; path?: string; depth: number; icon: string; current: boolean; disabled: boolean; hint?: string | null; onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`folder-option${current ? ' folder-option--current' : ''}`}
      style={{ paddingLeft: `${0.875 + depth * 1.125}rem` }}
      onClick={onPick}
      disabled={disabled}
      title={hint ?? path}
      data-testid={`move-to-${id ?? 'unfiled'}`}
      data-depth={depth}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="folder-option-name">{label}</span>
      {hint && <span className="folder-option-hint">{hint}</span>}
      {current && <span className="folder-option-tick" aria-label="current">✓</span>}
    </button>
  );
}

/** "Now in HSK 2 › Week 1" above a picker. */
function Breadcrumb({ folder, folders }: { folder: Folder | null; folders: Folder[] }) {
  return (
    <p className="folder-breadcrumb" data-testid="folder-breadcrumb">
      Now in <strong>{folder ? folderPath(folder, folders) : UNFILED_LABEL}</strong>
    </p>
  );
}

/** Pick a folder for one or more items (the tree, indented); "＋ New folder" creates one (anywhere) and moves there. */
export function MoveToFolderSheet({
  kind,
  folders,
  count,
  currentFolderId,
  onClose,
  onMove,
  onCreate,
}: {
  kind: FolderKind;
  folders: Folder[];
  /** How many items are moving (for the title). */
  count: number;
  /** The items' folder when they all share one (ticked); undefined when mixed. */
  currentFolderId?: string | null;
  onClose: () => void;
  onMove: (folderId: string | null) => Promise<void>;
  /** Make a folder (inside `parentId`, null = top level) to move into. */
  onCreate: (name: string, parentId: string | null) => Promise<Folder>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string | null>(null);
  const options = folderOptions(folders, kind);
  const current = currentFolderId ? folders.find((f) => f.id === currentFolderId) ?? null : null;

  async function pick(folderId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await onMove(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move');
      setBusy(false);
    }
  }

  async function createAndMove() {
    const problems = folderNameProblems(newName);
    if (problems.length) {
      setError(problems[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const folder = await onCreate(cleanFolderName(newName), newParent);
      await onMove(folder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the folder');
      setBusy(false);
    }
  }

  const isCurrent = (id: string | null) => currentFolderId !== undefined && (currentFolderId ?? null) === id;

  return (
    <Sheet title={count === 1 ? `Move ${folderItemNoun(kind, 1)} to folder` : `Move ${count} ${folderItemNoun(kind, count)} to folder`} onClose={onClose} testId="move-to-folder-sheet">
      {currentFolderId !== undefined && <Breadcrumb folder={current} folders={folders} />}
      <div className="folder-options">
        {options.map((o) => (
          <TreeRow
            key={o.folder.id}
            id={o.folder.id}
            label={o.folder.name}
            path={folderPath(o.folder, folders)}
            depth={o.depth}
            icon={o.depth ? '↳' : '📁'}
            current={isCurrent(o.folder.id)}
            disabled={busy}
            onPick={() => void pick(o.folder.id)}
          />
        ))}
        <TreeRow id={null} label={UNFILED_LABEL} depth={0} icon="📄" current={isCurrent(null)} disabled={busy} onPick={() => void pick(null)} />
      </div>
      {creating ? (
        <form className="folder-new-form" onSubmit={(e) => { e.preventDefault(); void createAndMove(); }}>
          <div className="folder-new-inline">
            <input
              className="form-input"
              value={newName}
              maxLength={FOLDER_NAME_MAX}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Folder name"
              autoFocus
              data-testid="move-new-folder-name"
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !newName.trim()}>Create &amp; move</button>
          </div>
          {nestableOptions(folders, kind).length > 0 && (
            <InsidePicker folders={folders} options={nestableOptions(folders, kind)} value={newParent} onChange={setNewParent} />
          )}
        </form>
      ) : (
        <button type="button" className="folder-option folder-option--new" onClick={() => setCreating(true)} disabled={busy} data-testid="move-new-folder">
          <span aria-hidden="true">＋</span>
          <span className="folder-option-name">New folder</span>
        </button>
      )}
      {error && <p className="folder-error" role="alert">{error}</p>}
    </Sheet>
  );
}

/**
 * Move a folder (with everything inside it) into another folder or to the top level. The
 * folder itself, its own subfolders and places too deep for it are shown but can't be picked.
 */
export function MoveFolderSheet({
  kind,
  folders,
  folder,
  onClose,
  onMove,
}: {
  kind: FolderKind;
  folders: Folder[];
  folder: Folder;
  onClose: () => void;
  onMove: (parentId: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inside = new Set([folder.id, ...folderDescendantIds(folder.id, folders)]);
  const options = folderOptions(folders, kind).filter((o) => !inside.has(o.folder.id));
  const parent = folder.parent_id ? folders.find((f) => f.id === folder.parent_id) ?? null : null;

  async function pick(parentId: string | null) {
    if ((folder.parent_id ?? null) === parentId) return onClose();
    setBusy(true);
    setError(null);
    try {
      await onMove(parentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the folder');
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Move folder “${folder.name}”`} onClose={onClose} testId="move-folder-sheet">
      <p className="folder-breadcrumb" data-testid="folder-breadcrumb">
        Now in <strong>{parent ? folderPath(parent, folders) : 'the top level'}</strong>
      </p>
      <div className="folder-options">
        <TreeRow id={null} label="Top level" depth={0} icon="🏠" current={!folder.parent_id} disabled={busy} onPick={() => void pick(null)} />
        {options.map((o) => {
          const problem = parentProblem({ id: folder.id, kind }, o.folder.id, folders);
          return (
            <TreeRow
              key={o.folder.id}
              id={o.folder.id}
              label={o.folder.name}
              path={folderPath(o.folder, folders)}
              depth={o.depth + 1}
              icon={o.depth ? '↳' : '📁'}
              current={folder.parent_id === o.folder.id}
              disabled={busy || !!problem}
              hint={problem ? 'Too deep' : null}
              onPick={() => void pick(o.folder.id)}
            />
          );
        })}
      </div>
      {error && <p className="folder-error" role="alert">{error}</p>}
    </Sheet>
  );
}

export function DeleteFolderSheet({
  kind,
  folder,
  itemCount,
  subfolderCount,
  parentName = null,
  onClose,
  onConfirm,
}: {
  kind: FolderKind;
  folder: Folder;
  itemCount: number;
  subfolderCount: number;
  /** Where its subfolders move up to (null = the top level). */
  parentName?: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={`Delete folder “${folder.name}”?`} onClose={onClose} testId="delete-folder-sheet">
      <p className="folder-sheet-text">{deleteFolderMessage(kind, folder.name, itemCount, subfolderCount, parentName)}</p>
      {error && <p className="folder-error" role="alert">{error}</p>}
      <div className="folder-sheet-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          data-testid="delete-folder-confirm"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not delete the folder');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Deleting…' : 'Delete folder'}
        </button>
      </div>
    </Sheet>
  );
}
