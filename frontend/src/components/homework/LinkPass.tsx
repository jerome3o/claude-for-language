import { useState } from 'react';
import { LINK_NOTE_MAX, dueLabel, linkSiteName, linkThumbnail, localDate, shortDay, type HomeworkDetails } from '@shared/homework';
import { recordPassEvent } from '../../services/homework';
import { Confetti } from '../Confetti';
import { DueChip } from './HomeworkRow';
import './homework.css';

/**
 * Link homework for the student (docs/HOMEWORK.md §8): what to do, the link
 * (opens in the browser — nothing is embedded), then "Mark as done" with an
 * optional note back to the tutor. Offline-first: the done event is stored
 * locally and uploaded by the sync.
 */
export function LinkPass({
  assignmentId,
  targetId,
  title,
  details,
  dueDate,
  tutorName,
  complete,
  note,
  topbar,
}: {
  assignmentId: string;
  targetId: string;
  title: string;
  details: HomeworkDetails | null | undefined;
  dueDate: string | null;
  tutorName: string | null | undefined;
  complete: boolean;
  /** The note sent with "done", if any. */
  note: string | null;
  topbar: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const url = details?.url ?? null;
  const thumb = details?.thumbnail_url ?? (url ? linkThumbnail(url) : null);
  const tutor = tutorName || 'your tutor';

  const markDone = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await recordPassEvent(assignmentId, targetId, 'done', text.trim() || null);
      setCelebrate(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="study-fullscreen hw-pass hw-link-pass" data-testid="link-pass">
      {topbar}
      {celebrate && <Confetti />}
      <div className="hw-link-body">
        <h1 lang="zh">{title}</h1>
        <div className="hw-link-meta">
          {url && <span>🔗 {linkSiteName(url)}</span>}
          {dueDate ? <DueChip due={dueLabel(dueDate, localDate())} done={complete} /> : complete ? <DueChip due={dueLabel(null, localDate())} done /> : null}
          {dueDate && !complete && <span className="hw-muted">{shortDay(dueDate)}</span>}
        </div>
        {url && (
          <a className="hw-link-card" href={url} target="_blank" rel="noopener noreferrer" data-testid="link-open">
            {thumb && !thumbFailed ? (
              <img src={thumb} alt="" referrerPolicy="no-referrer" onError={() => setThumbFailed(true)} />
            ) : (
              <span className="hw-link-icon" aria-hidden="true">{url && linkSiteName(url) === 'YouTube' ? '▶️' : '🔗'}</span>
            )}
            <span className="hw-link-open">Open link ↗</span>
          </a>
        )}
        {details?.instructions && (
          <section className="hw-link-instructions">
            <h2>What to do</h2>
            <p>{details.instructions}</p>
          </section>
        )}
        {complete ? (
          <section className="hw-link-done" data-testid="link-done">
            <p>✅ Done{note ? ' — you told ' + tutor + ':' : '!'}</p>
            {note && <blockquote>{note}</blockquote>}
          </section>
        ) : (
          <section className="hw-link-finish">
            <label htmlFor="hw-link-note">A note for {tutor} (optional)</label>
            <textarea
              id="hw-link-note"
              rows={3}
              maxLength={LINK_NOTE_MAX}
              placeholder="我学了五个新词：…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="link-note"
            />
            <button type="button" className="btn btn-primary hw-link-done-btn" disabled={busy} onClick={() => void markDone()} data-testid="link-mark-done">
              {busy ? 'Saving…' : '✓ Mark as done'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
