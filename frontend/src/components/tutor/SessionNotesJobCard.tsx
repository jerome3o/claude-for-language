import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelSessionNotesJob, deleteSessionNotesJob, retrySessionNotesJob } from '../../api/tutorNotes';
import type { SessionNotesJob, SessionNotesStep } from '../../types/tutorNotes';
import { isActiveJob } from '../../types/tutorNotes';
import { plural, shortDateTime } from './format';
import './session-notes.css';

const STATUS_LABEL: Record<SessionNotesJob['status'], string> = {
  queued: 'Queued',
  running: 'Working…',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STEP_ICON: Record<SessionNotesStep['kind'], string> = {
  info: '·',
  tool: '✓',
  warn: '!',
  done: '✓',
  error: '✕',
};

function jobTitle(job: SessionNotesJob): string {
  if (job.title) return job.title;
  if (job.result.deck?.name) return job.result.deck.name;
  const firstLine = job.notes.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Session notes';
  return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
}

/** Steps to show while the job runs (the last few) or when done (all, behind a toggle). */
const LIVE_STEPS = 4;

/**
 * One session-notes job: what the assistant is doing right now (or did), what
 * it made with links into the tutor's own copies, and Retry / Cancel / Delete.
 */
export function SessionNotesJobCard({ relId, job, defaultOpen = false }: { relId: string; job: SessionNotesJob; defaultOpen?: boolean }) {
  const queryClient = useQueryClient();
  const [showSteps, setShowSteps] = useState(defaultOpen);
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = isActiveJob(job);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['session-notes', relId] });

  const retry = useMutation({ mutationFn: () => retrySessionNotesJob(relId, job.id), onSuccess: invalidate, onError: (e) => setError(e instanceof Error ? e.message : 'Could not retry') });
  const cancel = useMutation({ mutationFn: () => cancelSessionNotesJob(relId, job.id), onSuccess: invalidate, onError: (e) => setError(e instanceof Error ? e.message : 'Could not cancel') });
  const remove = useMutation({ mutationFn: () => deleteSessionNotesJob(relId, job.id), onSuccess: invalidate, onError: (e) => setError(e instanceof Error ? e.message : 'Could not delete') });

  const steps = job.steps;
  const visibleSteps = active && !showSteps ? steps.slice(-LIVE_STEPS) : steps;
  const hiddenCount = steps.length - visibleSteps.length;
  const { deck, lessons, reader, summary, skipped } = job.result;
  const madeSomething = !!deck || !!lessons?.length || !!reader;

  return (
    <article className={`sn-job sn-job-${job.status}`} data-testid="sn-job" data-status={job.status}>
      <header className="sn-job-head">
        <div className="sn-job-title">
          <strong>{jobTitle(job)}</strong>
          <span className="sn-job-when">
            {job.lesson_at ? `Lesson ${shortDateTime(job.lesson_at).replace(/,? \d{1,2}:\d{2}.*$/, '')} · ` : ''}
            sent {shortDateTime(job.created_at)} · {job.notes_chars.toLocaleString()} characters
          </span>
        </div>
        <span className={`sn-status sn-status-${job.status}`}>
          {active && <span className="sn-spinner" aria-hidden="true" />}
          {STATUS_LABEL[job.status]}
        </span>
      </header>

      {active && job.progress && (
        <div className="sn-progress" role="status" aria-live="polite">
          {job.progress}
        </div>
      )}

      {job.status === 'failed' && job.error && <div className="td-error sn-job-error">Failed: {job.error}</div>}

      {(active || showSteps || job.status !== 'done') && steps.length > 0 && (
        <ol className="sn-steps" aria-label="What the assistant did">
          {hiddenCount > 0 && (
            <li className="sn-step sn-step-more">
              <button type="button" className="btn-link" onClick={() => setShowSteps(true)}>
                {hiddenCount} earlier {plural(hiddenCount, 'step')}
              </button>
            </li>
          )}
          {visibleSteps.map((s, i) => (
            <li key={`${s.at}-${i}`} className={`sn-step sn-step-${s.kind}`}>
              <span className="sn-step-icon" aria-hidden="true">{STEP_ICON[s.kind]}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      )}

      {job.status === 'done' && (
        <div className="sn-result">
          {madeSomething ? (
            <ul className="sn-made">
              {deck && (
                <li>
                  <span className="sn-made-icon" aria-hidden="true">📚</span>
                  <span>
                    <Link to={`/decks/${deck.id}`}>{deck.name}</Link> · {plural(deck.note_count, 'card')}
                    {deck.target_deck_id ? <span className="sn-sent"> · sent to student</span> : <span className="sn-unsent"> · in your library, not sent</span>}
                  </span>
                </li>
              )}
              {lessons?.map((l) => (
                <li key={l.library_item_id}>
                  <span className="sn-made-icon" aria-hidden="true">📘</span>
                  <span>
                    <Link to={`/library/${l.library_item_id}`}>{l.title}</Link> · mini lesson, {plural(l.exercise_count, 'exercise')}
                    {l.lesson_id ? <span className="sn-sent"> · assigned</span> : <span className="sn-unsent"> · in your library, not assigned</span>}
                  </span>
                </li>
              ))}
              {reader && (
                <li>
                  <span className="sn-made-icon" aria-hidden="true">📖</span>
                  <span>
                    <Link to={`/readers/${reader.id}/edit`}>{reader.title_english}</Link> · reader, {plural(reader.page_count, 'page')}
                    {reader.target_reader_id ? <span className="sn-sent"> · sent to student</span> : <span className="sn-unsent"> · in your readers, not sent</span>}
                  </span>
                </li>
              )}
            </ul>
          ) : (
            <div className="sn-nothing">Nothing was created from these notes.</div>
          )}
          {summary && <p className="sn-summary">{summary}</p>}
          {skipped && skipped.length > 0 && (
            <details className="sn-skipped">
              <summary>{plural(skipped.length, 'word')} left out</summary>
              <ul>
                {skipped.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && <div className="td-error sn-job-error">{error}</div>}

      <footer className="sn-job-actions">
        {job.status === 'done' && steps.length > 0 && (
          <button type="button" className="btn-link" onClick={() => setShowSteps((v) => !v)}>
            {showSteps ? 'Hide steps' : `What it did (${steps.length})`}
          </button>
        )}
        <button type="button" className="btn-link" onClick={() => setShowNotes((v) => !v)}>
          {showNotes ? 'Hide notes' : 'Show notes'}
        </button>
        {active && (
          <button type="button" className="btn-link sn-danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Cancel
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <button type="button" className="btn btn-secondary sn-small" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </button>
        )}
        {!active && (
          <button
            type="button"
            className="btn-link sn-danger"
            onClick={() => {
              if (window.confirm('Forget this job? Anything it created stays in your library.')) remove.mutate();
            }}
            disabled={remove.isPending}
          >
            Delete
          </button>
        )}
      </footer>

      {showNotes && <pre className="sn-notes">{job.notes}</pre>}
    </article>
  );
}
