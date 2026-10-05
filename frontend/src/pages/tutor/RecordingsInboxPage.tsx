/**
 * Recordings — the tutor's "Needs your ear" queue (default) and All recordings.
 *
 * The queue holds only the recordings worth her time: the transcript didn't match
 * the card, a character sounded off (pronunciation scoring), the student rated it
 * Again / Hard, or flagged the card (rules: shared/recordings/queue.ts, served by
 * GET /api/relationships/:relId/recordings/queue). Each card plays the take next to
 * the reference clip, shows Expected vs Heard with the characters highlighted, and
 * takes a Listened / Needs work mark (+ an optional note shown to the student once),
 * which moves it out of the queue.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RecordingQueueItem, RecordingQueueResponse } from '@shared/recordings/queue';
import { getRecordingQueue, markRecording, clearRecordingMark } from '../../api/insights';
import type { RecordingMarkStatus } from '../../types/insights';
import type { CardType } from '../../types';
import { getAudioUrl } from '../../api/client';
import { useAudioPlayer } from '../../hooks/useAudio';
import { Loading } from '../../components/Loading';
import { TutorPageFrame, TutorPageNav, RatingDot, CardTypeChip, formatDateTime, toDateInputValue } from './tutor-shared';
import {
  expectedChars,
  heardChars,
  sortAllRecordings,
  withoutQueueItem,
  emptyQueueLine,
  shouldPoll,
  CHECKING_POLL_MS,
} from './recordingQueue';
import { track } from '../../services/analytics';
import './recording-queue.css';

type View = 'queue' | 'all';
type RangeKey = 'lesson' | '30d' | '90d' | '365d';
/** How long the card takes to slide out after a mark (matches recording-queue.css). */
const LEAVE_MS = 280;

export function RecordingsInboxPage() {
  const { relId } = useParams<{ relId: string }>();
  return (
    <TutorPageFrame relId={relId!} title="Recordings">
      {() => <InboxBody relId={relId!} />}
    </TutorPageFrame>
  );
}

