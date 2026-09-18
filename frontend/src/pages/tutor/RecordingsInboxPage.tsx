/**
 * Recordings inbox — every pronunciation recording the student made in the
 * range, unlistened first, with Listened / Needs work marks and an optional
 * comment per recording.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getStudentInsights, markRecording, clearRecordingMark } from '../../api/insights';
import type { InsightRecording, RecordingMarkStatus } from '../../types/insights';
import { Loading } from '../../components/Loading';
import {
  TutorPageFrame,
  TutorPageNav,
  RatingDot,
  CardTypeChip,
  RecordingButton,
  formatDateTime,
  toDateInputValue,
} from './tutor-shared';

type Filter = 'all' | 'unlistened' | 'needs_work';
type RangeKey = 'lesson' | '30d' | '90d' | '365d';

export function RecordingsInboxPage() {
  const { relId } = useParams<{ relId: string }>();
  return (
    <TutorPageFrame relId={relId!} title="Recordings">
      {() => <InboxBody relId={relId!} />}
    </TutorPageFrame>
  );
}

function InboxBody({ relId }: { relId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [range, setRange] = useState<RangeKey>('30d');

  const query = useMemo(() => {
    if (range === 'lesson') return {};
    const days = Number(range.replace('d', ''));
    return { from: toDateInputValue(new Date(Date.now() - days * 86_400_000)) };
  }, [range]);

  const insightsQuery = useQuery({
    queryKey: ['studentInsights', relId, query],
    queryFn: () => getStudentInsights(relId, query),
  });

  const recordings = insightsQuery.data?.recordings ?? [];
  const sorted = useMemo(() => {
    // Unlistened first (newest first within each group), then needs work, then listened.
    const order = (r: InsightRecording) => (!r.mark ? 0 : r.mark.status === 'needs_work' ? 1 : 2);
    return [...recordings].sort((a, b) => order(a) - order(b) || (a.reviewed_at < b.reviewed_at ? 1 : -1));
  }, [recordings]);
  const visible = sorted.filter((r) =>
    filter === 'all' ? true : filter === 'unlistened' ? !r.mark : r.mark?.status === 'needs_work'
  );
  const unlistenedCount = recordings.filter((r) => !r.mark).length;
  const needsWorkCount = recordings.filter((r) => r.mark?.status === 'needs_work').length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['studentInsights', relId] });

  return (
    <>
      <TutorPageNav relId={relId} current="recordings" />

      <div className="tutor-range" role="group" aria-label="Filter">
        {(
          [
            ['all', `All (${recordings.length})`],
            ['unlistened', `Unlistened (${unlistenedCount})`],
            ['needs_work', `Needs work (${needsWorkCount})`],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button key={key} type="button" className={`tutor-range-chip ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          aria-label="Range"
          style={{ marginLeft: 'auto', minHeight: 40, borderRadius: 999, padding: '0 0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.8125rem' }}
        >
          <option value="lesson">Since last lesson</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="365d">Last year</option>
        </select>
      </div>

      {insightsQuery.isLoading && <Loading message="Loading recordings..." />}
      {insightsQuery.error && (
        <div className="tutor-error">{insightsQuery.error instanceof Error ? insightsQuery.error.message : 'Failed to load recordings'}</div>
      )}

      {insightsQuery.data && visible.length === 0 && (
        <div className="tutor-card tutor-empty">
          {recordings.length === 0 ? 'No recordings in this period. Recordings are made on the "Hanzi → meaning" card when the student taps the microphone.' : 'Nothing here for this filter.'}
        </div>
      )}

      <div className="tutor-word-list">
        {visible.map((r) => (
          <InboxRow key={r.event_id} relId={relId} rec={r} onChanged={invalidate} />
        ))}
      </div>
    </>
  );
}

function InboxRow({ relId, rec, onChanged }: { relId: string; rec: InsightRecording; onChanged: () => void }) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState(rec.mark?.comment ?? '');

  const markMutation = useMutation({
    mutationFn: (input: { status: RecordingMarkStatus; comment?: string | null }) => markRecording(relId, rec.event_id, input),
    onSuccess: () => {
      setShowComment(false);
      onChanged();
    },
  });
  const clearMutation = useMutation({
    mutationFn: () => clearRecordingMark(relId, rec.event_id),
    onSuccess: onChanged,
  });

  const status = rec.mark?.status ?? null;
  const rowClass = !status ? 'unlistened' : status === 'needs_work' ? 'needs-work' : '';

  const toggle = (next: RecordingMarkStatus) => {
    if (status === next) clearMutation.mutate();
    else markMutation.mutate({ status: next, comment: rec.mark?.comment ?? null });
  };

  return (
    <div className={`tutor-inbox-row ${rowClass}`}>
      <div className="tutor-word-main">
        <RecordingButton url={rec.recording_url} />
        <span className="tutor-word-hanzi">{rec.note.hanzi}</span>
        <div className="tutor-word-meta">
          <span className="tutor-word-pinyin">{rec.note.pinyin}</span>
          <span className="tutor-word-english">{rec.note.english}</span>
        </div>
        <div className="tutor-word-right">
          <RatingDot rating={rec.rating} />
        </div>
      </div>
      <div className="tutor-word-details">
        <CardTypeChip cardType={rec.card_type} />
        <span className="tutor-word-deck">{formatDateTime(rec.reviewed_at)} · {rec.note.deck_name}</span>
      </div>
      {rec.mark?.comment && !showComment && <div className="tutor-comment-text">{rec.mark.comment}</div>}
      <div className="tutor-inbox-actions">
        <button
          type="button"
          className={`tutor-mark-btn ${status === 'listened' ? 'active-listened' : ''}`}
          onClick={() => toggle('listened')}
          disabled={markMutation.isPending || clearMutation.isPending}
        >
          ✓ Listened
        </button>
        <button
          type="button"
          className={`tutor-mark-btn ${status === 'needs_work' ? 'active-needs-work' : ''}`}
          onClick={() => toggle('needs_work')}
          disabled={markMutation.isPending || clearMutation.isPending}
        >
          ⚠ Needs work
        </button>
        <button type="button" className="tutor-mark-btn" onClick={() => setShowComment(!showComment)}>
          {rec.mark?.comment ? 'Edit note' : '+ Note'}
        </button>
      </div>
      {showComment && (
        <div className="tutor-comment-box">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What to tell them — e.g. second tone sounds like fourth"
          />
          <div className="tutor-inbox-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={markMutation.isPending}
              onClick={() => markMutation.mutate({ status: status ?? 'needs_work', comment: comment.trim() || null })}
            >
              Save note
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowComment(false)}>Cancel</button>
          </div>
        </div>
      )}
      {(markMutation.error || clearMutation.error) && (
        <div className="tutor-error" style={{ marginTop: '0.5rem' }}>Could not save the mark. Try again.</div>
      )}
    </div>
  );
}
