import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  LIBRARY_KIND_ICONS,
  LIBRARY_KIND_LABELS,
  LIBRARY_KINDS,
  LIBRARY_STATUSES,
  LIBRARY_STATUS_LABELS,
  dueDateChoices,
  filterLibrary,
  libraryCounts,
  libraryDueText,
  shortDay,
  type LibraryItem,
  type LibraryKind,
  type LibraryStatus,
} from '@shared/homework';
import { updateHomeworkAssignment } from '../../../api/homework';
import { listHomeworkLinks, updateStudentCopies } from '../../../api/homeworkLibrary';
import { RemoveHomeworkSheet } from '../RemoveHomeworkSheet';
import { LibrarySheet } from './LibrarySheet';
import { PercentBar, StatusChip } from './StatusChip';
import { LinkHomeworkForm, LinkCard } from './LinkHomeworkForm';
import { UpdateCopiesPrompt } from './UpdateCopiesSheet';
import './homework-library.css';

/** Where the tutor's own copy opens / is edited. Null = nothing to open (source gone). */
export function libraryOpenPath(item: Pick<LibraryItem, 'kind' | 'source_id'>, edit = false): string | null {
  if (!item.source_id) return null;
  if (item.kind === 'deck') return `/decks/${item.source_id}`;
  if (item.kind === 'lesson') return edit ? `/library/${item.source_id}/edit` : `/library/${item.source_id}`;
  if (item.kind === 'reader') return edit ? `/readers/${item.source_id}/edit` : `/readers/${item.source_id}`;
  return null;
}

function sentText(iso: string): string {
  return `Sent ${shortDay(iso.slice(0, 10))}`;
}

/** One library row: icon, title (+ student), sent · due, % bar, status chip. */
export function LibraryRow({ item, today, showStudent, onOpen }: { item: LibraryItem; today: string; showStudent: boolean; onOpen: (item: LibraryItem) => void }) {
  return (
    <button type="button" className="hl-row" onClick={() => onOpen(item)} data-testid="hl-row" data-kind={item.kind}>
      <span className="hl-row-icon" aria-hidden="true">{LIBRARY_KIND_ICONS[item.kind]}</span>
      <span className="hl-row-main">
        <span className="hl-row-title" lang="zh">{item.title}</span>
        <span className="hl-row-meta">
          {showStudent ? `${item.student_name} · ` : ''}
          {sentText(item.sent_at)} · {item.status === 'completed' ? item.progress : libraryDueText(item.due_date, today)}
        </span>
        <span className="hl-row-progress">
          <PercentBar percent={item.percent} status={item.status} due={item.due_date} today={today} />
          <span className="hl-row-pct">{item.percent}%</span>
        </span>
        {item.student_note && <span className="hl-row-note">“{item.student_note}”</span>}
      </span>
      <StatusChip status={item.status} due={item.due_date} today={today} />
    </button>
  );
}

type Sheet =
  | { kind: 'actions'; item: LibraryItem }
  | { kind: 'due'; item: LibraryItem }
  | { kind: 'remove'; item: LibraryItem }
  | { kind: 'edit-link'; item: LibraryItem }
  | { kind: 'copies'; item: LibraryItem };

/**
 * The homework library list (docs/HOMEWORK.md §9): status + kind filters,
 * rows, and per row Open · Edit · Update their copy · Change due date · Remove.
 */