function InboxBody({ relId }: { relId: string }) {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'all' ? 'all' : 'queue';
  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === 'all') next.set('view', 'all');
    else next.delete('view');
    setParams(next, { replace: true });
  };
  const [range, setRange] = useState<RangeKey>('30d');

  const rangeQuery = useMemo(() => {
    if (range === 'lesson') return {};
    const days = Number(range.replace('d', ''));
    return { from: toDateInputValue(new Date(Date.now() - days * 86_400_000)) };
  }, [range]);

  // Poll while recordings are still being checked, for a few minutes at most.
  const pollStart = useRef(Date.now());
  useEffect(() => {
    pollStart.current = Date.now();
  }, [view, range]);

  const queryKey = ['recordingQueue', relId, view, rangeQuery] as const;
  const queueQuery = useQuery({
    queryKey,
    queryFn: () => getRecordingQueue(relId, { ...rangeQuery, view }),
    refetchInterval: (q) =>
      shouldPoll(q.state.data?.counts.checking ?? 0, pollStart.current, Date.now()) ? CHECKING_POLL_MS : false,
  });
  const data = queueQuery.data;

  // One "opened" event per tab + range once its data is in.
  const tracked = useRef(new Set<string>());
  useEffect(() => {
    if (!data) return;
    const key = `${view}:${range}`;
    if (tracked.current.has(key)) return;
    tracked.current.add(key);
    track('tutor.recording_queue_open', { view, items: data.items.length, scoring: data.scoring });
  }, [data, view, range]);

  const items = useMemo(() => (data ? (view === 'all' ? sortAllRecordings(data.items) : data.items) : []), [data, view]);
  const counts = data?.counts;

  return (
    <>
      <TutorPageNav relId={relId} current="recordings" />

      <div className="rq-tabs" role="tablist" aria-label="Recordings">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'queue'}
          className={`rq-tab ${view === 'queue' ? 'active' : ''}`}
          onClick={() => setView('queue')}
          data-testid="rq-tab-queue"
        >
          Needs your ear{counts ? ` (${counts.queue})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'all'}
          className={`rq-tab ${view === 'all' ? 'active' : ''}`}
          onClick={() => setView('all')}
          data-testid="rq-tab-all"
        >
          All recordings{counts ? ` (${counts.all})` : ''}
        </button>
      </div>

      <div className="rq-toolbar">
        <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} aria-label="Range" className="rq-range">
          <option value="lesson">Since last lesson</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="365d">Last year</option>
        </select>
        {counts && counts.checking > 0 && (
          <span className="rq-checking" data-testid="rq-checking">
            <span className="rq-spinner" aria-hidden="true" /> {counts.checking} still being checked…
          </span>
        )}
      </div>

      {data && !data.scoring && (
        <p className="rq-muted-note">
          Pronunciation scoring isn't set up — the queue uses transcripts, ratings and flags.
        </p>
      )}

      {queueQuery.isLoading && <Loading message="Loading recordings..." />}
      {queueQuery.error && (
        <div className="tutor-error">{queueQuery.error instanceof Error ? queueQuery.error.message : 'Failed to load recordings'}</div>
      )}

      {data && items.length === 0 && (
        <div className="tutor-card rq-empty" data-testid="rq-empty">
          {view === 'queue' ? (
            <>
              <div className="rq-empty-line">{emptyQueueLine(data.counts.all)}</div>
              {data.counts.all > 0 && (
                <button type="button" className="rq-link-btn" onClick={() => setView('all')}>
                  See all recordings →
                </button>
              )}
            </>
          ) : (
            <div className="rq-empty-line">
              No recordings in this range. Recordings are made on the "Hanzi → meaning" card when the student taps the microphone.
            </div>
          )}
        </div>
      )}

      <div className="rq-list">
        {items.map((it) => (
          <RecordingCard key={it.event_id} relId={relId} item={it} view={view} queryKey={queryKey} />
        ))}
      </div>
    </>
  );
}

// ---------- One recording ----------

function RecordingCard({
  relId,
  item,
  view,
  queryKey,
}: {
  relId: string;
  item: RecordingQueueItem;
  view: View;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState(item.mark?.comment ?? '');
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ['recordingQueue', relId] });

  const markMutation = useMutation({
    mutationFn: (input: { status: RecordingMarkStatus; comment?: string | null }) => markRecording(relId, item.event_id, input),
    onMutate: () => {
      if (view !== 'queue') return;
      // Slide out at once; drop it from the cached queue when the animation ends.
      setLeaving(true);
      leaveTimer.current = window.setTimeout(() => {
        queryClient.setQueryData<RecordingQueueResponse>(queryKey, (old) => (old ? withoutQueueItem(old, item.event_id) : old));
      }, LEAVE_MS);
    },
    onSuccess: (_res, input) => {
      track('tutor.recording_mark', { status: input.status, source: view });
      setShowComment(false);
      // Let the slide-out finish before the refetch replaces the list.
      window.setTimeout(refreshAll, view === 'queue' ? LEAVE_MS + 50 : 0);
    },
    onError: () => {
      window.clearTimeout(leaveTimer.current);
      setLeaving(false);
      refreshAll();
    },
  });
  const clearMutation = useMutation({
    mutationFn: () => clearRecordingMark(relId, item.event_id),
    onSuccess: refreshAll,
  });

  const status = item.mark?.status ?? null;
  const busy = markMutation.isPending || clearMutation.isPending;
  const toggle = (next: RecordingMarkStatus) => {
    if (status === next) clearMutation.mutate();
    else markMutation.mutate({ status: next, comment: item.mark?.comment ?? null });
  };

  const check = item.check;
  const expected = expectedChars(item.note.hanzi, check?.weak_chars);
  const heardDifferent = check?.transcript_match === false && !!check.transcript?.trim();
  const heard = heardDifferent ? heardChars(check!.transcript, item.note.hanzi) : [];
  const hasWeak = expected.some((c) => c.kind);
  const score = check?.score != null ? Math.round(check.score) : null;
  const stateClass = !status ? (item.in_queue ? 'in-queue' : '') : status === 'needs_work' ? 'needs-work' : 'listened';

  return (
    <article
      className={`rq-card ${stateClass} ${leaving ? 'leaving' : ''}`}
      data-testid="rq-card"
      data-event-id={item.event_id}
      aria-busy={busy}
    >
      <div className="rq-head">
        <div className="rq-word">
          <span className="rq-hanzi" lang="zh">{item.note.hanzi}</span>
          <span className="rq-meaning">
            <span className="rq-pinyin">{item.note.pinyin}</span>
            <span className="rq-sep"> · </span>
            <span>{item.note.english}</span>
          </span>
          <span className="rq-deck">
            <CardTypeChip cardType={item.card_type as CardType} /> {item.note.deck_name} · {formatDateTime(item.reviewed_at)}
          </span>
        </div>
        <div className="rq-head-right">
          {score != null && (
            <span className={`rq-score ${score < 70 ? 'low' : score < 85 ? 'mid' : 'ok'}`} title="Pronunciation score (0–100)">
              {score}
            </span>
          )}
          <RatingDot rating={item.rating} withLabel />
        </div>
      </div>

      {(item.labels.length > 0 || (view === 'all' && item.in_queue)) && (
        <div className="rq-labels">
          {view === 'all' && item.in_queue && <span className="rq-label rq-label-queue">🎧 Needs your ear</span>}
          {item.labels.map((l) => (
            <span key={l} className={`rq-label ${labelTone(l)}`} data-testid="rq-label">{l}</span>
          ))}
        </div>
      )}

      <div className="rq-play-row">
        <PlayButton url={item.recording_url} label="Their recording" kind="take" />
        {item.note.audio_url && (
          <PlayButton
            url={item.note.audio_url}
            label="Reference"
            kind="ref"
            onPlay={() => track('tutor.recording_reference_play', { source: view })}
          />
        )}
      </div>

      {(hasWeak || heardDifferent) && (
        <div className="rq-compare">
          <div className="rq-compare-row">
            <span className="rq-compare-label">Expected</span>
            <span className="rq-compare-chars" lang="zh" data-testid="rq-expected">
              {expected.map((c, i) => (
                <span key={i} className={`rq-ch ${c.kind ? `rq-ch-${c.kind}` : ''}`} title={c.kind ? kindTitle(c.kind) : undefined}>
                  {c.ch}
                  {c.kind === 'tone' && <span className="rq-ch-tag">tone</span>}
                </span>
              ))}
            </span>
          </div>
          {heardDifferent && (
            <div className="rq-compare-row">
              <span className="rq-compare-label">Heard</span>
              <span className="rq-compare-chars" lang="zh" data-testid="rq-heard">
                {heard.map((c, i) => (
                  <span key={i} className={`rq-ch ${c.wrong ? 'rq-ch-heard-wrong' : ''}`}>{c.ch}</span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
      {check?.score_note && <div className="rq-note-line">{check.score_note}</div>}

      {item.flag && (
        <div className="rq-flag">
          <span aria-hidden="true">🚩</span> <span className="rq-flag-text">“{item.flag.message}”</span>
        </div>
      )}

      {item.mark?.comment && !showComment && <div className="tutor-comment-text">{item.mark.comment}</div>}

      <div className="rq-actions">
        <button
          type="button"
          className={`rq-mark-btn ${status === 'listened' ? 'active-listened' : ''}`}
          onClick={() => toggle('listened')}
          disabled={busy || leaving}
        >
          ✓ Listened
        </button>
        <button
          type="button"
          className={`rq-mark-btn ${status === 'needs_work' ? 'active-needs-work' : ''}`}
          onClick={() => toggle('needs_work')}
          disabled={busy || leaving}
        >
          ⚠ Needs work
        </button>
        <button type="button" className="rq-mark-btn rq-mark-note" onClick={() => setShowComment(!showComment)} disabled={leaving}>
          {item.mark?.comment ? 'Edit note' : '+ Note'}
        </button>
      </div>
      {showComment && (
        <div className="tutor-comment-box">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What to tell them — e.g. 银 is 2nd tone, yours sounds like 4th"
            aria-label="Note for the student"
          />
          <div className="rq-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm rq-save"
              disabled={busy}
              onClick={() => markMutation.mutate({ status: status ?? 'needs_work', comment: comment.trim() || null })}
            >
              {status === 'listened' ? 'Save note' : 'Needs work + note'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm rq-save" onClick={() => setShowComment(false)}>
              Cancel
            </button>
          </div>
          <div className="rq-hint">The note shows once on the back of this card the next time they study it.</div>
        </div>
      )}
      {(markMutation.error || clearMutation.error) && (
        <div className="tutor-error" style={{ marginTop: '0.5rem' }}>Could not save the mark. Try again.</div>
      )}
    </article>
  );
}

function PlayButton({ url, label, kind, onPlay }: { url: string; label: string; kind: 'take' | 'ref'; onPlay?: () => void }) {
  const { isPlaying, play, stop } = useAudioPlayer(getAudioUrl(url));
  return (
    <button
      type="button"
      className={`rq-play rq-play-${kind} ${isPlaying ? 'playing' : ''}`}
      onClick={() => {
        if (isPlaying) stop();
        else {
          play();
          onPlay?.();
        }
      }}
      aria-label={`${isPlaying ? 'Stop' : 'Play'} ${label.toLowerCase()}`}
    >
      <span aria-hidden="true">{isPlaying ? '⏹' : '▶'}</span> {label}
    </button>
  );
}

function kindTitle(kind: 'tone' | 'sound' | 'missing'): string {
  return kind === 'tone' ? 'The tone sounded off' : kind === 'sound' ? 'The sound was off' : 'Not heard';
}

/** Colour a reason chip by what it says (the server sends human lines). */
function labelTone(label: string): string {
  if (label.startsWith('Flagged')) return 'rq-label-flag';
  if (label.startsWith('Rated')) return 'rq-label-rating';
  if (label.startsWith('Heard') || label.startsWith('Nothing')) return 'rq-label-heard';
  return 'rq-label-score';
}

