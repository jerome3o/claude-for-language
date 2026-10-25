import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  dueLabel, lastPassAnswer, localDate, passItemIds, passProgress, retryBarNote, hasFsrs, PASS_CARD_TYPE,
  passAnglePlan, passAngleLine, passAnglesLabel, passAnswerItemId, passHardApplies, parsePassStepId, passWordMissed, secondAngleType,
  type PassWord,
} from '@shared/homework';
import { DEFAULT_DECK_SETTINGS, deckInDailyReview, isLongTerm, longTermSummary, prefForToggle, toLongTermPref } from '@shared/decks';
import { CardQueue, type CardWithNote, type IntervalPreview, type QueueCounts, type Rating } from '../types';
import { setNoteLongTerm } from '../services/longTerm';
import { LongTermSwitch, longTermLine } from '../components/homework/LongTermSwitch';
import { db, type LocalCard, type LocalHomeworkEvent, type LocalNote } from '../db/database';
import { recordPassEvent, recordPassUndo, syncHomework, titleParts } from '../services/homework';
import { track } from '../services/analytics';
import { completeCustomLesson, syncCustomLessons } from '../services/custom-lesson-study';
import { recordReaderFinish } from '../services/reader-study';
import { StudyCustomLesson } from '../components/StudyCustomLesson';
import { StudyReader } from '../components/StudyReader';
import { Confetti } from '../components/Confetti';
import { DueChip } from '../components/homework/HomeworkRow';
import { LinkPass } from '../components/homework/LinkPass';
import { RetryProgressBar } from '../components/homework/RetryProgressBar';
import { BumpButton } from '../components/bumps/BumpButton';
import { getMyRelationships, updateDeckSettings } from '../api/client';
import { getIntervalPreviewLocal } from '../hooks/useStudySession';
import { useNativeOutputHold } from '../hooks/useNativeOutputHold';
import { deckSettingsFromDb, DEFAULT_DECK_SETTINGS as DEFAULT_SCHEDULER_SETTINGS } from '../services/anki-scheduler';
import { StudyCard, type PassAnswerInfo } from './StudyPage';
import { useNetwork } from '../contexts/NetworkContext';
import { usePassHardMode } from '../services/hardModePrefs';
import { ensurePassSentences } from '../services/passSentences';
import './StudyPage.css';
import '../components/homework/homework.css';

/**
 * One homework item, done as a ONE-OFF pass (docs/HOMEWORK.md) — no spaced
 * repetition. A word list: each word once on the study card, "Not yet" words
 * come back at the end until they are right. A lesson / reader: the regular player, once.
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
  return <DeckPass assignmentId={a.id} title={base} part={part} dueDate={a.due_date} deckId={a.target_id} oneOffOnly={!hasFsrs(a.mode)} itemIds={passItemIds(a)} events={data.events} progress={progress} onExit={exit} />;
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

/**
 * The word list on the STUDY CARD (shared/homework/pass-card.ts): each word as its read card
 * (hanzi → meaning) — 🎤 Record with the live "You said", Record again, Show answer, the back with
 * its explorer chips, word tags, sentences, Ask Claude / Edit / ⋯ — exactly like Study. The pass
 * keeps its own semantics: Not yet / Got it where the ratings are (what the card saw may suggest
 * one), a homework event per answer, NOTHING in review_events, and the take stays on this device
 * (it is never uploaded or attached to anything). On the answer side: "Add to my long-term review"
 * and ⚡ Study it today.
 */
