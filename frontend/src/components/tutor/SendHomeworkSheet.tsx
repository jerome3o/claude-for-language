import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDeck, getDecks } from '../../api/client';
import { assignHomework } from '../../api/homework';
import { localDate, hasFsrs, hasOneOff, type HomeworkMode } from '@shared/homework';
import { getLessonLog } from '../../api/insights';
import { lessonWhere, sendDefaults, sendHow } from './sendHomework';
import { HomeworkModePicker } from './HomeworkModePicker';
import { listLibrary } from '../../api/lessonEditor';
import { updateSharedDeckCopy } from '../../api/tutorDashboard';
import { track, trackError } from '../../services/analytics';
import type { Deck } from '../../types';
import type { HomeworkDeck, HomeworkLesson } from '../../types/tutorDashboard';
import type { LibraryItemSummary } from '../../types/lessonEditor';
import { Loading } from '../Loading';
import { useNetwork } from '../../contexts/NetworkContext';
import { plural, shortDate } from './format';
import './tutor-dashboard.css';
import './session-notes.css';

type Tab = 'decks' | 'lessons';

interface Props {
  relId: string;
  studentName: string;
  /** Decks already shared in this relationship (to offer "Update their copy"). */
  sharedDecks: HomeworkDeck[];
  /** Lessons already assigned in this relationship. */
  assignedLessons: HomeworkLesson[];
  initialTab?: Tab;
  onClose: () => void;
  /** Called after any share / update / assign succeeded. */
  onChanged?: () => void;
}

/**
 * "Send homework" bottom sheet: share a deck (with a confirm step; if the
 * deck was already shared, offer to update the student's copy instead of
 * creating a duplicate) or assign a lesson from the library.
 */
