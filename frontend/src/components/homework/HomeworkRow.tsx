import { Link } from 'react-router-dom';
import { homeworkRowDetail, itemStatus, localDate, LIBRARY_STATUS_LABELS, statusTone, startedBar, WORD_UNIT, type DueLabel, type RetryBar } from '@shared/homework';
import { EXERCISE_UNIT } from '@shared/study/lessonRun';
import { RetryProgressBar } from './RetryProgressBar';
import { RowMenuButton, useRowPress } from './RowActions';
import { KIND_ICON, titleParts, type HomeworkItem } from '../../services/homework';
import './homework.css';
import '../tutor/library/homework-library.css';

/** "overdue" / "due today" / "due in 2 days" as a coloured chip. */
export function DueChip({ due, done = false }: { due: DueLabel; done?: boolean }) {
  if (done) return <span className="hw-chip hw-chip-done">done</span>;
  if (!due.text) return null;
  return <span className={`hw-chip hw-chip-${due.tone}`} data-testid="hw-due">{due.text}</span>;
}

/**
 * One homework item: icon, title, progress line, due chip. Taps into the pass. Once started, the
 * retry bar (a deck pass from its events; a lesson from its run in progress — `runBar`). Long-press /
 * ⋯ opens the row's menu (`onMenu`).
 */
export function HomeworkRow({ item, showTutor = false, runBar = null, onMenu, action }: {
  item: HomeworkItem;
  showTutor?: boolean;
  /** A lesson's run in progress on this device (`savedRunBar`). */
  runBar?: RetryBar | null;
  onMenu?: (item: HomeworkItem) => void;
  /** Something on the right instead of the due chip (a skipped row's "Undo skip"). */
  action?: React.ReactNode;
}) {
  const a = item.assignment;
  const { base } = titleParts(a);
  const press = useRowPress(() => onMenu?.(item));
  const bar = item.done || item.skipped ? null : a.kind === 'deck' ? startedBar(item.bar) : a.kind === 'lesson' ? startedBar(runBar) : null;
  return (
    <div className="hw-row-wrap">
      <Link
        to={`/homework/${a.id}`}
        className={`hw-row${item.done ? ' hw-row-done' : ''}${item.skipped ? ' hw-row-skipped' : ''}`}
        data-testid="hw-row"
        {...(onMenu ? press.handlers : {})}
        onClick={(e) => { if (onMenu && press.suppressTap()) e.preventDefault(); }}
      >
        <span className="hw-row-icon" aria-hidden="true">{KIND_ICON[a.kind] ?? '📝'}</span>
        <span className="hw-row-main">
          <span className="hw-row-title" lang="zh">{base}</span>
          <span className="hw-row-meta">
            <StudentStatus item={item} />
            {homeworkRowDetail(item, showTutor)}
          </span>
          {bar && <RetryProgressBar bar={bar} unit={a.kind === 'deck' ? WORD_UNIT : EXERCISE_UNIT} className="hw-slim-retry-bar" testId="hw-row-bar" />}
        </span>
        {!action && <DueChip due={item.due} done={item.done} />}
      </Link>
      {action}
      {onMenu && !action && <RowMenuButton onClick={() => onMenu(item)} label={base} />}
    </div>
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