function DeckPass({
  assignmentId,
  title,
  part,
  dueDate,
  deckId,
  oneOffOnly,
  itemIds,
  events,
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
  events: ReadonlyArray<LocalHomeworkEvent>;
  progress: ReturnType<typeof passProgress>;
  onExit: () => void;
}) {
  const { isOnline } = useNetwork();
  useNativeOutputHold();
  const idsKey = itemIds.join(',');
  const notes = useLiveQuery(async () => {
    const rows = await db.notes.bulkGet(itemIds);
    return new Map(rows.filter((n): n is LocalNote => !!n).map((n) => [n.id, n]));
  }, [idsKey]);
  // The card each word is shown as (its hanzi → meaning card) + the deck, for the card's own tools.
  const cardsByNote = useLiveQuery(async () => {
    const cards = await db.cards.where('note_id').anyOf(itemIds).toArray();
    const byNote = new Map<string, LocalCard[]>();
    for (const c of cards) byNote.set(c.note_id, [...(byNote.get(c.note_id) ?? []), c]);
    return byNote;
  }, [idsKey]);
  const deck = useLiveQuery(() => db.decks.get(deckId), [deckId]);
  // "Add to my long-term review": the deck's own default (a one-off copy is 0 + 0) and
  // the words already started (their switch is fixed — they are in the reviews).
  const longTerm = useLiveQuery(async () => {
    const [d, cards] = await Promise.all([db.decks.get(deckId), db.cards.where('note_id').anyOf(itemIds).toArray()]);
    const reviewed = new Set(cards.filter((c) => c.queue !== CardQueue.NEW).map((c) => c.note_id));
    const inReview = d ? deckInDailyReview(d.new_cards_per_day, d.secondary_cards_per_day ?? DEFAULT_DECK_SETTINGS.secondary_cards_per_day) : !oneOffOnly;
    return { inReview, reviewed };
  }, [deckId, idsKey, oneOffOnly]);
  const { data: relationships } = useQuery({ queryKey: ['relationships'], queryFn: getMyRelationships, enabled: isOnline, staleTime: 5 * 60 * 1000 });
  const tutors = useMemo(() => relationships?.tutors || [], [relationships?.tutors]);
  const [busy, setBusy] = useState(false);
  // Hard mode in the pass (shared/homework/pass-angles.ts, docs/HOMEWORK.md §3d): its own setting
  // (default All), the check-first ladder + Sentence round on the reading / meaning cards, and a word
  // got right that way comes back ONCE more later on another card type before it counts as done.
  const passMode = usePassHardMode();
  const words: PassWord[] = useMemo(
    () => itemIds.map((id) => ({
      id,
      cardTypes: (cardsByNote?.get(id) ?? []).map((c) => c.card_type),
      hasAudio: !!notes?.get(id)?.audio_url,
    })),
    [idsKey, cardsByNote, notes] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const plan = useMemo(() => passAnglePlan(words, events, passMode), [words, events, passMode]);
  const showing = plan.next;
  const currentId = showing?.noteId ?? null;
  const note = currentId ? notes?.get(currentId) ?? null : null;
  // Seen before in this pass (Not yet, or a first angle got): the word comes back as a fresh card.
  const attempt = currentId ? events.filter((e) => e.item_id === currentId || parsePassStepId(e.item_id)?.noteId === currentId).length : 0;
  const missed = currentId ? passWordMissed(currentId, events) : false;
  const hardApplies = !!showing && passHardApplies({ mode: passMode, cardType: showing.cardType, missed });

  // The round needs sentences: ask for the pass's missing ones once when it opens in Hard mode.
  useEffect(() => {
    if (passMode === 'off' || progress.complete) return;
    void ensurePassSentences(assignmentId, itemIds).catch(() => undefined);
  }, [assignmentId, idsKey, passMode, progress.complete]); // eslint-disable-line react-hooks/exhaustive-deps
  // Analytics: the pass's Hard mode as it opened (once per pass on screen).
  const trackedMode = useRef<string | null>(null);
  useEffect(() => {
    if (progress.complete || trackedMode.current === assignmentId) return;
    trackedMode.current = assignmentId;
    track('homework.pass_hard_mode', { mode: passMode, where: 'pass' });
  }, [assignmentId, passMode, progress.complete]);

  const card: LocalCard | null = useMemo(() => {
    if (!note || !showing) return null;
    const own = cardsByNote?.get(note.id) ?? [];
    return own.find((c) => c.card_type === showing.cardType) ?? passPlaceholderCard(note, showing.cardType);
  }, [note, showing, cardsByNote]);

  const previews = useMemo<Record<Rating, IntervalPreview> | null>(() => {
    if (!card) return null;
    const settings = deck ? deckSettingsFromDb(deck) : DEFAULT_SCHEDULER_SETTINGS;
    return {
      0: getIntervalPreviewLocal(0, card, settings),
      1: getIntervalPreviewLocal(1, card, settings),
      2: getIntervalPreviewLocal(2, card, settings),
      3: getIntervalPreviewLocal(3, card, settings),
    };
  }, [card, deck]);

  const answer = useCallback(async (right: boolean, info: PassAnswerInfo) => {
    if (!currentId || !showing || busy) return;
    const word = words.find((w) => w.id === currentId) ?? { id: currentId, cardTypes: [], hasAudio: false };
    // Got it on a hard first angle owed a second: a step (`<note>#<card type>`), the word not done yet.
    const itemId = passAnswerItemId({ showing, word, right, hard: info.hard });
    setBusy(true);
    try {
      await recordPassEvent(assignmentId, itemId, right ? 'right' : 'wrong');
      track('homework.pass_item', {
        result: right ? 'right' : 'wrong',
        card_type: info.cardType,
        answered: info.answered,
        suggested: info.suggested ?? 'none',
        followed: info.suggested ? (info.suggested === 'right') === right : false,
        angle: showing.angle,
        hard: info.hard,
      });
      if (itemId !== currentId) {
        track('homework.pass_angle', { action: 'queued', card_type: secondAngleType(word, showing.cardType) ?? undefined });
      } else if (showing.angle === 2) {
        track('homework.pass_angle', { action: 'answered', card_type: showing.cardType, result: right ? 'right' : 'wrong' });
      }
    } finally {
      setBusy(false);
    }
  }, [assignmentId, currentId, showing, words, busy]);

  // ↺ Undo (docs/HOMEWORK.md §3b): takes back the last Got it / Not yet with an `undo` event, one
  // further back each time; the word comes back as it was before the answer (a fresh card), and a
  // pass the undone Got it finished is open again. The long-term switch / ⚡ stay as they are.
  const canUndo = !busy && lastPassAnswer(events) !== null;
  const undo = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const wasComplete = progress.complete;
      const undone = await recordPassUndo(assignmentId);
      if (undone) track('homework.pass_undo', { result: undone.result, reopened: wasComplete });
    } finally {
      setBusy(false);
    }
  }, [assignmentId, busy, progress.complete]);

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
          onUndo={canUndo ? () => void undo() : undefined}
        />
      </div>
    );
  }

  const due = dueLabel(dueDate, localDate());
  // The retry bar (§3c) with each owed second angle as a step, so it stays truthful in Hard mode.
  const retryBar = plan.bar;
  const retryNote = retryBarNote(retryBar);
  const anglesLabel = passAnglesLabel(passMode);
  const angleLine = showing ? passAngleLine(showing) : null;
  const meta = (
    <>
      {/* Blue = answers given, orange at the right end = "Not yet" words still owed (§3c). */}
      <RetryProgressBar bar={retryBar} className="hw-pass-progress" testId="hw-pass-progress" />
      <div className="hw-pass-meta">
        {part && <span className="hw-pass-part">{part.replace(/^d/, 'D')}</span>}
        <DueChip due={due} />
        {retryNote && <span className={`hw-pass-retry${retryBar.onRetries ? ' hw-pass-retry--on' : ''}`} data-testid="hw-pass-retry">{retryNote}</span>}
        {anglesLabel && <span className="hw-pass-angles" data-testid="hw-pass-angles">{anglesLabel}</span>}
      </div>
      {angleLine && <p className="hw-pass-angle-line" data-testid="hw-pass-angle-line">{angleLine}</p>}
    </>
  );

  if (notes === undefined || cardsByNote === undefined) return <div className="study-fullscreen" />;
  if (!note || !card || !previews) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title={title} onClose={onExit} right={counter} />
        {meta}
        <div className="hw-pass-empty">
          <p>The words for this homework haven&rsquo;t reached this device yet.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void syncHomework().catch(() => undefined)}>Try again</button>
        </div>
      </div>
    );
  }

  const started = !!longTerm?.reviewed.has(note.id);
  // Straight into the page's own full-screen frame, like the study session's card.
  return (
    <StudyCard
      key={`${card.id}:${attempt}:${showing?.angle ?? 1}`}
      card={{ ...card, note } as unknown as CardWithNote}
      cardIsSecondaryNew={false}
      intervalPreviews={previews}
      counts={NO_COUNTS}
      tutors={tutors}
      isRating={busy}
      canUndo={canUndo}
      onRate={() => {}}
      onUndo={() => void undo()}
      onEnd={onExit}
      onUpdateNote={() => {}}
      onDeleteCurrentCard={() => {}}
      banner={meta}
      pass={{
        header: (
          <div className="hw-pass-head">
            <span className="study-topbar-label" lang="zh">{title}</span>
            {counter}
          </div>
        ),
        answerExtras: (
          <div className="hw-pass-extras" data-testid="hw-pass-extras">
            {longTerm && (
              <LongTermSwitch
                on={isLongTerm(toLongTermPref(note.long_term), longTerm.inReview, started)}
                started={started}
                onChange={(on) => {
                  try { navigator.vibrate?.(10); } catch { /* no haptics */ }
                  void setNoteLongTerm(note.id, prefForToggle(on, longTerm.inReview));
                }}
              />
            )}
            {/* ⚡ Study it today: this word first in today's study (shared/decks/bumps.ts) —
                its new cards too, past the budget and even from this one-off copy. A second tap
                takes it out. */}
            <BumpButton noteIds={[note.id]} source="homework_pass" compact removable label="⚡ Study it today" />
          </div>
        ),
        onAnswer: (right, info) => void answer(right, info),
        coachReturn: `/homework/${assignmentId}`,
        hard: { mode: passMode, applies: hardApplies },
      }}
    />
  );
}

