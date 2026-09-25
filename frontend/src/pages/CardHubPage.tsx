import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyNoteHub, getStudentNoteHub } from '../api/cardFlags';
import { getMyRelationships, getRelationship, API_BASE } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useNoteAudio } from '../hooks/useAudio';
import { Loading, ErrorMessage } from '../components/Loading';
import { CardFlagsList } from '../components/cardFlags/CardFlagsList';
import { ClaudeThreadList, toThreads } from '../components/cardFlags/ClaudeThreads';
import { claudeChatsPath } from '../components/cardFlags/paths';
import { humanTutors, queueCardFlag, type RememberedTutor } from '../services/cardFlags';
import { RatingDot, CardTypeChip, AnswerDiff, RecordingButton, CARD_TYPE_SHORT } from './tutor/tutor-shared';
import { relativeDay, shortDateTime, plural } from '../components/tutor/format';
import { getOtherUserInRelationship, type CardType } from '../types';
import type { NoteHub, NoteHubCard } from '../types/cardFlags';
import '../components/cardFlags/cardFlags.css';

function queueLabel(card: NoteHubCard): string {
  if (card.queue === 0) return 'New';
  if (card.queue === 2) return 'Review';
  return 'Learning';
}

function nextReview(card: NoteHubCard): string {
  if (card.queue === 0 || !card.next_review_at) return 'not started';
  const t = new Date(card.next_review_at).getTime();
  const days = Math.round((t - Date.now()) / 86_400_000);
  if (days <= 0) return 'due now';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

/**
 * One card, everything about it: the note, how each of its three cards is
 * doing, the flags on it (with the tutor's reply / reply box), every
 * Ask-Claude conversation about it, and the recent reviews. Two routes:
 *   /cards/:noteId                       the student's own card
 *   /connections/:relId/cards/:noteId    the tutor's view of a student's card
 */
export function CardHubPage() {
  const { relId, noteId } = useParams<{ relId?: string; noteId: string }>();
  const { user } = useAuth();
  const tutorView = !!relId;
  const role = tutorView ? 'tutor' : 'student';

  const hubQuery = useQuery({
    queryKey: ['note-hub', relId ?? 'me', noteId],
    queryFn: () => (relId ? getStudentNoteHub(relId, noteId!) : getMyNoteHub(noteId!)),
    enabled: !!noteId,
  });

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: tutorView,
  });

  if (hubQuery.isLoading) return <Loading />;
  if (hubQuery.error || !hubQuery.data) {
    return (
      <div className="page"><div className="container"><ErrorMessage message={hubQuery.error instanceof Error ? hubQuery.error.message : 'Card not found'} /></div></div>
    );
  }
  const hub = hubQuery.data;
  const studentName = tutorView && relationshipQuery.data && user ? getOtherUserInRelationship(relationshipQuery.data, user.id).name : null;
  const backTo = tutorView ? `/connections/${relId}` : `/decks/${hub.deck.id}`;
  const backLabel = tutorView ? `‹ ${studentName || 'Student'}` : `‹ ${hub.deck.name}`;

  return (
    <div className="page">
      <div className="container">
        <Link to={backTo} className="back-link">{backLabel}</Link>
        <HubCardBox hub={hub} relId={relId ?? null} />

        <section className="detail-section">
          <h2>{tutorView ? 'How the cards are going' : 'Your cards'}</h2>
          <div className="hub-cards">
            {hub.cards.map((c) => (
              <div key={c.id} className="hub-card-state" title={`${queueLabel(c)} · ${c.lapses} lapses`}>
                {CARD_TYPE_SHORT[c.card_type as CardType] ?? c.card_type}
                <strong>{queueLabel(c)}</strong>
                {nextReview(c)}
              </div>
            ))}
          </div>
        </section>

        <section className="detail-section" id="flags">
          <h2>🚩 Flags{hub.flags.length > 0 ? ` (${hub.flags.length})` : ''}</h2>
          <CardFlagsList
            flags={hub.flags}
            role={role}
            relId={relId}
            showCard={false}
            emptyText={tutorView ? `${studentName || 'The student'} has not flagged this card.` : 'You have not flagged this card for your tutor.'}
            onChanged={() => hubQuery.refetch()}
          />
          {!tutorView && <HubFlagForm hub={hub} onSent={() => hubQuery.refetch()} />}
        </section>

        <section className="detail-section">
          <h2>💬 Asked Claude{hub.questions.length > 0 ? ` (${plural(hub.questions.length, 'question')})` : ''}</h2>
          <ClaudeThreadList
            threads={toThreads(hub.questions)}
            relId={relId}
            showCard={false}
            emptyText={tutorView ? `${studentName || 'The student'} has not asked Claude about this card.` : 'You have not asked Claude about this card yet. Use Ask Claude on the card during study.'}
            initiallyOpen
          />
          <p className="hub-more"><Link to={claudeChatsPath(relId)}>All conversations with Claude ›</Link></p>
        </section>

        <section className="detail-section">
          <h2>Recent reviews{hub.review_count > 0 ? ` (${hub.review_count})` : ''}</h2>
          {hub.recent_reviews.length === 0 ? (
            <div className="cf-empty">Not reviewed yet.</div>
          ) : (
            <ul className="hub-reviews">
              {hub.recent_reviews.map((r) => (
                <li key={r.id} className="hub-review">
                  <RatingDot rating={r.rating} withLabel />
                  <CardTypeChip cardType={r.card_type} />
                  {r.user_answer && r.card_type !== 'hanzi_to_meaning' && (
                    <span className="hub-review-answer"><AnswerDiff userAnswer={r.user_answer} correctAnswer={hub.note.hanzi} /></span>
                  )}
                  <span className="hub-review-when" title={shortDateTime(r.reviewed_at)}>{relativeDay(r.reviewed_at)}</span>
                  {r.recording_url && <RecordingButton url={r.recording_url} compact />}
                </li>
              ))}
            </ul>
          )}
          {hub.review_count > hub.recent_reviews.length && (
            <p className="hub-more">Showing the last {hub.recent_reviews.length} of {hub.review_count}.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function HubCardBox({ hub, relId }: { hub: NoteHub; relId: string | null }) {
  const noteAudio = useNoteAudio();
  const n = hub.note;
  return (
    <div className="hub-card" data-testid="card-hub">
      <div className="hub-hanzi" lang="zh">{n.hanzi}</div>
      <div className="hub-pinyin">{n.pinyin}</div>
      <div className="hub-english">{n.english}</div>
      {n.sentence_clue && (
        <div className="hub-sentence" lang="zh">
          {n.sentence_clue}
          {n.sentence_clue_pinyin && <div className="hub-sentence-pinyin">{n.sentence_clue_pinyin}</div>}
          {n.sentence_clue_translation && <div className="hub-sentence-translation">{n.sentence_clue_translation}</div>}
        </div>
      )}
      {n.fun_facts && <div className="hub-fun-facts">{n.fun_facts}</div>}
      <div className="hub-actions">
        {n.audio_url && (
          <button type="button" className="btn btn-secondary" onClick={() => noteAudio.play(n.audio_url, n.hanzi, API_BASE)}>
            {noteAudio.isPlaying ? '⏹ Stop' : '▶ Play'}
          </button>
        )}
      </div>
      <div className="hub-deck">
        {relId ? <>Deck: {hub.deck.name}{hub.owner.name ? ` · ${hub.owner.name}'s copy` : ''}</> : <>Deck: <Link to={`/decks/${hub.deck.id}`}>{hub.deck.name}</Link></>}
      </div>
    </div>
  );
}

/** The student flags this card from its page (same queue as the study sheet). */
function HubFlagForm({ hub, onSent }: { hub: NoteHub; onSent: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const relationshipsQuery = useQuery({ queryKey: ['relationships'], queryFn: getMyRelationships, staleTime: 5 * 60_000 });
  const tutors: RememberedTutor[] = useMemo(
    () => (relationshipsQuery.data && user ? humanTutors(relationshipsQuery.data.tutors, user.id) : []),
    [relationshipsQuery.data, user]
  );
  const [open, setOpen] = useState(false);
  const [relId, setRelId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (tutors.length === 0) return null;
  const tutor = tutors.find((t) => t.relationship_id === relId) ?? tutors[0];

  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await queueCardFlag({ relationship_id: tutor.relationship_id, tutor_name: tutor.name, note_id: hub.note.id, card_id: null, hanzi: hub.note.hanzi, message });
      setMessage('');
      setOpen(false);
      setNote(r.sent ? `Sent to ${tutor.name}.` : `Saved — it goes to ${tutor.name} when you're back online.`);
      qc.invalidateQueries({ queryKey: ['card-flags'] });
      onSent();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not send the flag');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hub-flag-form">
      {note && <div className="cf-empty" role="status">{note}</div>}
      {open ? (
        <>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What's confusing about this card?" rows={3} maxLength={2000} autoFocus disabled={busy} />
          <div className="hub-flag-form-row">
            {tutors.length > 1 && (
              <select value={tutor.relationship_id} onChange={(e) => setRelId(e.target.value)} disabled={busy}>
                {tutors.map((t) => <option key={t.relationship_id} value={t.relationship_id}>{t.name}</option>)}
              </select>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !message.trim()}>{busy ? 'Sending…' : `Send to ${tutor.name}`}</button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>🚩 Flag this card for {tutors.length > 1 ? 'a tutor' : tutor.name}</button>
      )}
    </div>
  );
}
