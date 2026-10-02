/**
 * /calls — video calls (experimental): start a call with a tutor or student
 * (or a solo test call), and every past call with its transcript status.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { createCall, listCalls } from '../api/calls';
import { getMyRelationships } from '../api/client';
import { CLAUDE_AI_USER_ID, getOtherUserInRelationship } from '../types';
import type { CallListItem } from '../types/calls';
import { groupCallsByLesson } from '@shared/calls';
import './CallPage.css';
import './CallReviewPage.css';

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { timeStyle: 'short' });

/** One lesson: "2 Oct 2026, 12:31 · 57 min · 4 calls · notes ready". */
function lessonMeta(calls: CallListItem[]): string {
  const first = calls[0];
  const last = calls[calls.length - 1];
  if (calls.length === 1) return callMeta(first);
  const when = new Date(first.started_at ?? first.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const live = calls.some((c) => c.status === 'live');
  const span = !live && first.started_at && last.ended_at ? ` · ${Math.max(1, Math.round((last.ended_at - first.started_at) / 60_000))} min` : '';
  const notes = calls.some((c) => c.has_summary) ? ' · notes ready' : '';
  return `${when}${span} · ${calls.length} calls${notes}`;
}

function callMeta(c: CallListItem): string {
  const when = new Date(c.started_at ?? c.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (c.status === 'live') return when;
  const mins = c.started_at && c.ended_at ? ` · ${Math.max(1, Math.round((c.ended_at - c.started_at) / 60_000))} min` : '';
  const state = c.has_summary ? ' · notes ready' : c.processing_status === 'done' ? ' · transcript ready' : c.processing_status === 'failed' ? ' · processing failed' : c.processing_status === 'none' ? '' : ' · processing…';
  return `${when}${mins}${state}`;
}

export function CallsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const callsQuery = useQuery({ queryKey: ['calls'], queryFn: () => listCalls(), refetchInterval: 15_000 });
  const relsQuery = useQuery({ queryKey: ['relationships'], queryFn: getMyRelationships });
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const people = [...(relsQuery.data?.tutors ?? []), ...(relsQuery.data?.students ?? [])]
    .filter((r) => r.status === 'active')
    .map((r) => ({ rel: r, other: getOtherUserInRelationship(r, user!.id) }))
    .filter(({ other }) => other.id !== CLAUDE_AI_USER_ID);

  const start = async (relationshipId: string | null) => {
    setStarting(relationshipId ?? 'solo');
    setError(null);
    try {
      const { call } = await createCall({ relationship_id: relationshipId });
      navigate(`/calls/${call.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the call');
      setStarting(null);
    }
  };

  const calls = callsQuery.data?.calls ?? [];

  return (
    <div className="page">
      <div className="container">
        <h1>Video calls <span className="call-beta" style={{ verticalAlign: 'middle' }}>Beta</span></h1>
        <p className="calls-intro">
          Live lessons with video, a shared whiteboard, chat and screen sharing. Each person’s microphone is recorded, so afterwards you get a Chinese + English transcript, lesson notes and flashcards.
        </p>

        <section className="detail-section cr-section">
          <h2>Start a call</h2>
          <div className="calls-list">
            {people.map(({ rel, other }) => (
              <button
                key={rel.id}
                type="button"
                className="calls-row"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                disabled={starting !== null}
                onClick={() => void start(rel.id)}
              >
                <span className="calls-row-icon" aria-hidden="true">📹</span>
                <span className="calls-row-main">
                  <span className="calls-row-title">{other.name || other.email}</span>
                  <span className="calls-row-meta" style={{ display: 'block' }}>{starting === rel.id ? 'Starting…' : 'They get a Join link in your chat'}</span>
                </span>
              </button>
            ))}
            <button type="button" className="calls-row" style={{ textAlign: 'left', cursor: 'pointer' }} disabled={starting !== null} onClick={() => void start(null)}>
              <span className="calls-row-icon" aria-hidden="true">🧪</span>
              <span className="calls-row-main">
                <span className="calls-row-title">Test call on your own</span>
                <span className="calls-row-meta" style={{ display: 'block' }}>{starting === 'solo' ? 'Starting…' : 'Try the camera, whiteboard and a transcript'}</span>
              </span>
            </button>
          </div>
          {error && <p className="cr-error">{error}</p>}
        </section>

        <section className="detail-section cr-section">
          <h2>Past calls</h2>
          {callsQuery.isLoading ? (
            <p className="td-muted">Loading…</p>
          ) : calls.length === 0 ? (
            <p className="td-muted">No calls yet.</p>
          ) : (
            <div className="calls-list" data-testid="calls-list">
              {/* One entry per lesson (calls within 20 minutes of each other), its calls inside. */}
              {groupCallsByLesson(calls).map(({ lessonId, calls: group }) => {
                const live = group.find((c) => c.status === 'live');
                const head = live ?? group[group.length - 1];
                const title = group.find((c) => c.title)?.title || (head.other_user_name ? `Lesson with ${head.other_user_name}` : 'Test call');
                return (
                  <div key={lessonId} className="calls-lesson" data-testid="calls-lesson">
                    <Link to={live ? `/calls/${live.id}` : `/calls/${head.id}/review`} className="calls-row">
                      <span className="calls-row-icon" aria-hidden="true">{live ? '🔴' : group.some((c) => c.has_summary) ? '📝' : '📼'}</span>
                      <span className="calls-row-main">
                        <span className="calls-row-title">{title}</span>
                        <span className="calls-row-meta" style={{ display: 'block' }}>{lessonMeta(group)}</span>
                      </span>
                      {live ? <span className="calls-live-pill">LIVE</span> : <span className="td-chevron">›</span>}
                    </Link>
                    {group.length > 1 && (
                      <div className="calls-lesson-calls" aria-label="Calls in this lesson">
                        {group.map((c, i) => (
                          <span key={c.id} className="calls-lesson-call">
                            {i + 1}. {time(c.started_at ?? Date.parse(c.created_at.replace(' ', 'T') + 'Z'))}
                            {c.status === 'live' ? ' (live)' : c.started_at && c.ended_at ? `–${time(c.ended_at)}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default CallsListPage;
