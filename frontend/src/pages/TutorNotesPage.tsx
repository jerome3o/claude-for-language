import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { practiceCardIds, tutorNoteLabel, type TutorNote } from '@shared/tutor-notes';
import { db } from '../db/database';
import { getAudioUrl } from '../api/client';
import { useAudioPlayer } from '../hooks/useAudio';
import { useNetwork } from '../contexts/NetworkContext';
import { Loading } from '../components/Loading';
import { loadTutorNotes, markTutorNotesSeen, syncTutorNotes } from '../services/tutorNotes';
import { syncRecordingNotes } from '../services/recording-notes';
import './TutorNotesPage.css';

/** Marked seen once the page has been on screen this long (the card back no longer repeats them). */
const SEEN_AFTER_MS = 1500;

function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function RecordingButton({ url }: { url: string }) {
  const { isPlaying, play, stop } = useAudioPlayer(getAudioUrl(url));
  return (
    <button type="button" className={`tn-rec${isPlaying ? ' playing' : ''}`} onClick={() => (isPlaying ? stop() : play())} aria-label={isPlaying ? 'Stop your recording' : 'Play your recording'}>
      {isPlaying ? '■' : '▶'} <span>Your recording</span>
    </button>
  );
}

function NoteCard({ note, isNew, onPractice }: { note: TutorNote; isNew: boolean; onPractice: () => void }) {
  return (
    <article className={`card tn-note${isNew ? ' tn-note-new' : ''}`} data-testid="tutor-note">
      <div className="tn-note-meta">
        <span>{note.kind === 'flag' ? '🚩' : '🎤'} {tutorNoteLabel(note)}</span>
        <span>{isNew && <span className="tn-new-dot">new · </span>}{when(note.updated_at)}</span>
      </div>
      <div className="tn-word">
        <span className="tn-hanzi" lang="zh">{note.hanzi}</span>
        <span className="tn-word-text">
          {note.pinyin && <span className="tn-pinyin">{note.pinyin}</span>}
          {note.english && <span className="tn-english">{note.english}</span>}
        </span>
      </div>
      {note.student_message && <p className="tn-asked">You asked: “{note.student_message}”</p>}
      <blockquote className="tn-comment">
        <span className="tn-from">{note.tutor_name || 'Your tutor'}:</span> {note.comment}
      </blockquote>
      <div className="tn-actions">
        {note.recording_url && <RecordingButton url={note.recording_url} />}
        <button type="button" className="btn btn-secondary tn-practice" onClick={onPractice} data-testid="tn-practice">
          Practice this card
        </button>
        <Link to={`/cards/${note.note_id}`} className="tn-open">Open card ›</Link>
      </div>
    </article>
  );
}

/**
 * `/tutor-notes` — every note from the tutor: comments on my recordings and replies to cards I
 * flagged, new first, then earlier ones. Offline from IndexedDB (services/tutorNotes.ts); refreshed
 * when online. Viewing marks the new ones seen (the same "seen" the card back uses), but they stay
 * under "New" for this visit. Practice opens the card(s) in the study card UI.
 */
export function TutorNotesPage() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [version, setVersion] = useState(0);
  const list = useLiveQuery(() => loadTutorNotes(), [version]);
  // What was new when the page opened — it stays "New" while the page is open.
  const newIds = useRef<Set<string> | null>(null);
  if (list && newIds.current === null) newIds.current = new Set(list.fresh.map((n) => n.id));

  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    (async () => {
      try {
        await syncRecordingNotes();
        await syncTutorNotes();
        if (!cancelled) setVersion((v) => v + 1);
      } catch {
        /* offline or flaky — the cached list stays */
      }
    })();
    return () => { cancelled = true; };
  }, [isOnline]);

  useEffect(() => {
    if (!list || list.fresh.length === 0) return;
    const ids = list.fresh.map((n) => n.id);
    const timer = setTimeout(() => { markTutorNotesSeen(ids).catch(() => {}); }, SEEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [list]);

  const { fresh, earlier } = useMemo(() => {
    if (!list) return { fresh: [] as TutorNote[], earlier: [] as TutorNote[] };
    const all = [...list.fresh, ...list.earlier];
    const isNew = (n: TutorNote) => newIds.current?.has(n.id) ?? false;
    return { fresh: all.filter(isNew), earlier: all.filter((n) => !isNew(n)) };
  }, [list]);

  if (!list) return <Loading />;

  const practice = async (notes: TutorNote[]) => {
    const noteIds = [...new Set(notes.map((n) => n.note_id))];
    const cards = await db.cards.where('note_id').anyOf(noteIds).toArray();
    const byNote = new Map<string, { id: string; card_type: string }[]>();
    for (const c of cards) byNote.set(c.note_id, [...(byNote.get(c.note_id) ?? []), c]);
    const ids = practiceCardIds(notes, byNote);
    if (ids.length === 0) return;
    const q = new URLSearchParams({ cards: ids.join(','), notes: notes.map((n) => n.id).join(',') });
    navigate(`/tutor-notes/practice?${q}`);
  };

  const practiceSet = fresh.length > 0 ? fresh : [...fresh, ...earlier];
  const total = fresh.length + earlier.length;

  return (
    <div className="page">
      <div className="container tn-page">
        <h1>Notes from your tutor</h1>
        <p className="tn-muted">
          Comments on your recordings and answers to cards you flagged. Each one also shows once on the back of its card.
        </p>

        {total === 0 ? (
          <div className="card tn-empty" data-testid="tn-empty">
            <div aria-hidden="true">🗒</div>
            <p>No notes yet. When your tutor comments on a recording or answers a card you flagged, it shows up here.</p>
          </div>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-block tn-practice-all" onClick={() => practice(practiceSet)} data-testid="tn-practice-all">
              {fresh.length > 0 ? `Practice the new ones (${new Set(fresh.map((n) => n.note_id)).size})` : `Practice all (${new Set(practiceSet.map((n) => n.note_id)).size})`}
            </button>
            <p className="tn-hint">Practising only counts as a review for cards that are due today — the rest won’t change your schedule.</p>

            {fresh.length > 0 && (
              <section aria-label="New">
                <h2 className="tn-section">New</h2>
                {fresh.map((n) => <NoteCard key={n.id} note={n} isNew onPractice={() => practice([n])} />)}
              </section>
            )}
            {earlier.length > 0 && (
              <section aria-label="Earlier">
                <h2 className="tn-section">Earlier</h2>
                {earlier.map((n) => <NoteCard key={n.id} note={n} isNew={false} onPractice={() => practice([n])} />)}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
