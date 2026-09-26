import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listCallHomework, makeHomeworkFromCall } from '../../api/tutorNotes';
import { isActiveJob } from '../../types/tutorNotes';
import { SessionNotesJobCard } from '../tutor/SessionNotesJobCard';
import { SESSION_NOTES_POLL_MS } from '../tutor/SessionNotesSection';
import '../tutor/session-notes.css';

interface Props {
  callId: string;
  relId: string;
  studentName: string;
  /** The call is over and its recording is not being processed right now. */
  ready: boolean;
}

/**
 * "Homework" on the call review page (tutor only): one button that hands the
 * transcript, whiteboard text, chat and report to the session-notes agent,
 * and the resulting job card(s) with live progress.
 */
export function CallHomeworkSection({ callId, relId, studentName, ready }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const jobsQuery = useQuery({
    queryKey: ['call-homework', callId],
    queryFn: () => listCallHomework(callId),
    refetchInterval: (query) => (query.state.data?.some(isActiveJob) ? SESSION_NOTES_POLL_MS : false),
    staleTime: 2000,
  });
  const jobs = jobsQuery.data ?? [];
  const active = jobs.some(isActiveJob);
  const start = useMutation({
    mutationFn: () => makeHomeworkFromCall(callId, { priority: 'core', auto_share: true, log_lesson: true }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['call-homework', callId] });
      queryClient.invalidateQueries({ queryKey: ['session-notes', relId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not start'),
  });

  return (
    <section className="detail-section cr-section sn-section" data-testid="call-homework-section">
      <h2>Homework</h2>
      {jobs.length === 0 && (
        <p className="sn-empty">
          Turn this lesson into homework for {studentName}: the assistant reads the transcript, the whiteboard and the report,
          makes a deck of cards for what you taught (skipping words they already know) and a mini lesson when a grammar point was
          taught, and sends them to the student. Same as pasting notes on their page.
        </p>
      )}
      {jobs.length > 0 && (
        <div className="sn-jobs">
          {jobs.map((job) => (
            <SessionNotesJobCard key={job.id} relId={relId} job={job} />
          ))}
        </div>
      )}
      {error && <div className="td-error sn-job-error" role="alert">{error}</div>}
      {!active && (
        <div className="sn-job-actions">
          <button
            type="button"
            className="btn btn-primary sn-add"
            onClick={() => start.mutate()}
            disabled={!ready || start.isPending}
            data-testid="call-make-homework"
          >
            {start.isPending ? 'Starting…' : jobs.length > 0 ? 'Make homework again' : '✨ Make homework from this lesson'}
          </button>
          {!ready && <span className="sn-hint">Available once the call has ended and the recording is transcribed.</span>}
          {jobs.length > 0 && (
            <Link to={`/connections/${relId}/session-notes`} className="btn-link">All session notes</Link>
          )}
        </div>
      )}
    </section>
  );
}
