/**
 * /calls/:id/review — after a video call: the merged transcript (both
 * microphones, Chinese + English, pinyin and translation per line), Claude's
 * lesson report (summary, corrections, vocabulary → flashcards), the
 * whiteboard and the in-call chat. Polls while the call is being processed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { pinyin as toPinyin } from 'pinyin-pro';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE } from '../api/client';
import { deleteCall, getCall, makeCallFlashcards, processCall } from '../api/calls';
import { db } from '../db/database';
import { drainCallUploads } from '../services/calls/uploads';
import { BoardSnapshot } from '../components/calls/Whiteboard';
import { CallHomeworkSection } from '../components/calls/CallHomeworkSection';
import { getRelationship } from '../api/client';
import { getMyRoleInRelationship } from '../types';
import { formatOffset, groupTurns, type TranscriptSegment } from '@shared/calls';
import type { CallDetail, CallProcessingStatus, CallReportWord } from '../types/calls';
import './CallPage.css';
import './CallReviewPage.css';

const HAN = /[㐀-鿿]/;

const STATUS_TEXT: Record<CallProcessingStatus, string> = {
  none: 'Not processed yet',
  waiting_uploads: 'Waiting for recordings to finish uploading…',
  transcribing: 'Transcribing…',
  summarizing: 'Writing the lesson notes…',
  done: 'Ready',
  failed: 'Something went wrong',
};

const TRANSCRIBER_NAME: Record<string, string> = { gemini: 'Gemini', soniox: 'Soniox', whisper: 'Whisper (Workers AI)' };

function isBusy(detail: CallDetail | undefined): boolean {
  if (!detail) return false;
  const s = detail.call.processing_status;
  return detail.call.status === 'live' || s === 'waiting_uploads' || s === 'transcribing' || s === 'summarizing'
    || (detail.call.status === 'ended' && s === 'none' && detail.pieces.some((p) => p.status !== 'done' && p.status !== 'failed'));
}

function durationText(detail: CallDetail): string {
  const { started_at, ended_at } = detail.call;
  if (!started_at || !ended_at) return '';
  const min = Math.max(1, Math.round((ended_at - started_at) / 60_000));
  return `${min} min`;
}

function segPinyin(seg: TranscriptSegment): string | null {
  if (seg.pinyin) return seg.pinyin;
  if (!HAN.test(seg.text)) return null;
  try {
    return toPinyin(seg.text, { toneType: 'symbol', nonZh: 'consecutive' });
  } catch {
    return null;
  }
}

function WordPicker({ callId, words, startedAt }: { callId: string; words: CallReportWord[]; startedAt: number | null }) {
  const navigate = useNavigate();
  const decks = useLiveQuery(() => db.decks.toArray(), []);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(words.map((_, i) => i)));
  const [deckId, setDeckId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ deck_id: string; created: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultName = `Lesson ${new Date(startedAt ?? Date.now()).toISOString().slice(0, 10)}`;

  const toggle = (i: number) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await makeCallFlashcards(callId, {
        deck_id: deckId || undefined,
        deck_name: deckId ? undefined : defaultName,
        words: words.filter((_, i) => picked.has(i)),
      });
      setResult({ deck_id: r.deck_id, created: r.created, failed: r.failed.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the cards');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="cr-result" role="status">
        ✅ Added {result.created} word{result.created === 1 ? '' : 's'}{result.failed ? ` (${result.failed} skipped)` : ''}.{' '}
        <button type="button" className="cr-link" onClick={() => navigate(`/decks/${result.deck_id}`)}>Open the deck ›</button>
      </div>
    );
  }

  return (
    <div className="cr-words">
      {words.map((w, i) => (
        <label key={w.hanzi} className={`cr-word${picked.has(i) ? ' picked' : ''}`}>
          <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
          <span className="cr-word-main">
            <span className="cr-word-hanzi" lang="zh">{w.hanzi}</span>
            <span className="cr-word-pinyin">{w.pinyin}</span>
            <span className="cr-word-english">{w.english}</span>
            {w.from_call && <span className="cr-word-from" lang="zh">“{w.from_call}”</span>}
          </span>
        </label>
      ))}
      <div className="cr-words-save">
        <select value={deckId} onChange={(e) => setDeckId(e.target.value)} aria-label="Deck">
          <option value="">New deck: {defaultName}</option>
          {(decks ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0} onClick={() => void save()} data-testid="make-cards">
          {busy ? 'Adding…' : `Add ${picked.size} card${picked.size === 1 ? '' : 's'}`}
        </button>
      </div>
      {error && <div className="cr-error">{error}</div>}
    </div>
  );
}

export function CallReviewPage() {
  const { id } = useParams<{ id: string }>();
  const callId = id!;
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['call', callId],
    queryFn: () => getCall(callId),
    // The call page cached this key before the call; never show that stale copy.
    refetchOnMount: 'always',
    refetchInterval: (q) => (isBusy(q.state.data) ? 5000 : false),
  });
  const pendingLocal = useLiveQuery(() => db.callUploads.where('call_id').equals(callId).count(), [callId]) ?? 0;
  const [showPinyin, setShowPinyin] = useState(true);
  const [showEnglish, setShowEnglish] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Keep pushing this device's leftover recording while the page is open.
  useEffect(() => {
    if (pendingLocal === 0) return;
    const t = setInterval(() => void drainCallUploads(), 5000);
    void drainCallUploads();
    return () => clearInterval(t);
  }, [pendingLocal]);

  const detail = query.data;
  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of detail?.participants ?? []) map[p.id] = p.id === user?.id ? 'You' : p.name || p.email.split('@')[0];
    return map;
  }, [detail, user]);
  const turns = useMemo(() => groupTurns(detail?.transcript ?? []), [detail]);
  const pieces = useMemo(() => new Map((detail?.pieces ?? []).map((p) => [p.id, p])), [detail]);
  const relId = detail?.call.relationship_id ?? null;
  const relQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
    staleTime: 60_000,
  });
  const iAmTutor = !!relQuery.data && !!user && getMyRoleInRelationship(relQuery.data, user.id) === 'tutor';

  if (query.isLoading) return <div className="page"><div className="container"><p>Loading…</p></div></div>;
  if (query.error || !detail) {
    return (
      <div className="page"><div className="container">
        <p>Call not found.</p>
        <Link to="/calls" className="btn btn-secondary">All calls</Link>
      </div></div>
    );
  }

  const { call, report } = detail;
  const startMs = call.started_at ?? detail.transcript[0]?.start_ms ?? 0;
  const other = detail.participants.find((p) => p.id !== user?.id);
  const title = call.title || (other ? `Lesson with ${other.name || other.email.split('@')[0]}` : 'Video call');
  const failedPieces = detail.pieces.filter((p) => p.status === 'failed');
  const providers = [...new Set(detail.pieces.map((p) => p.provider).filter(Boolean) as string[])];

  const play = (seg: TranscriptSegment) => {
    const piece = pieces.get(seg.piece_id);
    const audio = audioRef.current;
    if (!piece?.audio_url || !audio) return;
    if (playing === seg.id) {
      audio.pause();
      setPlaying(null);
      return;
    }
    const src = new URL(`${API_BASE}${piece.audio_url}`, window.location.href).href;
    const offset = Math.max(0, (seg.start_ms - piece.started_at) / 1000 - 0.3);
    const until = (seg.end_ms - piece.started_at) / 1000 + 0.4;
    const start = () => {
      audio.currentTime = offset;
      void audio.play().catch(() => setPlaying(null));
    };
    audio.ontimeupdate = () => {
      if (audio.currentTime >= until) {
        audio.pause();
        setPlaying(null);
      }
    };
    audio.onended = () => setPlaying(null);
    setPlaying(seg.id);
    if (audio.src !== src) {
      audio.src = src;
      audio.onloadedmetadata = start;
      audio.load();
    } else {
      start();
    }
  };

  const reprocess = async () => {
    setActionBusy(true);
    try {
      await processCall(callId);
      await queryClient.invalidateQueries({ queryKey: ['call', callId] });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not start processing');
    } finally {
      setActionBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this call, its recording and transcript? This cannot be undone.')) return;
    setActionBusy(true);
    try {
      await deleteCall(callId);
      navigate('/calls', { replace: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete the call');
      setActionBusy(false);
    }
  };

  return (
    <div className="page cr-page">
      <div className="container">
        <div className="td-topbar">
          <Link to="/calls" className="back-link">‹ Calls</Link>
        </div>
        <h1 className="cr-title">{title}</h1>
        <div className="cr-meta">
          {new Date(call.started_at ?? call.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          {durationText(detail) && ` · ${durationText(detail)}`}
          <span className="call-beta cr-beta">Beta</span>
        </div>

        {call.status === 'live' && (
          <div className="cr-banner">
            <span>This call is live.</span>
            <Link to={`/calls/${callId}`} className="btn btn-primary">Join</Link>
          </div>
        )}

        {pendingLocal > 0 && (
          <div className="cr-banner muted" role="status">
            <span>Your recording is still uploading from this device ({pendingLocal} part{pendingLocal === 1 ? '' : 's'} left).</span>
          </div>
        )}

        {call.status === 'ended' && call.processing_status !== 'done' && (
          <div className={`cr-status${call.processing_status === 'failed' ? ' failed' : ''}`} data-testid="call-processing-status">
            {isBusy(detail) && <span className="cr-spinner" aria-hidden="true" />}
            <span>{STATUS_TEXT[call.processing_status]}</span>
            {call.processing_error && <span className="cr-status-error">{call.processing_error}</span>}
          </div>
        )}

        {report && (
          <>
            <section className="detail-section cr-section">
              <h2>Summary</h2>
              <p className="cr-summary">{report.summary}</p>
              {report.topics.length > 0 && (
                <div className="cr-topics">{report.topics.map((t) => <span key={t} className="cr-topic">{t}</span>)}</div>
              )}
            </section>

            {report.corrections.length > 0 && (
              <section className="detail-section cr-section">
                <h2>Corrections</h2>
                <ul className="cr-corrections">
                  {report.corrections.map((c, i) => (
                    <li key={i}>
                      <div className="cr-said" lang="zh"><s>{c.said}</s></div>
                      <div className="cr-better" lang="zh">✓ {c.better}</div>
                      {c.pinyin && <div className="cr-word-pinyin">{c.pinyin}</div>}
                      <div className="cr-explain">{c.explanation}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {report.vocabulary.length > 0 && (
              <section className="detail-section cr-section">
                <h2>Words from the lesson</h2>
                <WordPicker callId={callId} words={report.vocabulary} startedAt={call.started_at} />
              </section>
            )}

            {report.follow_ups.length > 0 && (
              <section className="detail-section cr-section">
                <h2>Before next time</h2>
                <ul className="cr-followups">{report.follow_ups.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </section>
            )}
          </>
        )}

        {iAmTutor && relId && (
          <CallHomeworkSection
            callId={callId}
            relId={relId}
            studentName={other?.name || other?.email.split('@')[0] || 'the student'}
            ready={call.status === 'ended' && !isBusy(detail)}
          />
        )}

        <section className="detail-section cr-section">
          <div className="cr-transcript-head">
            <h2>Transcript</h2>
            <div className="cr-toggles">
              <button type="button" className={`cr-toggle${showPinyin ? ' on' : ''}`} onClick={() => setShowPinyin((v) => !v)} aria-pressed={showPinyin}>拼音</button>
              <button type="button" className={`cr-toggle${showEnglish ? ' on' : ''}`} onClick={() => setShowEnglish((v) => !v)} aria-pressed={showEnglish}>EN</button>
            </div>
          </div>
          {turns.length === 0 ? (
            <p className="td-muted">
              {call.status === 'live' ? 'The transcript appears after the call.' : isBusy(detail) ? 'Working on it…' : 'No speech was transcribed for this call.'}
            </p>
          ) : (
            <div className="cr-transcript" data-testid="call-transcript">
              {turns.map((turn) => {
                const first = turn[0];
                const mine = first.user_id === user?.id;
                return (
                  <div key={first.id} className={`cr-turn${mine ? ' mine' : ''}`}>
                    <div className="cr-turn-head">
                      <span className="cr-speaker">{names[first.user_id] || 'Speaker'}</span>
                      <span className="cr-time">{formatOffset(first.start_ms - startMs)}</span>
                    </div>
                    {turn.map((seg) => {
                      const py = showPinyin ? segPinyin(seg) : null;
                      const canPlay = !!pieces.get(seg.piece_id)?.audio_url;
                      return (
                        <div key={seg.id} className="cr-seg">
                          {canPlay && (
                            <button type="button" className={`cr-play${playing === seg.id ? ' on' : ''}`} onClick={() => play(seg)} aria-label="Play this line">
                              {playing === seg.id ? '❚❚' : '▶'}
                            </button>
                          )}
                          <div className="cr-seg-body">
                            <div className="cr-seg-text" lang="zh">{seg.text}</div>
                            {py && <div className="cr-seg-pinyin">{py}</div>}
                            {showEnglish && seg.translation && <div className="cr-seg-english">{seg.translation}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {providers.length > 0 && (
            <p className="cr-provider">Transcribed with {providers.map((p) => TRANSCRIBER_NAME[p] || p).join(' + ')} — speech recognition can mishear, especially mixed Chinese and English.</p>
          )}
        </section>

        {detail.board.length > 0 && (
          <section className="detail-section cr-section">
            <h2>Whiteboard</h2>
            <BoardSnapshot items={detail.board} />
          </section>
        )}

        {detail.chat.length > 0 && (
          <section className="detail-section cr-section">
            <h2>Chat</h2>
            <div className="cr-chat">
              {detail.chat.map((m) => (
                <div key={m.id} className="cr-chat-row">
                  <span className="cr-speaker">{names[m.user_id] || m.name}</span>
                  <span className="cr-time">{formatOffset(m.at - startMs)}</span>
                  <div lang="zh">{m.text}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {call.status === 'ended' && (
          <section className="detail-section cr-section cr-actions">
            {failedPieces.length > 0 && <p className="cr-error">{failedPieces.length} part{failedPieces.length === 1 ? '' : 's'} of the recording failed to transcribe: {failedPieces[0].error}</p>}
            <button type="button" className="btn btn-secondary" disabled={actionBusy || isBusy(detail)} onClick={() => void reprocess()}>
              {report ? 'Transcribe & summarise again' : 'Process now'}
            </button>
            {call.created_by === user?.id && (
              <button type="button" className="btn btn-danger-outline" disabled={actionBusy} onClick={() => void remove()}>Delete call</button>
            )}
          </section>
        )}
        <audio ref={audioRef} preload="none" />
      </div>
    </div>
  );
}

export default CallReviewPage;
