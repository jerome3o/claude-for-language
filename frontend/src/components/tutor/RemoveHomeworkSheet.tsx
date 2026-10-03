import { useEffect, useState } from 'react';
import { removalCopy, removalToast, type RemovalKind } from '@shared/homework';
import {
  previewDeckRemoval,
  previewLessonRemoval,
  previewReaderRemoval,
  removeStudentDeck,
  removeStudentLesson,
  removeStudentReader,
} from '../../api/tutorDashboard';
import type { HomeworkRemovalResult, RemovalPreview } from '../../types/tutorDashboard';
import { track, trackError } from '../../services/analytics';
import './homework-tutor.css';

/** What to take back: `id` = the share id or the student's copy id (deck / reader), the student's lesson id (lesson). */
export interface RemovalTarget {
  kind: RemovalKind;
  id: string;
  /** Title as the tutor knows it (her deck's name, the lesson / reader title). */
  title: string;
}

function preview(relId: string, t: RemovalTarget): Promise<RemovalPreview> {
  if (t.kind === 'deck') return previewDeckRemoval(relId, t.id);
  if (t.kind === 'lesson') return previewLessonRemoval(relId, t.id);
  return previewReaderRemoval(relId, t.id);
}

function remove(relId: string, t: RemovalTarget, deleteSource: boolean): Promise<HomeworkRemovalResult> {
  if (t.kind === 'deck') return removeStudentDeck(relId, t.id, deleteSource);
  if (t.kind === 'lesson') return removeStudentLesson(relId, t.id);
  return removeStudentReader(relId, t.id);
}

/**
 * "Remove from Jerome's decks?" — what happens to the student's progress in
 * plain words (from the removal preview), "Also delete my copy" when that
 * applies, and a red Remove. `onRemoved` gets the toast text.
 */
export function RemoveHomeworkSheet({
  relId,
  studentName,
  target,
  onClose,
  onRemoved,
}: {
  relId: string;
  studentName: string;
  target: RemovalTarget;
  onClose: () => void;
  onRemoved: (toast: string, result: HomeworkRemovalResult) => void;
}) {
  const [facts, setFacts] = useState<RemovalPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteSource, setDeleteSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFacts(null);
    setLoadError(null);
    preview(relId, target)
      .then((p) => live && setFacts(p))
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : 'Could not load'));
    return () => {
      live = false;
    };
  }, [relId, target]);

  const copy = facts
    ? removalCopy(
        facts.kind === 'deck'
          ? {
              kind: 'deck',
              title: target.title,
              words_met: facts.words_met,
              words_total: facts.words_total,
              copy_gone: facts.deck_name == null,
              can_delete_source: facts.can_delete_source,
            }
          : facts.kind === 'lesson'
            ? { kind: 'lesson', title: target.title, times: facts.completions }
            : { kind: 'reader', title: target.title, times: facts.readings, copy_gone: facts.title == null },
        studentName
      )
    : null;

  const handleRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await remove(relId, target, deleteSource && !!copy?.sourceOption);
      track('tutor.remove_homework', { kind: target.kind });
      onRemoved(removalToast(target.kind, target.title, studentName, result.source_deleted), result);
    } catch (e) {
      trackError('remove_homework', e);
      setError(e instanceof Error ? e.message : 'Could not remove it');
      setBusy(false);
    }
  };

  return (
    <div className="td-sheet-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <div
        className="td-sheet hw-remove-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={copy?.title ?? 'Remove homework'}
        onClick={(e) => e.stopPropagation()}
        data-testid="remove-homework-sheet"
      >
        <div className="td-sheet-head">
          <h2>{copy?.title ?? 'Remove homework'}</h2>
          <button type="button" className="td-sheet-close" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>
        <div className="td-sheet-body">
          {!facts && !loadError && <p className="td-muted">Checking what {studentName.split(' ')[0] || 'they'} has done…</p>}
          {loadError && <div className="td-error">{loadError}</div>}
          {copy && (
            <>
              <p className="hw-remove-body" data-testid="remove-homework-body">{copy.body}</p>
              <p className="td-muted hw-remove-detail">{copy.detail}</p>
              {copy.sourceOption && (
                <label className="hw-remove-option">
                  <input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} disabled={busy} />
                  <span>
                    {copy.sourceOption}
                    <span className="td-muted"> — “{target.title}” in your decks; no other student has it</span>
                  </span>
                </label>
              )}
            </>
          )}
          {error && <div className="td-error">{error}</div>}
          <div className="hw-remove-actions sheet-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn hw-remove-confirm"
              onClick={handleRemove}
              disabled={!copy || busy}
              data-testid="remove-homework-confirm"
            >
              {busy ? 'Removing…' : copy?.confirmLabel ?? 'Remove'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
