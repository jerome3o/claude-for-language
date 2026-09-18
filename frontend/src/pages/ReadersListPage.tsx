import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { getGradedReaders, deleteGradedReader, retryGradedReader } from '../api/client';
import { importReader } from '../api/readerEditor';
import { LessonApiError } from '../api/lessonEditor';
import { Loading, EmptyState } from '../components/Loading';
import { AnkiExportButton } from '../components/export/AnkiExportModal';
import { Toast, useToast } from '../components/Toast';
import { GradedReader, DifficultyLevel } from '../types';
import { partitionReaders, friendlyReaderError, failedReadersLabel } from '../services/readerFailures';
import './ReadersListPage.css';

/** Page-level ⋯ menu: Import JSON (a reader exported from the editor). */
function ReadersOverflowMenu({ onImport }: { onImport: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button className="btn btn-secondary" onClick={() => setOpen(o => !o)} aria-label="More actions" aria-haspopup="menu" aria-expanded={open} style={{ padding: '0.5rem 0.75rem' }}>
        ⋯
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: '200px', zIndex: 20, padding: '0.25rem' }}>
          <button role="menuitem" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start', border: 'none', background: 'transparent' }} onClick={() => { setOpen(false); fileRef.current?.click(); }}>
            ⬆ Import JSON
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onImport(file);
        }}
      />
    </div>
  );
}

