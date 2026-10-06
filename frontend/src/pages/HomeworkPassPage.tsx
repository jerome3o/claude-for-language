import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { dueLabel, localDate, nextPassItem, passItemIds, passProgress, hasFsrs } from '@shared/homework';
import { DEFAULT_DECK_SETTINGS, deckInDailyReview, isLongTerm, longTermSummary, prefForToggle, toLongTermPref } from '@shared/decks';
import { CardQueue } from '../types';
import { setNoteLongTerm } from '../services/longTerm';
import { LongTermSwitch, longTermLine } from '../components/homework/LongTermSwitch';
import { db, type LocalNote } from '../db/database';
import { recordPassEvent, syncHomework, titleParts } from '../services/homework';
import { track } from '../services/analytics';
import { completeCustomLesson, getCustomLessonIntervalPreviews, syncCustomLessons } from '../services/custom-lesson-study';
import { recordReaderReview, getReaderIntervalPreviews } from '../services/reader-study';
import { StudyCustomLesson } from '../components/StudyCustomLesson';
import { StudyReader } from '../components/StudyReader';
import { SentenceSet } from '../components/SentenceSet';
import { Confetti } from '../components/Confetti';
import { DueChip } from '../components/homework/HomeworkRow';
import { LinkPass } from '../components/homework/LinkPass';
import { useNoteAudio } from '../hooks/useAudio';
import { API_BASE, updateDeckSettings } from '../api/client';
import { useNetwork } from '../contexts/NetworkContext';
import type { Rating } from '../types';
import './StudyPage.css';
import '../components/homework/homework.css';

/**
 * One homework item, done as a ONE-OFF pass (docs/HOMEWORK.md) — no spaced
 * repetition. A word list: each word once, "Not yet" words come back at the
 * end until they are right. A lesson / reader: the regular player, once.
 * Everything is local (IndexedDB); events upload in the background.
 */
export function HomeworkPassPage() {
  // Full screen like a study session: no header, no tab bar.
  return (
    <div className="study-page-fullscreen hw-pass-page">
      <HomeworkPass />
    </div>
  );
}

function HomeworkPass() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const assignment = await db.homeworkAssignments.get(id!);
    if (!assignment) return { assignment: null } as const;
    const events = await db.homeworkEvents.where('assignment_id').equals(assignment.id).toArray();
    return { assignment, events } as const;
  }, [id]);
  const exit = () => navigate(-1);

  // Analytics: the pass opened (once), and finished while open (complete went false → true).
  const passTrack = useRef<{ id: string; wasComplete: boolean; done: boolean } | null>(null);
  useEffect(() => {
    const a = data?.assignment;
    if (!a) return;
    const items = passItemIds(a).length;
    const complete = passProgress(passItemIds(a), data.events).complete;
    if (passTrack.current?.id !== a.id) {
      passTrack.current = { id: a.id, wasComplete: complete, done: false };
      track('homework.pass_start', { kind: a.kind, items });
    } else if (complete && !passTrack.current.wasComplete && !passTrack.current.done) {
      passTrack.current.done = true;
      track('homework.pass_done', { kind: a.kind, items });
    }
  }, [data]);

  if (data === undefined) return <div className="study-fullscreen" />;
  if (!data.assignment) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title="Homework" onClose={() => navigate('/homework')} />
        <div className="hw-pass-empty">
          <p>This homework isn&rsquo;t on this device.</p>
          <Link to="/homework" className="btn btn-secondary">All homework</Link>
        </div>
      </div>
    );
  }

  const a = data.assignment;
  const progress = passProgress(passItemIds(a), data.events);

  if (a.kind === 'lesson') return <LessonPass assignmentTitle={a.title} targetId={a.target_id} complete={progress.complete} onExit={exit} />;
  if (a.kind === 'link') {
    const doneNote = [...data.events].reverse().find((e) => e.result === 'done')?.note ?? null;
    return (
      <LinkPass
        assignmentId={a.id}
        targetId={a.target_id}
        title={a.title}
        details={a.details}
        dueDate={a.due_date}
        tutorName={a.tutor_name}
        complete={progress.complete || a.status === 'done'}
        note={doneNote}
        topbar={<PassTopbar title="Homework" onClose={exit} />}
      />
    );
  }
  if (a.kind === 'reader') return <ReaderPass targetId={a.target_id} complete={progress.complete} onExit={exit} />;
  const { base, part } = titleParts(a);
  return <DeckPass assignmentId={a.id} title={base} part={part} dueDate={a.due_date} deckId={a.target_id} oneOffOnly={!hasFsrs(a.mode)} itemIds={passItemIds(a)} progress={progress} onExit={exit} />;
}

