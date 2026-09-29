import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { practiceAfterRating, practiceHint, type TutorNote } from '@shared/tutor-notes';
import { db, type LocalCard, type LocalDeck, type LocalNote, type LocalRecordingNote } from '../db/database';
import { getMyRelationships } from '../api/client';
import { useNetwork } from '../contexts/NetworkContext';
import { useNativeOutputHold } from '../hooks/useNativeOutputHold';
import { getIntervalPreviewLocal } from '../hooks/useStudySession';
import { deckSettingsFromDb, DEFAULT_DECK_SETTINGS } from '../services/anki-scheduler';
import { loadTutorNotes } from '../services/tutorNotes';
import { practiceCounts, ratePracticeCard } from '../services/tutorNotesPractice';
import { Loading } from '../components/Loading';
import { Confetti } from '../components/Confetti';
import { StudyCard } from './StudyPage';
import { CardQueue, type CardWithNote, type IntervalPreview, type Note, type QueueCounts, type Rating } from '../types';
import './StudyPage.css';
import './TutorNotesPage.css';

interface Loaded {
  cards: Map<string, LocalCard>;
  notes: Map<string, LocalNote>;
  decks: Map<string, LocalDeck>;
  tutorNotes: TutorNote[];
}

function asLocalNote(n: TutorNote): LocalRecordingNote {
  return { id: n.id, kind: n.kind, card_id: n.card_id, note_id: n.note_id, hanzi: n.hanzi, comment: n.comment, tutor_name: n.tutor_name, updated_at: n.updated_at, seen_at: n.seen_at ?? n.updated_at, _synced: 1 };
}

/**
 * `/tutor-notes/practice?cards=a,b&notes=x,y` — the cards a tutor left notes on, in the normal study
 * card UI, as a focused mini session. The tutor's note stays on the card back. A rating counts as
 * a review only when the card is due today (shared `practiceRatingCounts`); otherwise it is
 * practice only and nothing is recorded. Again sends the card round again. Works offline.
 */