const DIFFICULTY_COLORS: Record<DifficultyLevel, { bg: string; text: string; label: string }> = {
  beginner: { bg: '#dcfce7', text: '#166534', label: 'Beginner' },
  elementary: { bg: '#dbeafe', text: '#1e40af', label: 'Elementary' },
  intermediate: { bg: '#fef3c7', text: '#92400e', label: 'Intermediate' },
  advanced: { bg: '#fce7f3', text: '#9d174d', label: 'Advanced' },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

function ReaderCard({ reader, onDelete }: { reader: GradedReader; onDelete: () => void }) {
  const navigate = useNavigate();
  const difficultyStyle = DIFFICULTY_COLORS[reader.difficulty_level];
  const isGenerating = reader.status === 'generating';

  const handleClick = () => {
    if (!isGenerating) navigate(`/readers/${reader.id}`);
  };

  return (
    <div
      className="card"
      style={{
        padding: '1rem',
        opacity: isGenerating ? 0.8 : 1,
        position: 'relative',
      }}
    >
      <div
        onClick={handleClick}
        style={{ cursor: isGenerating ? 'default' : 'pointer' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>
              {isGenerating ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="spinner" style={{ width: '18px', height: '18px' }} />
                  {reader.title_chinese}
                </span>
              ) : (
                reader.title_chinese
              )}
            </h3>
          </div>
          <span
            style={{
              padding: '0.125rem 0.5rem',
              borderRadius: '1rem',
              fontSize: '0.75rem',
              backgroundColor: difficultyStyle.bg,
              color: difficultyStyle.text,
              fontWeight: 500,
            }}
          >
            {difficultyStyle.label}
          </span>
        </div>
        <p style={{ color: '#6b7280', margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>
          {reader.title_english}
        </p>
        {reader.topic && (
          <p style={{ color: '#9ca3af', margin: '0 0 0.5rem 0', fontSize: '0.75rem' }}>
            Topic: {reader.topic}
          </p>
        )}
        {isGenerating ? (
          <p style={{ color: '#3b82f6', margin: 0, fontSize: '0.75rem', fontStyle: 'italic' }}>
            Generating story and illustrations...
          </p>
        ) : (
          <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.75rem' }}>
            {reader.vocabulary_used.length} vocabulary items &middot; {formatDate(reader.created_at)}
          </p>
        )}
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '0.75rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid #e5e7eb'
      }}>
        {isGenerating ? (
          <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
            Generating...
          </span>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleClick}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              Read
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={(e) => { e.stopPropagation(); navigate(`/readers/${reader.id}/edit`); }}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              Edit
            </button>
            <AnkiExportButton
              target={{ kind: 'reader', readerId: reader.id, title: reader.title_chinese }}
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              ⬇ Anki
            </AnkiExportButton>
          </div>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', color: '#dc2626' }}
        >
          {isGenerating ? 'Cancel' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

/** What to call a failed reader: most are the daily "生成中…" placeholder. */
function failedReaderTitle(reader: GradedReader): string {
  const placeholder = reader.title_chinese === '生成中...' || reader.title_chinese === '生成中…';
  if (!placeholder) return `${reader.title_chinese} · ${reader.title_english}`;
  if (reader.topic) return `Story about: ${reader.topic}`;
  if (/today/i.test(reader.title_english)) return "Today's story";
  return reader.title_english.replace(/\.\.\.$|…$/, '') || 'Story';
}

/**
 * Every failed generation folded into ONE muted row at the bottom of the
 * list. Expanded: a friendly reason per row, Retry, Delete, the raw error
 * behind "Show details", and Delete all failed.
 */
function FailedReadersRow({
  readers,
  onRetry,
  onDelete,
  onDeleteAll,
  busyIds,
  deletingAll,
}: {
  readers: GradedReader[];
  onRetry: (reader: GradedReader) => void;
  onDelete: (reader: GradedReader) => void;
  onDeleteAll: () => void;
  busyIds: Set<string>;
  deletingAll: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [detailsFor, setDetailsFor] = useState<Set<string>>(new Set());

  const toggleDetails = (id: string) => {
    setDetailsFor(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`failed-readers${open ? ' open' : ''}`}>
      <button
        type="button"
        className="failed-readers-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span>{failedReadersLabel(readers.length)}</span>
        <span className="failed-readers-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="failed-readers-body">
          <p className="failed-readers-hint">
            These stories couldn't be written. Retry one, or clear them all — nothing here affects your study queue.
          </p>
          <ul className="failed-readers-list">
            {readers.map(reader => {
              const busy = busyIds.has(reader.id) || deletingAll;
              const showDetails = detailsFor.has(reader.id);
              return (
                <li key={reader.id} className="failed-reader">
                  <div className="failed-reader-main">
                    <div className="failed-reader-title">{failedReaderTitle(reader)}</div>
                    <div className="failed-reader-meta">
                      {formatDate(reader.created_at)} · {friendlyReaderError(reader.error_message)}
                    </div>
                    {reader.error_message && (
                      <button
                        type="button"
                        className="failed-reader-details-toggle"
                        onClick={() => toggleDetails(reader.id)}
                        aria-expanded={showDetails}
                      >
                        {showDetails ? 'Hide details' : 'Show details'}
                      </button>
                    )}
                    {showDetails && reader.error_message && (
                      <pre className="failed-reader-details">{reader.error_message}</pre>
                    )}
                  </div>
                  <div className="failed-reader-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onRetry(reader)}
                      disabled={busy}
                    >
                      {busyIds.has(reader.id) ? '…' : 'Retry'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm failed-reader-delete"
                      onClick={() => onDelete(reader)}
                      disabled={busy}
                      aria-label="Delete this failed story"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn btn-secondary failed-readers-delete-all"
            onClick={onDeleteAll}
            disabled={deletingAll}
          >
            {deletingAll ? 'Deleting…' : `Delete all failed (${readers.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

export function ReadersListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [deletingAll, setDeletingAll] = useState(false);

  const readersQuery = useQuery({
    queryKey: ['readers'],
    queryFn: getGradedReaders,
    // Poll every 3 seconds if there are any generating readers
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasGenerating = data?.some((r: GradedReader) => r.status === 'generating');
      return hasGenerating ? 3000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGradedReader,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['readers'] });
    },
    onError: () => showToast("Couldn't delete that story. Please try again."),
  });

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds(prev => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleRetry = async (reader: GradedReader) => {
    markBusy(reader.id, true);
    try {
      await retryGradedReader(reader.id);
      queryClient.invalidateQueries({ queryKey: ['readers'] });
    } catch (err) {
      showToast(err instanceof Error && err.message ? `Couldn't retry: ${err.message}` : "Couldn't retry that story.");
    } finally {
      markBusy(reader.id, false);
    }
  };

  const handleDeleteFailed = async (reader: GradedReader) => {
    markBusy(reader.id, true);
    try {
      await deleteGradedReader(reader.id);
      queryClient.invalidateQueries({ queryKey: ['readers'] });
    } catch {
      showToast("Couldn't delete that story. Please try again.");
    } finally {
      markBusy(reader.id, false);
    }
  };

  const handleDeleteAllFailed = async (failed: GradedReader[]) => {
    if (!window.confirm(`Delete all ${failed.length} failed stories? This cannot be undone.`)) return;
    setDeletingAll(true);
    const results = await Promise.allSettled(failed.map(r => deleteGradedReader(r.id)));
    setDeletingAll(false);
    queryClient.invalidateQueries({ queryKey: ['readers'] });
    const failures = results.filter(r => r.status === 'rejected').length;
    if (failures > 0) showToast(`${failures} of ${failed.length} couldn't be deleted. Try again.`);
  };

  const handleImport = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showToast('That file is not valid JSON.');
      return;
    }
    try {
      const reader = await importReader(parsed);
      queryClient.invalidateQueries({ queryKey: ['readers'] });
      navigate(`/readers/${reader.id}/edit`);
    } catch (err) {
      const msg = err instanceof LessonApiError && err.problems.length
        ? `Could not import:\n${err.problems.join('\n')}`
        : `Could not import: ${err instanceof Error ? err.message : 'unknown error'}`;
      showToast(msg);
    }
  };

  const handleDelete = (reader: GradedReader) => {
    const message = reader.status === 'generating'
      ? `Cancel generation of "${reader.title_english}"?`
      : `Delete "${reader.title_english}"? This cannot be undone.`;
    if (window.confirm(message)) {
      deleteMutation.mutate(reader.id);
    }
  };

  if (readersQuery.isLoading) {
    return <Loading />;
  }

  if (readersQuery.error) {
    return (
      <div className="page">
        <div className="container">
          <div className="card" style={{ textAlign: 'center', color: '#dc2626' }}>
            Failed to load readers. Please try again.
          </div>
        </div>
      </div>
    );
  }

  const { active, failed } = partitionReaders(readersQuery.data || []);

  return (
    <div className="page">
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>Graded Readers</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/readers/new/edit" className="btn btn-secondary">
              Create New
            </Link>
            <Link to="/readers/generate" className="btn btn-primary">
              AI Generate
            </Link>
            <ReadersOverflowMenu onImport={handleImport} />
          </div>
        </div>

        {active.length === 0 && failed.length === 0 ? (
          <EmptyState
            icon="📚"
            title="No stories yet"
            description="Generate AI-powered reading stories using vocabulary from your decks"
            action={
              <Link to="/readers/generate" className="btn btn-primary">
                Generate Your First Story
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {active.length === 0 && (
              <EmptyState
                icon="📚"
                title="No stories yet"
                description="Generate AI-powered reading stories using vocabulary from your decks"
                action={
                  <Link to="/readers/generate" className="btn btn-primary">
                    Generate Your First Story
                  </Link>
                }
              />
            )}
            {active.map((reader) => (
              <ReaderCard
                key={reader.id}
                reader={reader}
                onDelete={() => handleDelete(reader)}
              />
            ))}
            {failed.length > 0 && (
              <FailedReadersRow
                readers={failed}
                onRetry={handleRetry}
                onDelete={handleDeleteFailed}
                onDeleteAll={() => handleDeleteAllFailed(failed)}
                busyIds={busyIds}
                deletingAll={deletingAll}
              />
            )}
          </div>
        )}

        <Toast message={toast} />
      </div>
    </div>
  );
}