function PassTopbar({ title, onClose, right }: { title: string; onClose: () => void; right?: React.ReactNode }) {
  return (
    <div className="study-topbar hw-pass-topbar">
      <span className="study-topbar-label" lang="zh">{title}</span>
      <div className="study-topbar-controls">
        {right}
        <button className="study-close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
    </div>
  );
}

// ============ Word list ============

function DeckPass({
  assignmentId,
  title,
  part,
  dueDate,
  deckId,
  oneOffOnly,
  itemIds,
  progress,
  onExit,
}: {
  assignmentId: string;
  title: string;
  part: string | null;
  dueDate: string | null;
  deckId: string;
  oneOffOnly: boolean;
  itemIds: string[];
  progress: ReturnType<typeof passProgress>;
  onExit: () => void;
}) {
  const notes = useLiveQuery(async () => {
    const rows = await db.notes.bulkGet(itemIds);
    return new Map(rows.filter((n): n is LocalNote => !!n).map((n) => [n.id, n]));
  }, [itemIds.join(',')]);
  // "Add to my long-term review": the deck's own default (a one-off copy is 0 + 0) and
  // the words already started (their switch is fixed — they are in the reviews).
  const longTerm = useLiveQuery(async () => {
    const [deck, cards] = await Promise.all([db.decks.get(deckId), db.cards.where('note_id').anyOf(itemIds).toArray()]);
    const reviewed = new Set(cards.filter((c) => c.queue !== CardQueue.NEW).map((c) => c.note_id));
    const inReview = deck ? deckInDailyReview(deck.new_cards_per_day, deck.secondary_cards_per_day ?? DEFAULT_DECK_SETTINGS.secondary_cards_per_day) : !oneOffOnly;
    return { inReview, reviewed };
  }, [deckId, itemIds.join(','), oneOffOnly]);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { play } = useNoteAudio('homework');
  const currentId = nextPassItem(progress);
  const note = currentId ? notes?.get(currentId) ?? null : null;
  const lastPlayed = useRef<string | null>(null);

  useEffect(() => {
    setRevealed(false);
  }, [currentId]);

  const answer = async (right: boolean) => {
    if (!currentId || busy) return;
    setBusy(true);
    try {
      await recordPassEvent(assignmentId, currentId, right ? 'right' : 'wrong');
      track('homework.pass_item', { result: right ? 'right' : 'wrong' });
    } finally {
      setBusy(false);
    }
  };

  const reveal = () => {
    setRevealed(true);
    if (note && lastPlayed.current !== note.id + ':reveal') {
      lastPlayed.current = note.id + ':reveal';
      play(note.audio_url ?? null, note.hanzi, API_BASE);
    }
  };

  const counter = <span className="hw-pass-count" data-testid="hw-pass-count">{progress.done}/{progress.total}</span>;

  if (progress.complete) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title={title} onClose={onExit} right={counter} />
        <PassDone
          title={part ? `${title} · ${part}` : title}
          words={progress.total}
          deckId={deckId}
          oneOffOnly={oneOffOnly}
          longTerm={
            notes && longTerm
              ? {
                  inReview: longTerm.inReview,
                  ...longTermSummary(itemIds.map((id) => ({ pref: toLongTermPref(notes.get(id)?.long_term), reviewed: longTerm.reviewed.has(id) })), longTerm.inReview),
                }
              : undefined
          }
          onExit={onExit}
        />
      </div>
    );
  }

  const due = dueLabel(dueDate, localDate());
  return (
    <div className="study-fullscreen hw-pass">
      <PassTopbar title={title} onClose={onExit} right={counter} />
      <div className="hw-pass-progress" aria-hidden="true">
        <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
      </div>
      <div className="hw-pass-meta">
        {part && <span className="hw-pass-part">{part.replace(/^d/, 'D')}</span>}
        <DueChip due={due} />
        {progress.retrying > 0 && <span className="hw-pass-retry">{progress.retrying} to try again</span>}
      </div>

      {notes === undefined ? null : !note ? (
        <div className="hw-pass-empty">
          <p>The words for this homework haven&rsquo;t reached this device yet.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void syncHomework().catch(() => undefined)}>Try again</button>
        </div>
      ) : (
        <div className="hw-pass-card" data-testid="hw-pass-card">
          <div className="hw-pass-hanzi" lang="zh">{note.hanzi}</div>
          <button type="button" className="hw-pass-play" onClick={() => play(note.audio_url ?? null, note.hanzi, API_BASE)} aria-label="Play audio">▶</button>
          {revealed ? (
            <div className="hw-pass-answer" data-testid="hw-pass-answer">
              <div className="hw-pass-pinyin">{note.pinyin}</div>
              <div className="hw-pass-english">{note.english}</div>
              {longTerm && (
                <LongTermSwitch
                  on={isLongTerm(toLongTermPref(note.long_term), longTerm.inReview, longTerm.reviewed.has(note.id))}
                  started={longTerm.reviewed.has(note.id)}
                  onChange={(on) => {
                    try { navigator.vibrate?.(10); } catch { /* no haptics */ }
                    void setNoteLongTerm(note.id, prefForToggle(on, longTerm.inReview));
                  }}
                />
              )}
              {/* The study card's sentence rows, kept calm: ▶, tap for pinyin then
                  English, "What's going on here?" — nothing here records a review
                  or a homework event. */}
              <div className="hw-pass-sentences">
                <SentenceSet
                  noteId={note.id}
                  variant="pass"
                  defaultOpen
                  cardSentence={
                    note.sentence_clue
                      ? {
                          hanzi: note.sentence_clue,
                          pinyin: note.sentence_clue_pinyin ?? null,
                          translation: note.sentence_clue_translation ?? null,
                          audio_url: note.sentence_clue_audio_url ?? null,
                        }
                      : null
                  }
                />
              </div>
            </div>
          ) : (
            <p className="hw-pass-hint">Say what it means, then check.</p>
          )}
        </div>
      )}

      {note && (
        <div className="hw-pass-actions">
          {revealed ? (
            <>
              <button key="notyet" type="button" className="btn hw-btn-notyet" onClick={() => void answer(false)} disabled={busy} data-testid="hw-notyet">Not yet</button>
              <button key="gotit" type="button" className="btn hw-btn-gotit" onClick={() => void answer(true)} disabled={busy} data-testid="hw-gotit">Got it</button>
            </>
          ) : (
            <button key="show" type="button" className="btn btn-primary hw-btn-show" onClick={reveal} data-testid="hw-show">Show answer</button>
          )}
        </div>
      )}
    </div>
  );
}