export function TutorNotesPracticePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  useNativeOutputHold();
  const cardIds = useMemo(() => (params.get('cards') ?? '').split(',').filter(Boolean), [params]);
  const noteIds = useMemo(() => new Set((params.get('notes') ?? '').split(',').filter(Boolean)), [params]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [tally, setTally] = useState({ counted: 0, practice: 0 });
  const [busy, setBusy] = useState(false);

  const { data: relationships } = useQuery({ queryKey: ['relationships'], queryFn: getMyRelationships, enabled: isOnline, staleTime: 5 * 60 * 1000 });
  const tutors = useMemo(() => relationships?.tutors || [], [relationships?.tutors]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cards = (await db.cards.bulkGet(cardIds)).filter((c): c is LocalCard => !!c);
      const notes = (await db.notes.bulkGet([...new Set(cards.map((c) => c.note_id))])).filter((n): n is LocalNote => !!n);
      const decks = (await db.decks.bulkGet([...new Set(notes.map((n) => n.deck_id))])).filter((d): d is LocalDeck => !!d);
      const list = await loadTutorNotes();
      if (cancelled) return;
      const noteById = new Map(notes.map((n) => [n.id, n]));
      setLoaded({
        cards: new Map(cards.map((c) => [c.id, c])),
        notes: noteById,
        decks: new Map(decks.map((d) => [d.id, d])),
        tutorNotes: [...list.fresh, ...list.earlier].filter((n) => noteIds.has(n.id)),
      });
      setQueue(cardIds.filter((id) => cards.some((c) => c.id === id && noteById.has(c.note_id))));
    })();
    return () => { cancelled = true; };
  }, [cardIds, noteIds]);

  const currentId = queue[0] ?? null;
  const card = currentId && loaded ? loaded.cards.get(currentId) ?? null : null;
  const note = card && loaded ? loaded.notes.get(card.note_id) ?? null : null;
  const deck = note && loaded ? loaded.decks.get(note.deck_id) ?? null : null;

  const counts: QueueCounts = useMemo(() => {
    const c = { new: 0, secondaryNew: 0, learning: 0, review: 0 };
    for (const id of queue) {
      const q = loaded?.cards.get(id)?.queue;
      if (q === CardQueue.NEW) c.new++;
      else if (q === CardQueue.LEARNING || q === CardQueue.RELEARNING) c.learning++;
      else if (q === CardQueue.REVIEW) c.review++;
    }
    return c;
  }, [queue, loaded]);

  const previews = useMemo<Record<Rating, IntervalPreview> | null>(() => {
    if (!card) return null;
    const settings = deck ? deckSettingsFromDb(deck) : DEFAULT_DECK_SETTINGS;
    return {
      0: getIntervalPreviewLocal(0, card, settings),
      1: getIntervalPreviewLocal(1, card, settings),
      2: getIntervalPreviewLocal(2, card, settings),
      3: getIntervalPreviewLocal(3, card, settings),
    };
  }, [card, deck]);

  const pinned = useMemo(() => {
    if (!card || !loaded) return [];
    return loaded.tutorNotes
      .filter((n) => (n.kind === 'recording' ? n.card_id === card.id : n.note_id === card.note_id))
      .map(asLocalNote);
  }, [card, loaded]);

  const counted = card ? practiceCounts(card) : false;

  const onRate = useCallback(async (rating: Rating, timeSpentMs: number, userAnswer?: string, recordingBlob?: Blob) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const result = await ratePracticeCard(card, rating, { timeSpentMs, userAnswer, recordingBlob });
      setTally((t) => (result.counted ? { ...t, counted: t.counted + 1 } : { ...t, practice: t.practice + 1 }));
      setLoaded((l) => (l ? { ...l, cards: new Map(l.cards).set(card.id, result.card) } : l));
      setQueue((q) => practiceAfterRating(q, card.id, rating));
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }, [card, busy]);

  const onUpdateNote = useCallback((updated: Partial<Note>) => {
    if (!note) return;
    setLoaded((l) => (l ? { ...l, notes: new Map(l.notes).set(note.id, { ...note, ...updated } as LocalNote) } : l));
  }, [note]);

  const leave = () => navigate('/tutor-notes');

  if (!loaded) return <Loading />;

  if (!card || !note || !previews) {
    const total = tally.counted + tally.practice;
    return (
      <div className="page">
        {total > 0 && <Confetti />}
        <div className="container">
          <div className="card tn-practice-done" data-testid="tn-practice-done">
            <div style={{ fontSize: '3rem' }} aria-hidden="true">{total > 0 ? '🎉' : '🗒'}</div>
            <h1>{total > 0 ? 'Practised!' : 'Nothing to practise'}</h1>
            <p className="tn-muted">
              {total === 0
                ? 'These cards are not on this device yet — sync and try again.'
                : `${tally.counted} counted as ${tally.counted === 1 ? 'a review' : 'reviews'} (due today) · ${tally.practice} practice only`}
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={leave}>Back to notes</button>
          </div>
        </div>
      </div>
    );
  }

  const cardWithNote = { ...card, note } as unknown as CardWithNote;
  return (
    <div className="study-page-fullscreen">
      <StudyCard
        key={`${card.id}-${version}`}
        card={cardWithNote}
        cardIsSecondaryNew={false}
        intervalPreviews={previews}
        counts={counts}
        tutors={tutors}
        isRating={busy}
        canUndo={false}
        onRate={onRate}
        onUndo={() => {}}
        onEnd={leave}
        onUpdateNote={onUpdateNote}
        onDeleteCurrentCard={() => setQueue((q) => q.filter((id) => id !== card.id))}
        pinnedTutorNotes={pinned}
        banner={<p className={`tn-practice-banner${counted ? ' counts' : ''}`} data-testid="tn-practice-banner">{practiceHint(counted)}</p>}
      />
    </div>
  );
}
