/**
 * "Activities" in a call: the bundled two-person activities
 * (shared/call-activities/catalogue.ts) grouped by kind. Picking one starts it
 * for both people.
 */

import { ACTIVITY_CATALOGUE, ACTIVITY_KIND_INFO, ACTIVITY_KINDS } from '@shared/call-activities';
import './activities.css';

const LEVEL: Record<string, string> = { beginner: 'Beginner', elementary: 'Elementary', intermediate: 'Intermediate' };

export function ActivityPickerSheet({ running, onPick, onClose }: { running: string | null; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="call-sheet-backdrop" onClick={onClose}>
      <div className="call-sheet act-sheet" role="dialog" aria-label="Activities" onClick={(e) => e.stopPropagation()} data-testid="activity-picker">
        <div className="pm-head">
          <h2>🎲 Activities for two</h2>
          <button type="button" className="call-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="call-muted">Short exercises you do together — both of you see it, each with your own part. The tutor runs it; the result is kept with the lesson.</p>
        {running && <p className="act-sheet-note">“{running}” is running — starting another ends it (its result is kept).</p>}
        <div className="act-sheet-list">
          {ACTIVITY_KINDS.map((kind) => {
            const info = ACTIVITY_KIND_INFO[kind];
            const items = ACTIVITY_CATALOGUE.filter((a) => a.kind === kind);
            if (items.length === 0) return null;
            return (
              <section key={kind} className="act-sheet-group">
                <h3><span aria-hidden="true">{info.icon}</span> {info.name} <span className="act-sheet-blurb">{info.blurb}</span></h3>
                {items.map((a) => (
                  <button key={a.id} type="button" className="pm-row act-sheet-row" onClick={() => onPick(a.id)} data-testid="activity-picker-row" data-activity={a.id}>
                    <span className="pm-main">
                      <span className="pm-title">{a.title}{a.title_zh ? <span className="act-sheet-zh"> · {a.title_zh}</span> : null}</span>
                      <span className="pm-meta"><span className="act-level">{LEVEL[a.level] ?? a.level}</span> {a.topic}</span>
                      <span className="act-sheet-summary">{a.summary}</span>
                    </span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