function PassDone({
  title,
  words,
  deckId,
  oneOffOnly,
  longTerm,
  onExit,
}: {
  title: string;
  words?: number;
  deckId?: string;
  oneOffOnly?: boolean;
  longTerm?: { inReview: boolean; added: number; leftOut: number };
  onExit: () => void;
}) {
  const { isOnline } = useNetwork();
  const [added, setAdded] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const addToDaily = async () => {
    if (!deckId) return;
    setAdded('busy');
    try {
      const caps = { new_cards_per_day: DEFAULT_DECK_SETTINGS.new_cards_per_day, secondary_cards_per_day: DEFAULT_DECK_SETTINGS.secondary_cards_per_day };
      await updateDeckSettings(deckId, caps);
      await db.decks.update(deckId, caps);
      setAdded('done');
    } catch {
      setAdded('error');
    }
  };
  return (
    <div className="hw-pass-done" data-testid="hw-pass-done">
      <Confetti />
      <div className="hw-pass-done-icon" aria-hidden="true">🎉</div>
      <h2>Homework done!</h2>
      <p>
        <span lang="zh">{title}</span>
        {words ? ` · ${words} ${words === 1 ? 'word' : 'words'}` : ''}
      </p>
      {longTerm && (longTerm.inReview || longTerm.added > 0) && added !== 'done' && (
        <p className="hw-longterm-summary" data-testid="hw-longterm-summary">{longTermLine(longTerm.added, longTerm.leftOut)}</p>
      )}
      {oneOffOnly && deckId && (!longTerm || (!longTerm.inReview && longTerm.leftOut > 0)) && (
        <div className="hw-pass-daily">
          {added === 'done' ? (
            <p>Added — these words now come up in your daily review.</p>
          ) : (
            <>
              <p>{longTerm && longTerm.added > 0 ? 'The others were a one-off. Keep them all for good?' : 'These words were a one-off. Want to keep them for good?'}</p>
              <button type="button" className="btn btn-secondary" onClick={() => void addToDaily()} disabled={added === 'busy' || !isOnline}>
                {added === 'busy' ? 'Adding…' : longTerm && longTerm.added > 0 ? 'Add them all to my daily review' : 'Add to my daily review'}
              </button>
              {!isOnline && <p className="hw-muted">Available when you&rsquo;re online.</p>}
              {added === 'error' && <p className="hw-muted">Couldn&rsquo;t add them — try again later.</p>}
            </>
          )}
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={onExit}>Done</button>
    </div>
  );
}

// ============ Lesson / reader: the regular players, once ============

function LessonPass({ assignmentTitle, targetId, complete, onExit }: { assignmentTitle: string; targetId: string; complete: boolean; onExit: () => void }) {
  const lesson = useLiveQuery(() => db.customLessons.get(targetId), [targetId]);
  const previews = useMemo(() => (lesson ? getCustomLessonIntervalPreviews(lesson) : null), [lesson]);
  const [finished, setFinished] = useState(false);
  if (complete && !finished) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title={assignmentTitle} onClose={onExit} />
        <PassDone title={assignmentTitle} onExit={onExit} />
      </div>
    );
  }
  if (lesson === undefined) return <div className="study-fullscreen" />;
  if (!lesson || !previews) return <Missing title={assignmentTitle} onExit={onExit} />;
  if (finished) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title={assignmentTitle} onClose={onExit} />
        <PassDone title={assignmentTitle} onExit={onExit} />
      </div>
    );
  }
  return (
    <StudyCustomLesson
      lesson={lesson}
      intervalPreviews={previews}
      onComplete={(correct, total, rating, attempt, recordings, retire) => {
        // The per-exercise attempt (and any recordings) travels with the completion, as in a study session.
        void completeCustomLesson(lesson.id, correct, total, rating, attempt, recordings, { retire, source: 'homework' })
          .then(() => {
            setFinished(true);
            if (navigator.onLine) void syncCustomLessons().catch(() => {});
          });
      }}
      onEnd={onExit}
    />
  );
}

