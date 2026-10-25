import { libraryStatusText, statusTone, type LibraryStatus } from '@shared/homework';
import './homework-library.css';

/**
 * Completed green · Overdue red · due soon amber · In progress blue · Not started / In long-term review /
 * Skipped grey. A skipped item names who skipped it: "Skipped by Jerome" (docs/HOMEWORK.md §3d).
 */
export function StatusChip({ status, due, today, student }: { status: LibraryStatus; due: string | null; today: string; student?: string | null }) {
  return (
    <span className={`hl-status hl-tone-${statusTone(status, due, today)}`} data-testid="hl-status" data-status={status}>
      {libraryStatusText(status, student)}
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
