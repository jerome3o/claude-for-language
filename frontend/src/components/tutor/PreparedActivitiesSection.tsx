import { useState, type ReactNode } from 'react';
import { ACTIVITY_KIND_INFO, activityPreview, firstName, preparedHeadline, type PreparedActivity } from '@shared/call-activities';
import { usePreparedActivities, type PreparedSource } from '../../hooks/usePreparedActivities';
import { track } from '../../services/analytics';
import { shortDate } from './format';
import './prepared-activities.css';

/** What's inside one prepared activity: its summary and the words / lines / questions. */
export function PreparedPreview({ activity }: { activity: PreparedActivity }) {
  return (
    <div className="pa-preview" data-testid="prepared-preview">
      <p className="pa-preview-summary">{activity.spec.summary}</p>
      <ul>
        {activityPreview(activity.spec, 10).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** One prepared activity as a row: icon, title, why; tap opens the preview. */
export function PreparedRow({
  activity,
  source,
  action,
}: {
  activity: PreparedActivity;
  source: PreparedSource;
  /** The control at the row's end (Dismiss here, Start in the call). */
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const info = ACTIVITY_KIND_INFO[activity.spec.kind];
  const used = activity.status === 'used';
  return (
    <div className={`pa-row${used ? ' pa-row-used' : ''}`} data-testid="prepared-row" data-kind={activity.spec.kind} data-status={activity.status}>
      <div className="pa-row-top">
        <button
          type="button"
          className="pa-row-main"
          aria-expanded={open}
          onClick={() => {
            if (!open) track('tutor.prepared_activity_preview', { activity_kind: activity.spec.kind, source });
            setOpen(!open);
          }}
        >
          <span className="pa-icon" aria-hidden="true">{info.icon}</span>
          <span className="pa-text">
            <span className="pa-title">
              {activity.spec.title}
              {activity.spec.title_zh ? <span className="pa-zh"> · {activity.spec.title_zh}</span> : null}
            </span>
            <span className="pa-why">{activity.why}</span>
            {used && <span className="pa-used">✓ Used {shortDate(activity.used_at?.replace(' ', 'T'))}</span>}
          </span>
          <span className={`pa-chev${open ? ' pa-chev-open' : ''}`} aria-hidden="true">▾</span>
        </button>
        {action}
      </div>
      {open && <PreparedPreview activity={activity} />}
    </div>
  );
}

/**
 * "Ready for next lesson" on the tutor's student page: the activities prepared
 * for the next call from this student's previous lessons, with a preview,
 * Dismiss (+ Undo), and Prepare / Make more. Only the tutor sees them.
 */
export function PreparedActivitiesSection({ relId, studentName }: { relId: string; studentName: string }) {
  const { query, data, activities, ready, preparing, prepare, dismiss, restore } = usePreparedActivities(relId, { source: 'student_page' });
  const [undo, setUndo] = useState<PreparedActivity | null>(null);
  const [showUsed, setShowUsed] = useState(false);
  const used = activities.filter((a) => a.status === 'used');
  const job = data?.job ?? null;
  const from = ready[0]?.source_label;
  const name = firstName(studentName);

  return (
    <section className="detail-section pa-section" id="prepared-activities" data-testid="prepared-activities">
      <div className="pa-head">
        <h2>🎲 Ready for next lesson</h2>
        <span className="sp-private" title={`${name} only sees one once you start it in a call`}>
          <span aria-hidden="true">🔒</span> Only you see these
        </span>
      </div>

      {query.isLoading && <div className="sn-empty">Loading…</div>}
      {query.isError && <div className="td-error">Could not load the prepared activities</div>}

      {query.isSuccess && (
        <div className="pa-card">
          <p className="pa-headline" data-testid="prepared-headline">
            {preparedHeadline(ready.length)}
            {from ? <span className="pa-from"> · from {from}</span> : null}
          </p>
          {ready.length === 0 && !preparing && (
            <p className="pa-lead">
              Activities for your next call with {name}, written from your previous lessons — the new words, the corrections, what {name} keeps
              getting wrong and recent homework. They wait in the call’s <strong>⋯ → 🎲 Activities</strong>.
            </p>
          )}
          {ready.length > 0 && (
            <div className="pa-list">
              {ready.map((a) => (
                <PreparedRow
                  key={a.id}
                  activity={a}
                  source="student_page"
                  action={
                    <button
                      type="button"
                      className="pa-dismiss"
                      aria-label={`Dismiss ${a.spec.title}`}
                      title="Dismiss"
                      onClick={() => {
                        dismiss.mutate(a);
                        setUndo(a);
                      }}
                      data-testid="prepared-dismiss"
                    >
                      ✕
                    </button>
                  }
                />
              ))}
            </div>
          )}
          {undo && (
            <div className="pa-undo" role="status">
              Dismissed “{undo.spec.title}”
              <button
                type="button"
                className="pa-link"
                onClick={() => {
                  restore.mutate(undo);
                  setUndo(null);
                }}
              >
                Undo
              </button>
            </div>
          )}
          {preparing ? (
            <div className="pa-working" data-testid="prepared-working">
              <span className="sn-spinner" aria-hidden="true" /> Preparing activities from {name}’s last lessons… about a minute
            </div>
          ) : (
            <div className="pa-actions">
              <button
                type="button"
                className={`btn ${ready.length === 0 ? 'btn-primary' : 'btn-secondary'} sp-small`}
                disabled={prepare.isPending || data?.can_prepare === false}
                onClick={() => prepare.mutate()}
                data-testid="prepared-make"
              >
                {ready.length === 0 ? '🎲 Prepare activities for next lesson' : '↻ Make more'}
              </button>
              {ready.length > 0 && <span className="pa-hint">In your next call: ⋯ → 🎲 Activities</span>}
            </div>
          )}
          {job?.status === 'failed' && !preparing && <div className="td-error">Couldn’t prepare them: {job.error ?? 'something went wrong'}. Try again.</div>}
          {prepare.isError && <div className="td-error">{prepare.error instanceof Error ? prepare.error.message : 'Could not start'}</div>}
          {used.length > 0 && (
            <div className="pa-used-block">
              <button type="button" className="pa-link" aria-expanded={showUsed} onClick={() => setShowUsed(!showUsed)}>
                {showUsed ? 'Hide' : 'Show'} the {used.length} already used
              </button>
              {showUsed && (
                <div className="pa-list">
                  {used.slice(0, 12).map((a) => (
                    <PreparedRow key={a.id} activity={a} source="student_page" />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