function ReaderPass({ targetId, complete, onExit }: { targetId: string; complete: boolean; onExit: () => void }) {
  const reader = useLiveQuery(() => db.readers.get(targetId), [targetId]);
  const previews = useMemo(() => (reader ? getReaderIntervalPreviews(reader) : null), [reader]);
  const [rating, setRating] = useState(false);
  const [finished, setFinished] = useState(false);
  const title = reader?.title_chinese || reader?.title_english || 'Reader';
  if ((complete && !rating) || finished) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title={title} onClose={onExit} />
        <PassDone title={title} onExit={onExit} />
      </div>
    );
  }
  if (reader === undefined) return <div className="study-fullscreen" />;
  if (!reader || !previews || reader.pages.length === 0) return <Missing title={title} onExit={onExit} />;
  return (
    <StudyReader
      reader={reader}
      intervalPreviews={previews}
      isRating={rating}
      onRate={(r: Rating, ms: number, retire?: boolean) => {
        setRating(true);
        void recordReaderReview(reader.id, r, ms, { retire, source: 'homework' }).then(() => setFinished(true));
      }}
      onEnd={onExit}
    />
  );
}

function Missing({ title, onExit }: { title: string; onExit: () => void }) {
  return (
    <div className="study-fullscreen hw-pass">
      <PassTopbar title={title} onClose={onExit} />
      <div className="hw-pass-empty">
        <p>This hasn&rsquo;t reached this device yet. It will download with your next sync.</p>
        <button type="button" className="btn btn-secondary" onClick={onExit}>Back</button>
      </div>
    </div>
  );
}
