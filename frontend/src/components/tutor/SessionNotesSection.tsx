import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listSessionNotesJobs } from '../../api/tutorNotes';
import { isActiveJob } from '../../types/tutorNotes';
import { SessionNotesSheet } from './SessionNotesSheet';
import { SessionNotesJobCard } from './SessionNotesJobCard';
import './session-notes.css';

/** How often the list refreshes while a job is queued or running. */
export const SESSION_NOTES_POLL_MS = 3000;

/** Jobs shown inline on the student page; the rest live on the full page. */
const INLINE_JOBS = 3;

/**
 * "Session notes" on the tutor's student page: one button to paste the notes
 * from a lesson, and the latest jobs with live progress. Polls while a job is
 * active; a job card links to what it made.
 */
export function SessionNotesSection({ relId, studentName, showAll = false }: { relId: string; studentName: string; showAll?: boolean }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const jobsQuery = useQuery({
    queryKey: ['session-notes', relId],
    queryFn: () => listSessionNotesJobs(relId),
    refetchInterval: (query) => (query.state.data?.some(isActiveJob) ? SESSION_NOTES_POLL_MS : false),
    staleTime: 2000,
  });
  const jobs = jobsQuery.data ?? [];
  const visible = showAll ? jobs : jobs.slice(0, INLINE_JOBS);
  const activeCount = jobs.filter(isActiveJob).length;

  return (
    <section className="detail-section sn-section" id="session-notes" data-testid="session-notes-section">
      <div className="sn-section-head">
        <h2>📝 Session notes{activeCount > 0 ? <span className="sn-live-pill">{activeCount} working</span> : null}</h2>
        <button type="button" className="btn btn-primary sn-add" onClick={() => setSheetOpen(true)} data-testid="sn-open">
          + Add notes
        </button>
      </div>

      {jobsQuery.isLoading && <div className="sn-empty">Loading…</div>}
      {jobsQuery.isError && <div className="td-error">Could not load the session notes</div>}
      {jobsQuery.data && jobs.length === 0 && (
        <div className="sn-empty">
          After a lesson, paste your notes here. The assistant turns them into a deck of cards for {studentName} — and a mini lesson
          when the notes show a grammar point with examples — then sends them as homework.
        </div>
      )}

      {visible.length > 0 && (
        <div className="sn-jobs">
          {visible.map((job) => (
            <SessionNotesJobCard key={job.id} relId={relId} job={job} />
          ))}
        </div>
      )}

      {!showAll && jobs.length > INLINE_JOBS && (
        <div className="sn-more">
          <Link to={`/connections/${relId}/session-notes`}>All session notes ({jobs.length})</Link>
        </div>
      )}

      {sheetOpen && <SessionNotesSheet relId={relId} studentName={studentName} onClose={() => setSheetOpen(false)} />}
    </section>
  );
}
