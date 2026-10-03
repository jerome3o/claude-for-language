import { LIBRARY_STATUS_LABELS, statusTone, type LibraryStatus } from '@shared/homework';
import './homework-library.css';

/** Completed green · Overdue red · due soon amber · In progress blue · Not started grey. */
export function StatusChip({ status, due, today }: { status: LibraryStatus; due: string | null; today: string }) {
  return (
    <span className={`hl-status hl-tone-${statusTone(status, due, today)}`} data-testid="hl-status" data-status={status}>
      {LIBRARY_STATUS_LABELS[status]}
    </span>
  );
}

/** A thin progress bar in the status colour. */
export function PercentBar({ percent, status, due, today }: { percent: number; status: LibraryStatus; due: string | null; today: string }) {
  return (
    <span className={`hl-bar hl-tone-${statusTone(status, due, today)}`} aria-hidden="true">
      <span style={{ width: `${Math.max(percent, percent > 0 ? 4 : 0)}%` }} />
    </span>
  );
}
