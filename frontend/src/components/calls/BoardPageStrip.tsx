/**
 * Board pages: the numbered thumbnail strip along the bottom of the text board
 * (shared/calls/pages.ts). Each thumbnail is a tiny sheet of paper with the
 * page's first lines, its number (or title) under it; the current page is
 * highlighted and a dot in the other person's colour marks the page they are
 * on. In a call: + adds a page, ⋯ on the current page renames / duplicates /
 * deletes it (with a confirm). Outside a call (the Lesson board page) the same
 * strip only picks a page to read.
 */

import { useEffect, useRef, useState } from 'react';
import { pageLabel, type BoardPageMeta } from '@shared/calls';
import './BoardPages.css';

export interface StripPerson {
  key: string;
  name: string;
  color: string;
  page: string;
}

interface Props {
  pages: Pick<BoardPageMeta, 'id' | 'title' | 'preview'>[];
  current: string;
  people?: StripPerson[];
  onOpen: (pageId: string) => void;
  /** In a call: page management. */
  onNew?: () => void;
  onRename?: (pageId: string, title: string | null) => void;
  onDuplicate?: (pageId: string) => void;
  onDelete?: (pageId: string) => void;
}

export function BoardPageStrip({ pages, current, people = [], onOpen, onNew, onRename, onDuplicate, onDelete }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const editable = Boolean(onRename || onDuplicate || onDelete);

  // Keep the current page in view.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-page-id="${current}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [current, pages.length]);

  const indexOf = (id: string) => pages.findIndex((p) => p.id === id);
  const labelOf = (id: string) => pageLabel(indexOf(id), pages[indexOf(id)]?.title);

  return (
    <div className="bp-strip-wrap">
      <div className="bp-strip" ref={stripRef} role="tablist" aria-label="Board pages" data-testid="board-page-strip">
        {pages.map((p, i) => {
          const here = people.filter((x) => x.page === p.id);
          const isCurrent = p.id === current;
          return (
            <div key={p.id} className={`bp-thumb-wrap${isCurrent ? ' is-current' : ''}`} data-page-id={p.id}>
              <button
                type="button"
                role="tab"
                aria-selected={isCurrent}
                className="bp-thumb"
                title={pageLabel(i, p.title)}
                data-testid="board-page-thumb"
                onClick={() => (isCurrent && editable ? setMenuFor((m) => (m === p.id ? null : p.id)) : onOpen(p.id))}
                onContextMenu={(e) => {
                  if (!editable) return;
                  e.preventDefault();
                  if (!isCurrent) onOpen(p.id);
                  setMenuFor(p.id);
                }}
              >
                <span className="bp-paper" lang="zh" aria-hidden="true">
                  {p.preview}
                </span>
                {here.map((x) => (
                  <span key={x.key} className="bp-person" style={{ background: x.color }} title={`${x.name} is here`} aria-label={`${x.name} is here`} />
                ))}
              </button>
              <span className="bp-num">{p.title ? p.title : i + 1}</span>
              {isCurrent && editable && (
                <button
                  type="button"
                  className="bp-more"
                  aria-label={`${pageLabel(i, p.title)} options`}
                  data-testid="board-page-more"
                  onClick={() => setMenuFor((m) => (m === p.id ? null : p.id))}
                >
                  ⋯
                </button>
              )}
            </div>
          );
        })}
        {onNew && (
          <div className="bp-thumb-wrap">
            <button type="button" className="bp-thumb bp-add" aria-label="New page" title="New page" data-testid="board-page-new" onClick={onNew}>
              +
            </button>
            <span className="bp-num">&nbsp;</span>
          </div>
        )}
      </div>

      {menuFor && indexOf(menuFor) >= 0 && (
        <div className="bp-menu" role="menu" data-testid="board-page-menu">
          <div className="bp-menu-title">{labelOf(menuFor)}</div>
          {onRename && (
            <button type="button" role="menuitem" onClick={() => (setRenaming({ id: menuFor, value: pages[indexOf(menuFor)].title ?? '' }), setMenuFor(null))}>
              Rename
            </button>
          )}
          {onDuplicate && (
            <button type="button" role="menuitem" onClick={() => (onDuplicate(menuFor), setMenuFor(null))}>
              Duplicate
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              className="bp-danger"
              disabled={pages.length <= 1}
              title={pages.length <= 1 ? 'The only page can’t be deleted' : undefined}
              onClick={() => (setConfirmDelete(menuFor), setMenuFor(null))}
            >
              Delete…
            </button>
          )}
          <button type="button" role="menuitem" className="bp-menu-close" onClick={() => setMenuFor(null)}>
            Close
          </button>
        </div>
      )}

      {renaming && (
        <form
          className="bp-dialog"
          role="dialog"
          aria-label="Rename page"
          onSubmit={(e) => {
            e.preventDefault();
            onRename?.(renaming.id, renaming.value.trim() || null);
            setRenaming(null);
          }}
        >
          <label>
            Page name
            <input
              autoFocus
              value={renaming.value}
              maxLength={60}
              placeholder={`Page ${indexOf(renaming.id) + 1}`}
              data-testid="board-page-title"
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            />
          </label>
          <div className="bp-dialog-actions">
            <button type="button" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button type="submit" className="bp-primary">
              Save
            </button>
          </div>
        </form>
      )}

      {confirmDelete && indexOf(confirmDelete) >= 0 && (
        <div className="bp-dialog" role="alertdialog" aria-label="Delete page">
          <p>
            Delete {labelOf(confirmDelete).replace(/^Page/, 'page')}? Its text is removed for both of you.
          </p>
          <div className="bp-dialog-actions">
            <button type="button" onClick={() => setConfirmDelete(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="bp-danger-btn"
              data-testid="board-page-delete-confirm"
              onClick={() => {
                onDelete?.(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
