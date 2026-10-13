/**
 * "Activities" in a call: first the ones prepared for this student from their
 * previous lessons (the tutor only — docs/VIDEO_CALLS.md "Prepared
 * activities"), then the bundled two-person activities
 * (shared/call-activities/catalogue.ts) grouped by kind. Picking one starts it
 * for both people.
 */

import { useState } from 'react';
import {
  ACTIVITY_CATALOGUE,
  ACTIVITY_KIND_INFO,
  ACTIVITY_KINDS,
  REVIEW_ACTIVITY_ID,
  activityPreview,
  preparedActivityId,
  preparedSectionTitle,
  type PreparedActivity,
} from '@shared/call-activities';
import { track } from '../../../services/analytics';
import './activities.css';

const LEVEL: Record<string, string> = { beginner: 'Beginner', elementary: 'Elementary', intermediate: 'Intermediate' };

/** The tutor's prepared activities for this call's student (absent for the student / a solo call). */
export interface PickerPrepared {
  studentName: string | null;
  /** Ordered (orderPrepared): ready first, then used. */
  activities: PreparedActivity[];
  loading: boolean;
  preparing: boolean;
  canPrepare: boolean;
  onMakeMore: () => void;
  error?: string | null;
}

function PreparedPickRow({ a, onPick }: { a: PreparedActivity; onPick: (id: string, a: PreparedActivity) => void }) {
  const [open, setOpen] = useState(false);
  const used = a.status === 'used';
  return (
    <div className={`act-prep-row${used ? ' used' : ''}`}>
      <div className="act-prep-top">
        <button type="button" className="pm-row act-sheet-row act-prep-start" onClick={() => onPick(preparedActivityId(a.id), a)} data-testid="activity-picker-row" data-activity={preparedActivityId(a.id)} data-prepared="1">
          <span className="act-prep-icon" aria-hidden="true">{ACTIVITY_KIND_INFO[a.spec.kind].icon}</span>
          <span className="pm-main">
            <span className="pm-title">
              {a.spec.title}
              {a.spec.title_zh ? <span className="act-sheet-zh"> · {a.spec.title_zh}</span> : null}
              {used && <span className="act-prep-used"> ✓ Used</span>}
            </span>
            <span className="act-prep-why">{a.why}</span>
          </span>
        </button>
        <button
          type="button"
          className="act-prep-peek"
          aria-expanded={open}
          aria-label={open ? 'Hide what’s in it' : 'What’s in it'}
          title="What’s in it"
          onClick={() => {
            if (!open) track('tutor.prepared_activity_preview', { activity_kind: a.spec.kind, source: 'call' });
            setOpen(!open);
          }}
        >
          {open ? '▴' : '👁'}
        </button>
      </div>
      {open && (
        <div className="act-prep-preview" data-testid="prepared-preview">
          <p>{a.spec.summary}</p>
          <ul>
            {activityPreview(a.spec, 8).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ActivityPickerSheet({
  running,
  onPick,
  onClose,
  prepared,
}: {
  running: string | null;
  onPick: (id: string, prepared?: PreparedActivity) => void;
  onClose: () => void;
  prepared?: PickerPrepared | null;
}) {
  const ready = prepared?.activities.filter((a) => a.status === 'ready') ?? [];
  const used = prepared?.activities.filter((a) => a.status === 'used') ?? [];
  const from = ready[0]?.source_label ?? used[0]?.source_label ?? null;
  return (
    <div className="call-sheet-backdrop" onClick={onClose}>
      <div className="call-sheet act-sheet" role="dialog" aria-label="Activities" onClick={(e) => e.stopPropagation()} data-testid="activity-picker">
        <div className="pm-head">
          <h2>🎲 Activities for two</h2>
          <button type="button" className="call-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="call-muted">Short exercises you do together — either of you can start one; both see it, each with your own part. The tutor can restart or swap roles; the result is kept with the lesson.</p>
        {running && <p className="act-sheet-note">“{running}” is running — starting another ends it (its result is kept).</p>}
        <div className="act-sheet-list">
          {prepared && (
            <section className="act-sheet-group act-prepared" data-testid="activity-picker-prepared">
              <h3>
                <span aria-hidden="true">⭐</span> {preparedSectionTitle(prepared.studentName)}
                <span className="act-sheet-blurb">{from ? `${from} · ` : ''}only you see this list</span>
              </h3>
              {prepared.loading && <p className="act-prep-empty">Loading…</p>}
              {!prepared.loading && ready.length === 0 && used.length === 0 && !prepared.preparing && (
                <p className="act-prep-empty">Nothing prepared yet — activities written from your last lessons with them (new words, corrections, mix-ups).</p>
              )}
              {[...ready, ...used.slice(0, 4)].map((a) => (
                <PreparedPickRow key={a.id} a={a} onPick={onPick} />
              ))}
              <div className="act-prep-foot">
                {prepared.preparing ? (
                  <span className="act-prep-working" data-testid="activity-picker-preparing">
                    <span className="act-dots" aria-hidden="true" /> Preparing from the last lessons… about a minute
                  </span>
                ) : (
                  <button type="button" className="act-secondary act-prep-more" onClick={prepared.onMakeMore} disabled={!prepared.canPrepare} data-testid="activity-picker-make-more">
                    {ready.length + used.length === 0 ? '🎲 Prepare from last lesson' : '↻ Make more'}
                  </button>
                )}
                {prepared.error && <span className="act-prep-error">{prepared.error}</span>}
              </div>
            </section>
          )}
          <section className="act-sheet-group">
            <h3><span aria-hidden="true">{ACTIVITY_KIND_INFO.review.icon}</span> {ACTIVITY_KIND_INFO.review.name} <span className="act-sheet-blurb">{ACTIVITY_KIND_INFO.review.blurb}</span></h3>
            <button type="button" className="pm-row act-sheet-row" onClick={() => onPick(REVIEW_ACTIVITY_ID)} data-testid="activity-picker-row" data-activity={REVIEW_ACTIVITY_ID}>
              <span className="pm-main">
                <span className="pm-title">Recordings &amp; flagged cards<span className="act-sheet-zh"> · 一起听</span></span>
                <span className="act-sheet-summary">What needs the tutor’s ear — every clip plays on both devices; the tutor marks Listened / Needs work.</span>
              </span>
            </button>
          </section>
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
