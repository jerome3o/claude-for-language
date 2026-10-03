import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LibraryKind } from '@shared/homework';
import { listStudentCopies, updateStudentCopies, type CopyUpdateResult, type StudentCopy } from '../../../api/homeworkLibrary';
import { LibrarySheet } from './LibrarySheet';
import './homework-library.css';

const WHAT: Record<LibraryKind, string> = { deck: 'deck', lesson: 'lesson', reader: 'reader', link: 'link' };
const KEPT: Record<LibraryKind, string> = {
  deck: 'New words are added and your edits copied over; their progress is kept.',
  lesson: 'Same lesson, so their completions and review schedule are kept.',
  reader: 'Their reading history is kept.',
  link: 'They see the new title, link and instructions.',
};

/**
 * After saving something already sent: "Also update <student>'s copy" — one
 * checkbox per student, on by default (docs/HOMEWORK.md §10). Renders nothing
 * when there are no copies (or offline / on error), so callers can always
 * mount it after a save.
 */
export function UpdateCopiesPrompt({ kind, sourceId, onDone }: { kind: LibraryKind; sourceId: string; onDone: () => void }) {
  const [copies, setCopies] = useState<StudentCopy[] | null>(null);
  useEffect(() => {
    let live = true;
    listStudentCopies(kind, sourceId)
      .then((c) => {
        if (!live) return;
        if (c.length === 0) onDone();
        else setCopies(c);
      })
      .catch(() => live && onDone());
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sourceId]);
  if (!copies) return null;
  return <UpdateCopiesSheet kind={kind} sourceId={sourceId} copies={copies} onClose={onDone} />;
}

export function UpdateCopiesSheet({ kind, sourceId, copies, onClose }: { kind: LibraryKind; sourceId: string; copies: StudentCopy[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(copies.map((c) => c.relationship_id)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CopyUpdateResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byRel = new Map<string, StudentCopy>();
  for (const c of copies) if (!byRel.has(c.relationship_id)) byRel.set(c.relationship_id, c);
  const students = [...byRel.values()];

  const toggle = (relId: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(relId)) next.delete(relId);
      else next.add(relId);
      return next;
    });

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await updateStudentCopies(kind, sourceId, [...chosen]);
      setResults(res.results);
      queryClient.invalidateQueries({ queryKey: ['homework-library'] });
      queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the copies');
    } finally {
      setBusy(false);
    }
  };

  const title = students.length === 1 ? `Also update ${students[0].student_name}'s copy?` : 'Also update their copies?';
  return (
    <LibrarySheet title={title} onClose={onClose} testId="update-copies-sheet">
      {results ? (
        <>
          <ul className="hl-results" role="status">
            {results.map((r) => (
              <li key={r.relationship_id} className={r.ok ? '' : 'hl-result-error'}>
                {r.ok ? '✓' : '⚠'} <strong>{r.student_name}</strong> — {r.ok ? r.detail : r.error}
              </li>
            ))}
          </ul>
          <div className="td-confirm-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <>
          <p className="td-muted">You changed a {WHAT[kind]} you have sent. {KEPT[kind]}</p>
          <div className="hl-copies">
            {students.map((c) => (
              <label key={c.relationship_id} className="sn-check hl-copy">
                <input type="checkbox" checked={chosen.has(c.relationship_id)} onChange={() => toggle(c.relationship_id)} data-testid="update-copy-check" />
                <span>
                  Also update {c.student_name}'s copy
                  {c.behind ? <span className="hl-muted"> · {c.behind} new {c.behind === 1 ? 'word' : 'words'}</span> : null}
                </span>
              </label>
            ))}
          </div>
          {error && <div className="td-error" role="alert">{error}</div>}
          <div className="td-confirm-actions">
            <button type="button" className="btn btn-primary" disabled={busy || chosen.size === 0} onClick={() => void run()} data-testid="update-copies-confirm">
              {busy ? 'Updating…' : chosen.size === students.length && students.length > 1 ? 'Update all copies' : `Update ${chosen.size === 1 ? 'copy' : `${chosen.size} copies`}`}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Not now</button>
          </div>
        </>
      )}
    </LibrarySheet>
  );
}
