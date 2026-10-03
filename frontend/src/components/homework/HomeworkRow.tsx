import { Link } from 'react-router-dom';
import { homeworkRowDetail, itemStatus, localDate, LIBRARY_STATUS_LABELS, statusTone, type DueLabel } from '@shared/homework';
import { KIND_ICON, titleParts, type HomeworkItem } from '../../services/homework';
import './homework.css';
import '../tutor/library/homework-library.css';

/** "overdue" / "due today" / "due in 2 days" as a coloured chip. */
export function DueChip({ due, done = false }: { due: DueLabel; done?: boolean }) {
  if (done) return <span className="hw-chip hw-chip-done">done</span>;
  if (!due.text) return null;
  return <span className={`hw-chip hw-chip-${due.tone}`} data-testid="hw-due">{due.text}</span>;
}

/** One homework item: icon, title, progress line, due chip. Taps into the pass. */
export function HomeworkRow({ item, showTutor = false }: { item: HomeworkItem; showTutor?: boolean }) {
  const a = item.assignment;
  const pct = item.progress.total > 0 ? Math.round((item.progress.done / item.progress.total) * 100) : 0;
  const { base } = titleParts(a);
  return (
    <Link to={`/homework/${a.id}`} className={`hw-row${item.done ? ' hw-row-done' : ''}`} data-testid="hw-row">
      <span className="hw-row-icon" aria-hidden="true">{KIND_ICON[a.kind] ?? '📝'}</span>
      <span className="hw-row-main">
        <span className="hw-row-title" lang="zh">{base}</span>
        <span className="hw-row-meta">
          <StudentStatus item={item} />
          {homeworkRowDetail(item, showTutor)}
        </span>
        {a.kind === 'deck' && !item.done && item.progress.done > 0 && (
          <span className="hw-row-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      <DueChip due={item.due} done={item.done} />
    </Link>
  );
}

/** Completed / In progress / Overdue / Not started — the same words and colours the tutor's library uses. */
function StudentStatus({ item }: { item: HomeworkItem }) {
  const today = localDate();
  const status = itemStatus(item, today);
  // Overdue / done already have their chip on the right.
  if (status === 'overdue' || status === 'completed') return null;
  return (
    <span className={`hw-status hl-status hl-tone-${statusTone(status, item.assignment.due_date, today)}`} data-testid="hw-status" data-status={status}>
      {LIBRARY_STATUS_LABELS[status]}
    </span>
  );
}