export function SendHomeworkSheet({ relId, studentName, sharedDecks, assignedLessons, initialTab = 'decks', onClose, onChanged }: Props) {
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pendingDeck, setPendingDeck] = useState<Deck | null>(null);
  const [priority, setPriority] = useState<'core' | 'non_urgent'>('core');
  const [pendingLesson, setPendingLesson] = useState<LibraryItemSummary | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // How they do it (docs/HOMEWORK.md "Defaults"): Both — a one-off pass by a date, then long-term review —
  // due at the student's next logged lesson, else in two days, until the tutor picks otherwise.
  const lessonLogQuery = useQuery({ queryKey: ['lessonLog', relId], queryFn: () => getLessonLog(relId), retry: 1 });
  const defaults = useMemo(() => sendDefaults(localDate(), lessonLogQuery.data ?? []), [lessonLogQuery.data]);
  const [mode, setMode] = useState<HomeworkMode>(defaults.mode);
  const [chosenDue, setDueDate] = useState<string | null>(null);
  const dueDate = chosenDue ?? defaults.dueDate;
  const [splitDays, setSplitDays] = useState(1);
  const [skipKnown, setSkipKnown] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const decksQuery = useQuery({ queryKey: ['decks'], queryFn: getDecks, enabled: tab === 'decks' });
  const libraryQuery = useQuery({ queryKey: ['lesson-library'], queryFn: listLibrary, enabled: tab === 'lessons', retry: 1 });
  const pendingDeckQuery = useQuery({ queryKey: ['deck', pendingDeck?.id], queryFn: () => getDeck(pendingDeck!.id), enabled: !!pendingDeck });
  const wordCount = pendingDeckQuery.data?.notes.length ?? 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sharedDecks', relId] });
    queryClient.invalidateQueries({ queryKey: ['student-overview', relId] });
    queryClient.invalidateQueries({ queryKey: ['student-lessons', relId] });
    queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['relationship-homework', relId] });
    onChanged?.();
  };

  const how = (kind: 'deck' | 'lesson') => sendHow(kind, { mode, dueDate, splitDays, priority });

  const shareMutation = useMutation({
    mutationFn: async (deck: Deck) => {
      const res = await assignHomework(relId, [{ kind: 'deck', source_id: deck.id, mode, due_date: hasOneOff(mode) ? dueDate : null, split_days: splitDays, priority, skip_known: skipKnown }]);
      if (res.assignments.length === 0) throw new Error(res.errors[0]?.error ?? 'Could not send the deck');
      return res;
    },
    onSuccess: (res, deck) => {
      track('tutor.send_homework', { items: 1, mode, kind: 'deck', split_days: hasOneOff(mode) ? splitDays : null });
      const skipped = res.skipped.reduce((n, s) => n + s.hanzi.length, 0);
      setResult(`Sent ${deck.name} to ${studentName} ${how('deck')}.${skipped > 0 ? ` Left out ${plural(skipped, 'word')} they already have (${res.skipped.flatMap((s) => s.hanzi).slice(0, 6).join('、')}${skipped > 6 ? '…' : ''}).` : ''}`);
      setPendingDeck(null);
      setError(null);
      invalidate();
    },
    onError: (err: Error) => {
      trackError('send_homework', err);
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (sharedDeckId: string) => updateSharedDeckCopy(relId, sharedDeckId),
    onSuccess: (res, _id) => {
      track('deck.share', { update: true });
      const name = pendingDeck?.name ?? 'the deck';
      setResult(
        res.added === 0 && res.audio_filled === 0
          ? `${studentName}'s copy of ${name} is already up to date.`
          : `Added ${plural(res.added, 'new word')} to ${studentName}'s copy of ${name}${res.audio_filled ? ` (and audio for ${res.audio_filled})` : ''}. Their progress is kept.`
      );
      setPendingDeck(null);
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const assignMutation = useMutation({
    mutationFn: (item: LibraryItemSummary) => assignHomework(relId, [{ kind: 'lesson', source_id: item.id, mode, due_date: hasOneOff(mode) ? dueDate : null }]),
    onSuccess: (res, item) => {
      if (res.errors.length) setError(res.errors[0].error);
      else {
        track('tutor.send_homework', { items: 1, mode, kind: 'lesson' });
        setResult(`Assigned ${item.title} to ${studentName} ${hasOneOff(mode) ? how('lesson') : '— it will appear in their next study session'}.`);
      }
      setPendingLesson(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const ownDecks = (decksQuery.data ?? []).filter((d) => d.user_id !== null);
  const existingShare = (deck: Deck) => sharedDecks.find((sd) => sd.source_deck_id === deck.id) ?? null;
  const alreadyAssigned = (item: LibraryItemSummary) => assignedLessons.some((l) => l.title === item.title);
  const busy = shareMutation.isPending || updateMutation.isPending || assignMutation.isPending;

  return (
    <div className="td-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="td-sheet" role="dialog" aria-modal="true" aria-labelledby="td-send-title" onClick={(e) => e.stopPropagation()}>
        <div className="td-sheet-head">
          <h2 id="td-send-title">Send homework to {studentName}</h2>
          <button type="button" className="td-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!pendingDeck && !pendingLesson && (
          <div className="td-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'decks'} className={`td-tab ${tab === 'decks' ? 'active' : ''}`} onClick={() => setTab('decks')}>
              📚 A deck
            </button>
            <button type="button" role="tab" aria-selected={tab === 'lessons'} className={`td-tab ${tab === 'lessons' ? 'active' : ''}`} onClick={() => setTab('lessons')}>
              🎓 A lesson
            </button>
          </div>
        )}

        <div className="td-sheet-body">
          {!isOnline && <div className="td-error">You're offline — homework can't be sent right now.</div>}
          {result && <div className="td-result" role="status">{result}</div>}
          {error && <div className="td-error" role="alert">{error}</div>}

          {/* ---- Confirm: share or update ---- */}
          {pendingDeck && (() => {
            const existing = existingShare(pendingDeck);
            return (
              <div className="td-confirm">
                <h3>{existing ? `${pendingDeck.name} was already sent` : `Send ${pendingDeck.name} to ${studentName}?`}</h3>
                <p>
                  {existing
                    ? `${studentName} got this deck on ${shortDate(existing.shared_at)}${existing.notes_missing > 0 ? ` and is missing ${plural(existing.notes_missing, 'newer word')}` : ' and has every word in it'}. Updating their copy adds the new words and keeps their progress; sending again would create a second copy.`
                    : `They get their own copy with all its words and audio. It shows up on their home screen after their next sync.`}
                </p>
                {!existing && (
                  <HomeworkModePicker
                    name="send-deck"
                    mode={mode}
                    onMode={setMode}
                    dueDate={dueDate}
                    onDueDate={setDueDate}
                    nextLesson={defaults.nextLesson}
                    wordCount={wordCount}
                    splitDays={splitDays}
                    onSplitDays={setSplitDays}
                  />
                )}
                {!existing && (
                  <label className="sn-check">
                    <input type="checkbox" checked={skipKnown} onChange={(e) => setSkipKnown(e.target.checked)} />
                    <span>Leave out words {studentName} already has</span>
                  </label>
                )}
                {!existing && hasFsrs(mode) && (
                  <div className="td-priority" role="radiogroup" aria-label="Where it goes in their queue">
                    <button type="button" role="radio" aria-checked={priority === 'core'} className={`td-priority-opt${priority === 'core' ? ' selected' : ''}`} onClick={() => setPriority('core')}>
                      <strong>Core</strong>
                      <span>Top of their queue — studied next</span>
                    </button>
                    <button type="button" role="radio" aria-checked={priority === 'non_urgent'} className={`td-priority-opt${priority === 'non_urgent' ? ' selected' : ''}`} onClick={() => setPriority('non_urgent')}>
                      <strong>Non-urgent</strong>
                      <span>Bottom of their queue — after what they have</span>
                    </button>
                  </div>
                )}
                <div className="td-confirm-actions sheet-footer">
                  {existing ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy || !isOnline} onClick={() => updateMutation.mutate(existing.shared_deck_id)}>
                        {updateMutation.isPending ? 'Updating…' : `Update their copy${existing.notes_missing > 0 ? ` (+${existing.notes_missing})` : ''}`}
                      </button>
                      <button type="button" className="btn btn-secondary" disabled={busy || !isOnline} onClick={() => shareMutation.mutate(pendingDeck)}>
                        {shareMutation.isPending ? 'Sending…' : 'Send a second copy anyway'}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-primary" disabled={busy || !isOnline} onClick={() => shareMutation.mutate(pendingDeck)}>
                      {shareMutation.isPending ? 'Sending…' : `Send ${pendingDeck.name}`}
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPendingDeck(null)}>
                    Back
                  </button>
                </div>
              </div>
            );
          })()}

          {pendingLesson && (
            <div className="td-confirm">
              <h3>Assign {pendingLesson.title} to {studentName}?</h3>
              <p>
                {plural(pendingLesson.exercise_count, 'exercise')} · they get their own copy{lessonWhere(mode)}.
                {alreadyAssigned(pendingLesson) ? ' They already have a lesson with this title.' : ''}
              </p>
              <HomeworkModePicker name="send-lesson" mode={mode} onMode={setMode} dueDate={dueDate} onDueDate={setDueDate} nextLesson={defaults.nextLesson} />
              <div className="td-confirm-actions sheet-footer">
                <button type="button" className="btn btn-primary" disabled={busy || !isOnline} onClick={() => assignMutation.mutate(pendingLesson)}>
                  {assignMutation.isPending ? 'Assigning…' : 'Assign lesson'}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPendingLesson(null)}>
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ---- Deck list ---- */}
          {!pendingDeck && !pendingLesson && tab === 'decks' && (
            <>
              {decksQuery.isLoading && <Loading message="Loading your decks…" />}
              {decksQuery.isError && <div className="td-error">Couldn't load your decks.</div>}
              {decksQuery.data && ownDecks.length === 0 && (
                <p className="td-muted">
                  You have no decks yet. <Link to="/">Create one</Link> or <Link to="/generate">generate one</Link> first.
                </p>
              )}
              {ownDecks.map((deck) => {
                const existing = existingShare(deck);
                return (
                  <button key={deck.id} type="button" className="td-option" disabled={busy} onClick={() => { setResult(null); setError(null); setPendingDeck(deck); }}>
                    <span className="td-option-main">
                      <div className="td-option-title">{deck.name}</div>
                      <div className="td-option-meta">
                        {existing
                          ? `Sent ${shortDate(existing.shared_at)}${existing.notes_missing > 0 ? ` · ${plural(existing.notes_missing, 'new word')} to send` : ' · up to date'}`
                          : deck.description || 'Not sent yet'}
                      </div>
                    </span>
                    <span className="td-chevron">›</span>
                  </button>
                );
              })}
            </>
          )}

          {/* ---- Lesson list ---- */}
          {!pendingDeck && !pendingLesson && tab === 'lessons' && (
            <>
              {libraryQuery.isLoading && <Loading message="Loading your library…" />}
              {libraryQuery.isError && <div className="td-error">Couldn't load your lesson library.</div>}
              {libraryQuery.data && libraryQuery.data.length === 0 && (
                <p className="td-muted">
                  Your library is empty. <Link to="/library">Write or generate a lesson</Link> first.
                </p>
              )}
              {(libraryQuery.data ?? []).map((item) => (
                <button key={item.id} type="button" className="td-option" disabled={busy} onClick={() => { setResult(null); setError(null); setPendingLesson(item); }}>
                  <span className="td-option-main">
                    <div className="td-option-title">{item.icon || '🎓'} {item.title}</div>
                    <div className="td-option-meta">
                      {plural(item.exercise_count, 'exercise')}
                      {alreadyAssigned(item) ? ' · already assigned' : item.assignment_count > 0 ? ` · sent to ${plural(item.assignment_count, 'student')}` : ''}
                    </div>
                  </span>
                  <span className="td-chevron">›</span>
                </button>
              ))}
              {libraryQuery.data && libraryQuery.data.length > 0 && (
                <p className="td-muted td-mt">
                  <Link to="/library">Open the library</Link> to write a new lesson.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
