/**
 * The folder sheets shared by the Decks list, the Library and the Readers list:
 * name a folder (new / rename), move items to a folder, confirm a delete.
 */
import { useState } from 'react';
import {
  cleanFolderName,
  deleteFolderMessage,
  folderNameProblems,
  folderOptions,
  folderItemNoun,
  FOLDER_NAME_MAX,
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
  const tops = folderOptions(folders, kind).filter((o) => o.depth === 0);

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
        {mode === 'create' && tops.length > 0 && (
          <label className="folder-field">
            <span>Inside</span>
            <select className="form-input" value={parent ?? ''} onChange={(e) => setParent(e.target.value || null)}>
              <option value="">Top level</option>
              {tops.map((o) => <option key={o.folder.id} value={o.folder.id}>{o.folder.name}</option>)}
            </select>
          </label>
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

/** Pick a folder for one or more items; "＋ New folder" creates one and moves there. */
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
  onCreate: (name: string) => Promise<Folder>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const options = folderOptions(folders, kind);

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
      const folder = await onCreate(cleanFolderName(newName));
      await onMove(folder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the folder');
      setBusy(false);
    }
  }

  const row = (id: string | null, label: string, depth: number, icon: string) => {
    const current = currentFolderId !== undefined && (currentFolderId ?? null) === id;
    return (
      <button
        key={id ?? 'unfiled'}
        type="button"
        className={`folder-option${current ? ' folder-option--current' : ''}`}
        style={{ paddingLeft: `${0.875 + depth * 1.25}rem` }}
        onClick={() => void pick(id)}
        disabled={busy}
        data-testid={`move-to-${id ?? 'unfiled'}`}
      >
        <span aria-hidden="true">{icon}</span>
        <span className="folder-option-name">{label}</span>
        {current && <span className="folder-option-tick" aria-label="current">✓</span>}
      </button>
    );
  };

  return (
    <Sheet title={count === 1 ? `Move ${folderItemNoun(kind, 1)} to folder` : `Move ${count} ${folderItemNoun(kind, count)} to folder`} onClose={onClose} testId="move-to-folder-sheet">
      <div className="folder-options">
        {options.map((o) => row(o.folder.id, o.folder.name, o.depth, o.depth ? '↳' : '📁'))}
        {row(null, UNFILED_LABEL, 0, '📄')}
      </div>
      {creating ? (
        <form className="folder-new-inline" onSubmit={(e) => { e.preventDefault(); void createAndMove(); }}>
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

export function DeleteFolderSheet({
  kind,
  folder,
  itemCount,
  subfolderCount,
  onClose,
  onConfirm,
}: {
  kind: FolderKind;
  folder: Folder;
  itemCount: number;
  subfolderCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={`Delete folder “${folder.name}”?`} onClose={onClose} testId="delete-folder-sheet">
      <p className="folder-sheet-text">{deleteFolderMessage(kind, folder.name, itemCount, subfolderCount)}</p>
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
