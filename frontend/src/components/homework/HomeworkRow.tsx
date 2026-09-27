import { Link } from 'react-router-dom';
import { passSummary, type DueLabel } from '@shared/homework';
import { KIND_ICON, titleParts, type HomeworkItem } from '../../services/homework';
import './homework.css';

/** "overdue" / "due today" / "due in 2 days" as a coloured chip. */
export function DueChip({ due, done = false }: { due: DueLabel; done?: boolean }) {
  if (done) return <span className="hw-chip hw-chip-done">done</span>;
  if (!due.text) return null;
  return <span className={`hw-chip hw-chip-${due.tone}`} data-testid="hw-due">{due.text}</span>;
}

const KIND_WORD: Record<string, string> = { lesson: 'mini lesson', reader: 'reader' };

/** One homework item: icon, title, progress line, due chip. Taps into the pass. */
export function HomeworkRow({ item, showTutor = false }: { item: HomeworkItem; showTutor?: boolean }) {
  const a = item.assignment;
  const pct = item.progress.total > 0 ? Math.round((item.progress.done / item.progress.total) * 100) : 0;
  const { base, part } = titleParts(a);
  const progress = a.kind === 'deck' ? passSummary(item.progress, 'deck') : item.done ? 'done' : KIND_WORD[a.kind] ?? a.kind;
  const detail = part ? `${part.replace(/^d/, 'D')} · ${progress}` : progress;
  return (
    <Link to={`/homework/${a.id}`} className={`hw-row${item.done ? ' hw-row-done' : ''}`} data-testid="hw-row">
      <span className="hw-row-icon" aria-hidden="true">{KIND_ICON[a.kind] ?? '📝'}</span>
      <span className="hw-row-main">
        <span className="hw-row-title" lang="zh">{base}</span>
        <span className="hw-row-meta">
          {detail}
          {a.mode === 'both' && !item.done ? ' · then long-term review' : ''}
          {showTutor && a.tutor_name ? ` · from ${a.tutor_name}` : ''}
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