export function HomeworkLibraryList({ items, today, showStudent, onChanged }: { items: LibraryItem[]; today: string; showStudent: boolean; onChanged: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [kind, setKind] = useState<LibraryKind | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => libraryCounts(items), [items]);
  const kinds = useMemo(() => LIBRARY_KINDS.filter((k) => items.some((i) => i.kind === k)), [items]);
  const shown = filterLibrary(items, { status, kind });

  const close = () => setSheet(null);
  const done = (text: string) => {
    setNotice(text);
    setSheet(null);
    queryClient.invalidateQueries({ queryKey: ['homework-library'] });
    queryClient.invalidateQueries({ queryKey: ['relationship-homework'] });
    onChanged();
  };

  const updateCopy = async (item: LibraryItem) => {
    if (!item.source_id) return;
    setBusy(true);
    try {
      const res = await updateStudentCopies(item.kind, item.source_id, [item.relationship_id]);
      const r = res.results[0];
      done(r ? (r.ok ? `${r.student_name}'s copy: ${r.detail}` : `Couldn't update ${r.student_name}'s copy: ${r.error}`) : 'Nothing to update');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not update the copy');
    } finally {
      setBusy(false);
    }
  };

  const setDue = async (item: LibraryItem, due: string | null) => {
    if (!item.due_assignment_id) return;
    setBusy(true);
    try {
      await updateHomeworkAssignment(item.relationship_id, item.due_assignment_id, { due_date: due });
      done(due ? `${item.title} is now due ${shortDay(due)}` : `${item.title} has no due date now`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not change the date');
    } finally {
      setBusy(false);
    }
  };

  const cancelLink = async (item: LibraryItem) => {
    if (!window.confirm(`Remove "${item.title}" from ${item.student_name}'s homework?`)) return;
    setBusy(true);
    try {
      for (const id of item.assignment_ids) await updateHomeworkAssignment(item.relationship_id, id, { status: 'cancelled' });
      done(`Removed ${item.title} from ${item.student_name}'s homework`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not remove it');
    } finally {
      setBusy(false);
    }
  };

  const actions = (item: LibraryItem) => {
    const open = libraryOpenPath(item);
    const edit = libraryOpenPath(item, true);
    return (
      <LibrarySheet title={item.title} onClose={close} testId="hl-actions">
        <p className="hl-muted">
          {LIBRARY_KIND_LABELS[item.kind]} · {item.student_name} · {sentText(item.sent_at)} · {libraryDueText(item.due_date, today)} · {item.progress}
        </p>
        {item.kind === 'link' && item.url && <LinkCard url={item.url} title={item.title} thumbnail={item.thumbnail_url} />}
        {item.instructions && <p className="hl-instructions">{item.instructions}</p>}
        {item.student_note && <p className="hl-row-note">{item.student_name}: “{item.student_note}”</p>}
        <div className="hl-actions">
          {item.kind === 'link' && item.url ? (
            <a className="td-option" href={item.url} target="_blank" rel="noopener noreferrer">Open link ↗</a>
          ) : (
            open && <button type="button" className="td-option" onClick={() => navigate(open)}>Open</button>
          )}
          {item.kind === 'link'
            ? item.source_id && <button type="button" className="td-option" onClick={() => setSheet({ kind: 'edit-link', item })}>Edit link</button>
            : edit && <button type="button" className="td-option" onClick={() => navigate(edit)}>Edit</button>}
          {item.source_id && (
            <button type="button" className="td-option" disabled={busy} onClick={() => void updateCopy(item)} data-testid="hl-update-copy">
              Update {item.student_name}'s copy{item.behind > 0 ? ` (+${item.behind} new ${item.behind === 1 ? 'word' : 'words'})` : ''}
            </button>
          )}
          {item.due_assignment_id && (
            <button type="button" className="td-option" onClick={() => setSheet({ kind: 'due', item })} data-testid="hl-change-due">Change due date</button>
          )}
          <button
            type="button"
            className="td-option hl-danger"
            disabled={busy}
            onClick={() => (item.kind === 'link' ? void cancelLink(item) : setSheet({ kind: 'remove', item }))}
          >
            Remove from {item.student_name}'s homework
          </button>
        </div>
      </LibrarySheet>
    );
  };

  return (
    <div className="hl-list" data-testid="homework-library">
      <div className="hl-filters" role="group" aria-label="Filter by status">
        <button type="button" className={`hl-filter${status === null ? ' active' : ''}`} onClick={() => setStatus(null)}>All {items.length}</button>
        {LIBRARY_STATUSES.filter((s) => counts[s] > 0 || status === s).map((s) => (
          <button key={s} type="button" className={`hl-filter hl-filter-${s}${status === s ? ' active' : ''}`} onClick={() => setStatus(status === s ? null : s)} data-testid={`hl-filter-${s}`}>
            {LIBRARY_STATUS_LABELS[s]} {counts[s]}
          </button>
        ))}
      </div>
      {kinds.length > 1 && (
        <div className="hl-filters" role="group" aria-label="Filter by kind">
          {kinds.map((k) => (
            <button key={k} type="button" className={`hl-filter${kind === k ? ' active' : ''}`} onClick={() => setKind(kind === k ? null : k)}>
              {LIBRARY_KIND_ICONS[k]} {LIBRARY_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      )}
      {notice && <div className="td-result" role="status">{notice}</div>}
      {shown.length === 0 && <p className="td-muted">{items.length === 0 ? 'Nothing sent yet.' : 'Nothing matches these filters.'}</p>}
      <div className="hl-rows">
        {shown.map((item) => (
          <LibraryRow key={`${item.relationship_id}:${item.key}`} item={item} today={today} showStudent={showStudent} onOpen={(i) => { setNotice(null); setSheet({ kind: 'actions', item: i }); }} />
        ))}
      </div>

      {sheet?.kind === 'actions' && actions(sheet.item)}
      {sheet?.kind === 'due' && (
        <LibrarySheet title={`Due date · ${sheet.item.title}`} onClose={close}>
          <div className="hl-due-choices">
            {dueDateChoices(today).map((d, i) => (
              <button key={d} type="button" className="hl-filter" disabled={busy} onClick={() => void setDue(sheet.item, d)}>
                {['Today', 'Tomorrow', 'In 3 days', 'In a week'][i]} · {shortDay(d)}
              </button>
            ))}
          </div>
          <label className="hl-field">
            <span>Or pick a day</span>
            <input type="date" min={today} defaultValue={sheet.item.due_date ?? ''} onChange={(e) => e.target.value && void setDue(sheet.item, e.target.value)} data-testid="hl-due-input" />
          </label>
          {sheet.item.kind === 'link' && sheet.item.due_date && (
            <button type="button" className="btn-link" disabled={busy} onClick={() => void setDue(sheet.item, null)}>No due date</button>
          )}
        </LibrarySheet>
      )}
      {sheet?.kind === 'remove' && sheet.item.kind !== 'link' && (
        <RemoveHomeworkSheet
          relId={sheet.item.relationship_id}
          studentName={sheet.item.student_name}
          target={{ kind: sheet.item.kind, id: sheet.item.kind === 'lesson' ? sheet.item.target_id : sheet.item.share_id ?? sheet.item.target_id, title: sheet.item.title }}
          onClose={close}
          onRemoved={(toast) => done(toast)}
        />
      )}
      {sheet?.kind === 'edit-link' && (
        <EditLinkSheet item={sheet.item} onClose={close} onSaved={() => setSheet({ kind: 'copies', item: sheet.item })} />
      )}
      {sheet?.kind === 'copies' && sheet.item.source_id && (
        <UpdateCopiesPrompt kind={sheet.item.kind} sourceId={sheet.item.source_id} onDone={() => done('Link saved')} />
      )}
    </div>
  );
}

function EditLinkSheet({ item, onClose, onSaved }: { item: LibraryItem; onClose: () => void; onSaved: () => void }) {
  const [links, setLinks] = useState<Awaited<ReturnType<typeof listHomeworkLinks>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listHomeworkLinks().then(setLinks).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the link'));
  }, []);
  const link = links?.find((l) => l.id === item.source_id) ?? null;
  return (
    <LibrarySheet title="Edit link" onClose={onClose}>
      {error && <div className="td-error">{error}</div>}
      {links && !link && <p className="td-muted">This link was deleted from your links.</p>}
      {link && <LinkHomeworkForm initial={link} submitLabel="Save" onSaved={onSaved} onCancel={onClose} />}
    </LibrarySheet>
  );
}
