/**
 * Lesson Library — a tutor's master copies of mini lessons. New lesson
 * (Claude drafts it from a description, or start blank), per-card Edit /
 * Assign / Duplicate / Export / Archive, Import JSON.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomLessonSpec } from '@shared/lesson';
import { lessonToMarkdown, lessonToJson, lessonToCsv, lessonExportFilename } from '@shared/lesson';
import {
  listLibrary,
  createLibraryItem,
  generateLibraryItem,
  importLibraryItem,
  duplicateLibraryItem,
  archiveLibraryItem,
  assignLibraryItem,
  getLibraryItem,
  getLibraryAssignments,
  LessonApiError,
} from '../../api/lessonEditor';
import { getMyRelationships } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { getOtherUserInRelationship } from '../../types';
import type { LibraryItemSummary } from '../../types/lessonEditor';
import { Loading, ErrorMessage } from '../../components/Loading';
import { downloadText } from '../../components/editor/download';
import { useToast } from './LessonEditorPage';
import './LessonLibraryPage.css';

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ============ New lesson sheet ============

function NewLessonSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const item = await generateLibraryItem(prompt.trim());
      onCreated(item.id);
    } catch (err) {
      setError(err instanceof LessonApiError && err.status === 503
        ? 'Claude is not configured on this server — start blank instead.'
        : err instanceof Error ? err.message : 'Could not draft the lesson');
      setBusy(false);
    }
  }

  async function blank() {
    setBusy(true);
    try {
      const spec: CustomLessonSpec = {
        title: 'New lesson',
        icon: '🎓',
        sections: [{ title: 'Warm-up', exercises: [{ type: 'note', title: 'What this lesson covers', body: 'Write a short explanation here.' }] }],
      };
      const item = await createLibraryItem(spec);
      onCreated(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the lesson');
      setBusy(false);
    }
  }

  return (
    <div className="ed-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="ed-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="New lesson">
        <div className="ed-modal-head">
          <span>New lesson</span>
          <button type="button" className="ed-mini-btn" onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
        </div>
        <div className="ed-modal-body">
          <label className="ed-field">
            <span className="ed-label">Describe it and let Claude draft it</span>
            <textarea
              className="ed-input"
              rows={4}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. A beginner lesson on 把 sentences with kitchen verbs: a short explanation, two word-order exercises, a listening exercise contrasting 把 and 吧, and a speaking task."
              disabled={busy}
              autoFocus
            />
          </label>
          {error && <ErrorMessage message={error} />}
          <button className="btn btn-primary btn-block" onClick={draft} disabled={busy || !prompt.trim()}>
            {busy ? 'Drafting… (about a minute)' : '✨ Draft with Claude'}
          </button>
          <button className="btn btn-link lib-blank-link" onClick={blank} disabled={busy}>
            or start blank
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Assign sheet ============

export function AssignSheet({ itemId, itemTitle, onClose, onDone }: {
  itemId: string;
  itemTitle: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const relationships = useQuery({ queryKey: ['relationships'], queryFn: getMyRelationships });
  const { user } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Students who already have this lesson are ticked-and-disabled.
  const assignments = useQuery({
    queryKey: ['library-assignments', itemId],
    queryFn: () => getLibraryAssignments(itemId),
  });
  const alreadyByRel = new Set((assignments.data ?? []).map(a => a.relationship_id).filter((r): r is string => !!r));
  const alreadyByStudent = new Set((assignments.data ?? []).map(a => a.student.id));

  const students = relationships.data?.students ?? [];

  async function assign() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await assignLibraryItem(itemId, Array.from(selected));
      const parts: string[] = [];
      if (result.assigned.length) parts.push(`assigned to ${result.assigned.length} student${result.assigned.length === 1 ? '' : 's'}`);
      if (result.already_had.length) parts.push(`${result.already_had.length} already had it`);
      if (result.errors.length) parts.push(`${result.errors.length} failed`);
      onDone(`“${itemTitle}” ${parts.join(', ') || 'nothing to do'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign');
      setBusy(false);
    }
  }

  return (
    <div className="ed-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="ed-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Assign to students">
        <div className="ed-modal-head">
          <span>Assign “{itemTitle}”</span>
          <button type="button" className="ed-mini-btn" onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
        </div>
        <div className="ed-modal-body">
          {relationships.isLoading && <Loading message="Loading students…" />}
          {relationships.data && students.length === 0 && (
            <p className="text-light">You have no students yet. Invite one from <Link to="/connections">Connections</Link>.</p>
          )}
          {students.map(rel => {
            const other = getOtherUserInRelationship(rel, user!.id);
            const has = alreadyByRel.has(rel.id) || alreadyByStudent.has(other.id);
            return (
              <label key={rel.id} className={`lib-student-row ${has ? 'has' : ''}`}>
                <input
                  type="checkbox"
                  checked={has || selected.has(rel.id)}
                  disabled={has || busy}
                  onChange={e => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(rel.id); else next.delete(rel.id);
                    setSelected(next);
                  }}
                />
                <span className="lib-student-name">{other.name || other.email}</span>
                {has && <span className="lib-student-has">already has it</span>}
              </label>
            );
          })}
          {error && <ErrorMessage message={error} />}
        </div>
        <div className="ed-modal-foot">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={assign} disabled={busy || selected.size === 0}>
            {busy ? 'Assigning…' : `Assign to ${selected.size || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Library card ============

function LibraryCard({ item, onAssign, onChanged, toast }: {
  item: LibraryItemSummary;
  onAssign: () => void;
  onChanged: () => void;
  toast: (m: string) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function exportAs(format: 'md' | 'json' | 'csv') {
    setOpen(false);
    try {
      const full = await getLibraryItem(item.id);
      const text = format === 'md' ? lessonToMarkdown(full.spec) : format === 'json' ? lessonToJson(full.spec) : lessonToCsv(full.spec);
      const mime = format === 'md' ? 'text/markdown' : format === 'json' ? 'application/json' : 'text/csv';
      downloadText(lessonExportFilename(full.spec, format), text, `${mime};charset=utf-8`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed');
    }
  }

  return (
    <div className="lib-card">
      <Link to={`/library/${item.id}`} className="lib-card-main">
        <span className="lib-card-icon">{item.icon || '🎓'}</span>
        <span className="lib-card-body">
          <span className="lib-card-title">{item.title}</span>
          {item.description && <span className="lib-card-desc">{item.description}</span>}
          <span className="lib-card-meta">
            {item.exercise_count} exercise{item.exercise_count === 1 ? '' : 's'}
            {' · '}{item.assignment_count === 0 ? 'not assigned' : `assigned to ${item.assignment_count} student${item.assignment_count === 1 ? '' : 's'}`}
            {' · '}updated {formatDate(item.updated_at)}
          </span>
          {item.tags.length > 0 && (
            <span className="lib-card-tags">{item.tags.map(t => <span key={t} className="lib-tag">{t}</span>)}</span>
          )}
        </span>
      </Link>
      <div className="lib-card-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/library/${item.id}/edit`)}>✏️ Edit</button>
        <button className="btn btn-primary btn-sm" onClick={onAssign}>Assign…</button>
        <div className="editor-menu-wrap" ref={menuRef}>
          <button className="editor-icon-btn" onClick={() => setOpen(o => !o)} aria-label="More" aria-haspopup="menu" aria-expanded={open}>⋯</button>
          {open && (
            <div className="editor-menu" role="menu">
              <button role="menuitem" onClick={async () => {
                setOpen(false);
                try {
                  const copy = await duplicateLibraryItem(item.id);
                  onChanged();
                  navigate(`/library/${copy.id}/edit`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Could not duplicate');
                }
              }}>⧉ Duplicate</button>
              <button role="menuitem" className="section" onClick={() => exportAs('md')}>⬇ Export Markdown</button>
              <button role="menuitem" onClick={() => { setOpen(false); navigate(`/library/${item.id}/print`); }}>🖨 Print view</button>
              <button role="menuitem" onClick={() => exportAs('json')}>⬇ Export JSON</button>
              <button role="menuitem" onClick={() => exportAs('csv')}>⬇ Export CSV (Quizlet)</button>
              <button role="menuitem" className="danger section" onClick={async () => {
                setOpen(false);
                if (!confirm(`Archive "${item.title}"? Students keep their copies.`)) return;
                try {
                  await archiveLibraryItem(item.id);
                  onChanged();
                  toast('Archived');
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Could not archive');
                }
              }}>🗄 Archive</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Page ============

export function LessonLibraryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [showNew, setShowNew] = useState(false);
  const [assigning, setAssigning] = useState<LibraryItemSummary | null>(null);
  const [pageMenu, setPageMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pageMenuRef = useRef<HTMLDivElement>(null);

  const library = useQuery({ queryKey: ['lesson-library'], queryFn: listLibrary });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lesson-library'] });

  useEffect(() => {
    if (!pageMenu) return;
    const onDown = (e: MouseEvent) => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(e.target as Node)) setPageMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pageMenu]);

  async function importFile(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      // Accept either a bare spec or an export wrapper with a spec field.
      const spec = parsed && typeof parsed === 'object' && 'spec' in parsed && !('sections' in parsed) ? (parsed as { spec: unknown }).spec : parsed;
      const item = await importLibraryItem(spec);
      refresh();
      showToast(`Imported “${item.title}”`);
      navigate(`/library/${item.id}`);
    } catch (err) {
      showToast(err instanceof LessonApiError && err.problems.length
        ? `Import failed: ${err.problems.slice(0, 3).join('; ')}`
        : `Import failed: ${err instanceof Error ? err.message : 'not a lesson JSON file'}`);
    }
  }

  return (
    <div className="page">
      <div className="container lib-page">
        <div className="lib-head">
          <h1>📚 Lesson Library</h1>
          <div className="lib-head-actions">
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New lesson</button>
            <div className="editor-menu-wrap" ref={pageMenuRef}>
              <button className="editor-icon-btn" onClick={() => setPageMenu(o => !o)} aria-label="More" aria-haspopup="menu" aria-expanded={pageMenu}>⋯</button>
              {pageMenu && (
                <div className="editor-menu" role="menu">
                  <button role="menuitem" onClick={() => { setPageMenu(false); fileRef.current?.click(); }}>⬆ Import JSON…</button>
                  <button role="menuitem" onClick={() => { setPageMenu(false); navigate('/lessons'); }}>🎓 My mini lessons</button>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <p className="text-light lib-sub">
          Master copies of your mini lessons. Assign one to a student and they get their own copy in their study
          sessions; edit here and push the update to keep everyone in step.
        </p>

        {library.isLoading && <Loading message="Loading library…" />}
        {library.isError && <ErrorMessage message={library.error instanceof Error ? library.error.message : 'Could not load the library'} />}
        {library.data && library.data.length === 0 && (
          <div className="lib-empty">
            <div className="lib-empty-icon">📚</div>
            <p>No lessons yet. Describe one and let Claude draft it, or import a JSON export.</p>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New lesson</button>
          </div>
        )}
        {library.data?.map(item => (
          <LibraryCard
            key={item.id}
            item={item}
            onAssign={() => setAssigning(item)}
            onChanged={refresh}
            toast={showToast}
          />
        ))}
      </div>

      {showNew && (
        <NewLessonSheet
          onClose={() => setShowNew(false)}
          onCreated={id => {
            refresh();
            setShowNew(false);
            navigate(`/library/${id}/edit`);
          }}
        />
      )}
      {assigning && (
        <AssignSheet
          itemId={assigning.id}
          itemTitle={assigning.title}
          onClose={() => setAssigning(null)}
          onDone={msg => {
            setAssigning(null);
            refresh();
            queryClient.invalidateQueries({ queryKey: ['library-assignments', assigning.id] });
            showToast(msg);
          }}
        />
      )}
      {toast && <div className="ed-toast" role="status">{toast}</div>}
    </div>
  );
}