const NO_COUNTS: QueueCounts = { new: 0, secondaryNew: 0, learning: 0, review: 0 };

/** A word whose cards haven't reached the device: shown as a NEW card of that type (nothing is written for it). */
function passPlaceholderCard(note: LocalNote, cardType: string = PASS_CARD_TYPE): LocalCard {
  return {
    id: cardType === PASS_CARD_TYPE ? `pass:${note.id}` : `pass:${note.id}:${cardType}`,
    note_id: note.id,
    deck_id: note.deck_id,
    card_type: cardType as LocalCard['card_type'],
    queue: CardQueue.NEW,
    stability: 0,
    difficulty: 0,
    lapses: 0,
    learning_step: 0,
    ease_factor: 2.5,
    interval: 0,
    repetitions: 0,
    next_review_at: null,
    due_timestamp: null,
    created_at: note.created_at,
    updated_at: note.updated_at,
    _synced_at: null,
  };
}

function PassDone({
  title,
  words,
  deckId,
  oneOffOnly,
  longTerm,
  onExit,
  onAgain,
  onUndo,
}: {
  title: string;
  words?: number;
  deckId?: string;
  oneOffOnly?: boolean;
  longTerm?: { inReview: boolean; added: number; leftOut: number };
  onExit: () => void;
  /** A lesson: "▶ Do it again" (the replay page). */
  onAgain?: () => void;
  /** A word list: "↺ Undo last answer" — the last Got it finished it by mistake. */
  onUndo?: () => void;
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
      {onAgain && (
        <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={onAgain} data-testid="hw-lesson-again">▶ Do it again</button>
      )}
      {onUndo && (
        <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={onUndo} data-testid="hw-pass-undo">↺ Undo last answer</button>
      )}
      <button type="button" className="btn btn-primary" onClick={onExit}>Done</button>
    </div>
  );
}

