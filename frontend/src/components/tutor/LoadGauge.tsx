import type { HomeworkLoad } from '@shared/homework';
import { shortDay } from '@shared/homework';
import './homework-tutor.css';

const LEVEL_TEXT: Record<HomeworkLoad['level'], string> = { light: 'Light', moderate: 'Moderate', heavy: 'Heavy' };

/**
 * How much the student already has on their plate: one-off homework pending
 * (and overdue), words still to come in long-term review, and the next week
 * day by day. With `after`, the same after this draft is assigned.
 */
export function LoadGauge({ load, after, studentName }: { load: HomeworkLoad; after?: HomeworkLoad | null; studentName: string }) {
  const max = Math.max(1, ...load.one_off.by_day.map((d) => d.words + d.items), ...(after?.one_off.by_day.map((d) => d.words + d.items) ?? []));
  return (
    <div className={`hwt-load hwt-load-${load.level}`} data-testid="load-gauge">
      <div className="hwt-load-head">
        <strong>{studentName}&rsquo;s load</strong>
        <span className={`hwt-level hwt-level-${load.level}`}>{LEVEL_TEXT[load.level]}</span>
        {after && after.level !== load.level && (
          <>
            <span aria-hidden="true">→</span>
            <span className={`hwt-level hwt-level-${after.level}`} title="After this homework">{LEVEL_TEXT[after.level]}</span>
          </>
        )}
      </div>
      <p className="hwt-load-summary">{load.summary}</p>
      {after && <p className="hwt-load-summary hwt-load-after">After this: {after.summary}</p>}
      <div className="hwt-week" aria-label="One-off homework due over the next week">
        {load.one_off.by_day.map((d, i) => {
          const a = after?.one_off.by_day[i];
          const now = d.words + d.items;
          const next = a ? a.words + a.items : now;
          return (
            <div key={d.date} className="hwt-day" title={`${shortDay(d.date)}: ${d.items} items, ${d.words} words${a ? ` → ${a.items} items, ${a.words} words` : ''}`}>
              <div className="hwt-day-bar">
                {next > now && <span className="hwt-day-added" style={{ height: `${(next / max) * 100}%` }} />}
                <span className="hwt-day-now" style={{ height: `${(now / max) * 100}%` }} />
              </div>
              <span className="hwt-day-label">{i === 0 ? 'Today' : shortDay(d.date).slice(0, 3)}</span>
            </div>
          );
        })}
      </div>
      {load.one_off.overdue_items > 0 && (
        <p className="hwt-load-overdue">
          {load.one_off.overdue_items} overdue{load.one_off.overdue_words ? ` (${load.one_off.overdue_words} words)` : ''} — consider cutting back.
        </p>
      )}
    </div>
  );
}
