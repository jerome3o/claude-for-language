import { LIBRARY_KIND_ICONS, libraryDueText, mostRecentHomework, shortDay, statusTone, type LibraryItem } from '@shared/homework';
import { PercentBar, StatusChip } from './StatusChip';
import './homework-library.css';

/**
 * "Most recent homework" at the top of the student page (docs/HOMEWORK.md §9):
 * the newest item and whatever was sent with it — % complete, due date and the
 * status colour.
 */
export function RecentHomeworkCard({ items, today, onSeeAll, onSend }: { items: LibraryItem[]; today: string; onSeeAll: () => void; onSend?: () => void }) {
  const recent = mostRecentHomework(items);
  if (recent.length === 0) {
    return onSend ? (
      <section className="hl-recent hl-recent-empty" data-testid="recent-homework">
        <span>No homework sent yet.</span>
        <button type="button" className="btn-link" onClick={onSend}>Send homework</button>
      </section>
    ) : null;
  }
  return (
    <section className={`hl-recent hl-recent-${statusTone(recent[0].status, recent[0].due_date, today)}`} data-testid="recent-homework">
      <div className="hl-recent-head">
        <h2>Most recent homework</h2>
        {/* The student page's own Homework section, not the homework library (hidden from menus, Oct 2026) */}
        <button type="button" className="hl-recent-all btn-link" onClick={onSeeAll} data-testid="recent-homework-see-all">All homework ↓</button>
      </div>
      {recent.map((item) => (
        <div key={item.key} className="hl-recent-item" data-testid="recent-homework-item">
          <div className="hl-recent-line">
            <span aria-hidden="true">{LIBRARY_KIND_ICONS[item.kind]}</span>
            <span className="hl-recent-title" lang="zh">{item.title}</span>
            <StatusChip status={item.status} due={item.due_date} today={today} />
          </div>
          {/* A long-term deck has no end, so no % (docs/HOMEWORK.md §11) */}
          {item.status !== 'long_term' && (
            <div className="hl-recent-stats">
              <span className="hl-recent-pct">{item.percent}%</span>
              <PercentBar percent={item.percent} status={item.status} due={item.due_date} today={today} />
            </div>
          )}
          <div className="hl-recent-meta">
            {item.status === 'long_term'
              ? `${item.progress} · in their daily review`
              : item.status === 'completed'
              ? `Completed${item.completed_at ? ` ${shortDay(item.completed_at.slice(0, 10))}` : ''}${/^(done|read)$/.test(item.progress) ? '' : ` · ${item.progress}`}`
              : `${libraryDueText(item.due_date, today)} · ${item.progress}`}
            {item.student_note ? ` · “${item.student_note}”` : ''}
          </div>
        </div>
      ))}
    </section>
  );
}

/** The dashboard card's one line: newest item · % · status colour. */
export function RecentHomeworkLine({ item, today }: { item: LibraryItem; today: string }) {
  return (
    <span className="hl-recent-line-compact" data-testid="dashboard-recent-homework">
      <span aria-hidden="true">{LIBRARY_KIND_ICONS[item.kind]}</span>
      <span className="hl-recent-title" lang="zh">{item.title}</span>
      {item.status !== 'long_term' && <span className="hl-recent-pct">{item.percent}%</span>}
      <StatusChip status={item.status} due={item.due_date} today={today} />
    </span>
  );
}