// ============ Lesson / reader: the regular players, once ============

function LessonPass({ assignmentTitle, targetId, complete, onExit }: { assignmentTitle: string; targetId: string; complete: boolean; onExit: () => void }) {
  const navigate = useNavigate();
  const lesson = useLiveQuery(() => db.customLessons.get(targetId), [targetId]);
  const [finished, setFinished] = useState(false);
  // Finished in this player (its Done shows the pass's end); a close mid-run just leaves — the run waits.
  const completedHere = useRef(false);
  // Finished (now or earlier): "▶ Do it again" opens the real player outside the pass (LessonReplayPage).
  const again = lesson ? () => navigate(`/lessons/${lesson.id}/play?from=homework`) : undefined;
  if (complete && !finished) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title={assignmentTitle} onClose={onExit} />
        <PassDone title={assignmentTitle} onExit={onExit} onAgain={again} />
      </div>
    );
  }
  if (lesson === undefined) return <div className="study-fullscreen" />;
  if (!lesson) return <Missing title={assignmentTitle} onExit={onExit} />;
  if (finished) {
    return (
      <div className="study-fullscreen hw-pass">
        <PassTopbar title={assignmentTitle} onClose={onExit} />
        <PassDone title={assignmentTitle} onExit={onExit} onAgain={again} />
      </div>
    );
  }
  return (
    <StudyCustomLesson
      lesson={lesson}
      lessonId={lesson.id}
      label="Homework"
      source="homework"
      onComplete={({ correct, total, attempt, recordings, outcome }) => {
        completedHere.current = true;
        // The per-exercise attempt (and any recordings) travels with the completion; its outcome
        // decides done forever vs a revision in a week (shared/study/lessonRevision.ts).
        completeCustomLesson(lesson.id, correct, total, attempt, recordings, { source: 'homework', outcome })
          .then(() => {
            if (navigator.onLine) void syncCustomLessons().catch(() => {});
          })
          .catch(err => console.error('[homework] lesson completion failed:', err));
      }}
      onEnd={() => (completedHere.current ? setFinished(true) : onExit())}
    />
  );
}

function ReaderPass({ targetId, complete, onExit }: { targetId: string; complete: boolean; onExit: () => void }) {
  const reader = useLiveQuery(() => db.readers.get(targetId), [targetId]);
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
  if (!reader || reader.pages.length === 0) return <Missing title={title} onExit={onExit} />;
  return (
    <StudyReader
      reader={reader}
      isFinishing={rating}
      onFinish={(ms: number) => {
        setRating(true);
        void recordReaderFinish(reader.id, ms).then(() => setFinished(true));
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
