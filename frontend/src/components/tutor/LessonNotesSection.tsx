import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addLessonNotes, draftFromLessonNotes, listLessonNotes, type LessonNotesEntry } from '../../api/homework';
import { useNetwork } from '../../contexts/NetworkContext';
import { shortDate } from './format';
import './tutor-dashboard.css';
import './session-notes.css';
import './homework-tutor.css';

const INLINE = 4;

function entryTitle(e: LessonNotesEntry): string {
  if (e.title) return e.title;
  const first = (e.notes ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? 'Lesson';
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

function isActive(e: LessonNotesEntry): boolean {
  return !!e.job && (e.job.status === 'queued' || e.job.status === 'running');
}

/** Where an entry's homework stands, and the one action that fits. */
function EntryState({ relId, entry }: { relId: string; entry: LessonNotesEntry }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const draft = useMutation({
    mutationFn: () => draftFromLessonNotes(relId, entry.id),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['lesson-notes', relId] });
      navigate(`/connections/${relId}/homework/${r.job.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not start the draft'),
  });
  const job = entry.job;
  const review = job ? `/connections/${relId}/homework/${job.id}` : '';
  if (!job) {
    return (
      <div className="hwt-entry-state">
        <span className="hwt-entry-status">No homework yet</span>
        <button type="button" className="btn btn-secondary sn-small" onClick={() => draft.mutate()} disabled={draft.isPending || !entry.notes} data-testid="ln-draft">
          {draft.isPending ? 'Starting…' : '✨ Draft homework'}
        </button>
        {error && <span className="td-error">{error}</span>}
      </div>
    );
  }
  if (job.status === 'queued' || job.status === 'running') {
    return (
      <div className="hwt-entry-state">
        <span className="hwt-entry-status hwt-working"><span className="sn-spinner" aria-hidden="true" /> Drafting… {job.progress ?? ''}</span>
        <Link to={review} className="btn btn-secondary sn-small">Open</Link>
      </div>
    );
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    return (
      <div className="hwt-entry-state">
        <span className="hwt-entry-status hwt-status-failed">{job.status === 'failed' ? 'Draft failed' : 'Cancelled'}</span>
        <Link to={review} className="btn btn-secondary sn-small">Open</Link>
      </div>
    );
  }
  if (!job.review) {
    return <div className="hwt-entry-state"><span className="hwt-entry-status">Sent automatically</span></div>;
  }
  if (job.assigned_at) {
    return (
      <div className="hwt-entry-state">
        <span className="hwt-entry-status hwt-status-assigned">✓ Assigned {shortDate(job.assigned_at)}</span>
        <Link to={review} className="btn-link">View</Link>
      </div>
    );
  }
  return (
    <div className="hwt-entry-state">
      <span className="hwt-entry-status hwt-status-ready">Draft ready</span>
      <Link to={review} className="btn btn-primary sn-small" data-testid="ln-review">Review</Link>
    </div>
  );
}

/**
 * "Lesson notes" on the tutor's student page: one entry per lesson (date,
 * title) and its homework — drafted by the assistant, reviewed, then assigned
 * (docs/HOMEWORK.md §4). Polls while a draft is being written.
 */
export function LessonNotesSection({ relId, studentName }: { relId: string; studentName: string }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const query = useQuery({
    queryKey: ['lesson-notes', relId],
    queryFn: () => listLessonNotes(relId),
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 3000 : false),
    staleTime: 2000,
  });
  const entries = query.data ?? [];
  const visible = showAll ? entries : entries.slice(0, INLINE);
  return (
    <section className="detail-section sn-section" id="lesson-notes" data-testid="lesson-notes-section">
      <div className="sn-section-head">
        <h2>📝 Lesson notes</h2>
        <button type="button" className="btn btn-primary sn-add" onClick={() => setSheetOpen(true)} data-testid="ln-open">
          + Add lesson notes
        </button>
      </div>
      {query.isError && <div className="td-error">Could not load the lesson notes</div>}
      {query.data && entries.length === 0 && (
        <div className="sn-empty">
          After a lesson, add your notes here. The assistant drafts homework for {studentName} from them — words, and a mini lesson when
          you taught a structure — and you review it (with Claude, if you like) before anything is sent.
        </div>
      )}
      {visible.length > 0 && (
        <div className="hwt-entries">
          {visible.map((e) => (
            <div key={e.id} className="hwt-entry" data-testid="ln-entry">
              <div className="hwt-entry-head">
                <span className="hwt-entry-date">{shortDate(e.lesson_at)}</span>
                <strong className="hwt-entry-title" lang="zh">{entryTitle(e)}</strong>
              </div>
              <EntryState relId={relId} entry={e} />
            </div>
          ))}
        </div>
      )}
      {!showAll && entries.length > INLINE && (
        <button type="button" className="btn-link" onClick={() => setShowAll(true)}>All lesson notes ({entries.length})</button>
      )}
      <div className="sn-more">
        <Link to={`/connections/${relId}/session-notes`}>Older session-notes jobs</Link>
      </div>
      {sheetOpen && <LessonNotesSheet relId={relId} studentName={studentName} onClose={() => setSheetOpen(false)} />}
    </section>
  );
}

function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add lesson notes: date, title, the notes, and whether to draft homework from them now. */
export function LessonNotesSheet({ relId, studentName, onClose }: { relId: string; studentName: string; onClose: () => void }) {
  const { isOnline } = useNetwork();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [lessonAt, setLessonAt] = useState(todayInput());
  const [draft, setDraft] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    textRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => addLessonNotes(relId, { notes: notes.trim(), title: title.trim() || undefined, lesson_at: lessonAt || undefined, draft }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['lesson-notes', relId] });
      queryClient.invalidateQueries({ queryKey: ['lessonLog', relId] });
      onClose();
      if (r.job) navigate(`/connections/${relId}/homework/${r.job.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save the notes'),
  });

  const chars = notes.trim().length;
  const tooShort = draft ? chars < 20 : chars === 0;
  return (
    <div className="td-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="td-sheet sn-sheet" role="dialog" aria-modal="true" aria-labelledby="ln-sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="td-sheet-head">
          <h2 id="ln-sheet-title">Lesson notes for {studentName}</h2>
          <button type="button" className="td-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form
          className="td-sheet-body sn-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (tooShort || save.isPending) return;
            setError(null);
            save.mutate();
          }}
        >
          <div className="sn-row">
            <label className="sn-field">
              <span className="sn-label">Title <span className="sn-optional">(optional)</span></span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Restaurant ordering" maxLength={120} data-testid="ln-title" />
            </label>
            <label className="sn-field sn-field-date">
              <span className="sn-label">Lesson date</span>
              <input type="date" value={lessonAt} onChange={(e) => setLessonAt(e.target.value)} />
            </label>
          </div>
          <label className="sn-label" htmlFor="ln-notes">Notes</label>
          <textarea
            id="ln-notes"
            ref={textRef}
            className="sn-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={'Any format, e.g.\n今天复习了点菜。新词：菜单 càidān menu, 服务员 fúwùyuán waiter…\n把 sentences: 把门关上。把书放在桌子上。'}
            rows={9}
            data-testid="ln-notes"
          />
          <label className="sn-check">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} data-testid="ln-draft-check" />
            <span>Draft homework from these notes — you review it before anything is sent</span>
          </label>
          {error && <div className="td-error" role="alert">{error}</div>}
          {!isOnline && <div className="td-error">You&rsquo;re offline — the notes can be saved once you&rsquo;re back online.</div>}
          <div className="sn-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={tooShort || save.isPending || !isOnline} data-testid="ln-submit">
              {save.isPending ? 'Saving…' : draft ? 'Save & draft homework' : 'Save notes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
