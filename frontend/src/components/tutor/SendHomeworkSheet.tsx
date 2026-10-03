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
import { listHomeworkLinks, type HomeworkLink } from '../../api/homeworkLibrary';
import { LinkCard, LinkHomeworkForm } from './library/LinkHomeworkForm';
import type { HomeworkDeck, HomeworkLesson } from '../../types/tutorDashboard';
import type { LibraryItemSummary } from '../../types/lessonEditor';
import { Loading } from '../Loading';
import { useNetwork } from '../../contexts/NetworkContext';
import { plural, shortDate } from './format';
import './tutor-dashboard.css';
import './session-notes.css';
import './library/homework-library.css';

type Tab = 'decks' | 'lessons' | 'links';

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
  // Link homework (docs/HOMEWORK.md §8): pick a saved link or make one — saved in MY account, then sent.
  const [pendingLink, setPendingLink] = useState<HomeworkLink | 'new' | null>(null);
  const [linkDue, setLinkDue] = useState(true);
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
  const linksQuery = useQuery({ queryKey: ['homework-links'], queryFn: listHomeworkLinks, enabled: tab === 'links', retry: 1 });
  const pendingDeckQuery = useQuery({ queryKey: ['deck', pendingDeck?.id], queryFn: () => getDeck(pendingDeck!.id), enabled: !!pendingDeck });
  const wordCount = pendingDeckQuery.data?.notes.length ?? 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sharedDecks', relId] });
    queryClient.invalidateQueries({ queryKey: ['student-overview', relId] });
    queryClient.invalidateQueries({ queryKey: ['student-lessons', relId] });
    queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['relationship-homework', relId] });
    queryClient.invalidateQueries({ queryKey: ['homework-library'] });
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

  const linkMutation = useMutation({
    mutationFn: async (link: HomeworkLink) => {
      const res = await assignHomework(relId, [{ kind: 'link', source_id: link.id, mode: 'one_off', due_date: linkDue ? dueDate : null }]);
      if (res.assignments.length === 0) throw new Error(res.errors[0]?.error ?? 'Could not send the link');
      return res;
    },
    onSuccess: (_res, link) => {
      setResult(`Sent “${link.title}” to ${studentName}${linkDue ? `, due ${shortDate(dueDate)}` : ''}. It opens in their browser; they mark it done with a note for you.`);
      setPendingLink(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['homework-links'] });
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const ownDecks = (decksQuery.data ?? []).filter((d) => d.user_id !== null);
  const existingShare = (deck: Deck) => sharedDecks.find((sd) => sd.source_deck_id === deck.id) ?? null;
  const alreadyAssigned = (item: LibraryItemSummary) => assignedLessons.some((l) => l.title === item.title);
  const busy = shareMutation.isPending || updateMutation.isPending || assignMutation.isPending || linkMutation.isPending;

  return (
    <div className="td-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="td-sheet" role="dialog" aria-modal="true" aria-labelledby="td-send-title" onClick={(e) => e.stopPropagation()}>
        <div className="td-sheet-head">
          <h2 id="td-send-title">Send homework to {studentName}</h2>
          <button type="button" className="td-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!pendingDeck && !pendingLesson && !pendingLink && (
          <div className="td-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'decks'} className={`td-tab ${tab === 'decks' ? 'active' : ''}`} onClick={() => setTab('decks')}>
              📚 A deck
            </button>
            <button type="button" role="tab" aria-selected={tab === 'lessons'} className={`td-tab ${tab === 'lessons' ? 'active' : ''}`} onClick={() => setTab('lessons')}>
              🎓 A lesson
            </button>
            <button type="button" role="tab" aria-selected={tab === 'links'} className={`td-tab ${tab === 'links' ? 'active' : ''}`} onClick={() => setTab('links')} data-testid="send-link-tab">
              🔗 A link
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

          {/* ---- Link: confirm a saved one, or make one (saved in my account, then sent) ---- */}
          {pendingLink && (() => {
            const dueFields = (
              <div className="hl-due-toggle">
                <label className="sn-check">
                  <input type="checkbox" checked={linkDue} onChange={(e) => setLinkDue(e.target.checked)} data-testid="link-due-toggle" />
                  <span>Due date</span>
                </label>
                {linkDue && <input type="date" value={dueDate} min={localDate()} onChange={(e) => e.target.value && setDueDate(e.target.value)} aria-label="Due date" />}
              </div>
            );
            if (pendingLink === 'new') {
              return (
                <LinkHomeworkForm submitLabel={`Save & send to ${studentName}`} onSaved={(link) => linkMutation.mutateAsync(link).then(() => undefined)} onCancel={() => setPendingLink(null)}>
                  {dueFields}
                </LinkHomeworkForm>
              );
            }
            return (
              <div className="td-confirm">
                <h3>Send this link to {studentName}?</h3>
                <LinkCard url={pendingLink.url} title={pendingLink.title} thumbnail={pendingLink.thumbnail_url} />
                {pendingLink.instructions && <p className="hl-instructions">{pendingLink.instructions}</p>}
                {dueFields}
                <div className="td-confirm-actions">
                  <button type="button" className="btn btn-primary" disabled={busy || !isOnline} onClick={() => linkMutation.mutate(pendingLink)} data-testid="send-link-confirm">
                    {linkMutation.isPending ? 'Sending…' : 'Send link'}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPendingLink(null)}>Back</button>
                </div>
              </div>
            );
          })()}

          {!pendingDeck && !pendingLesson && !pendingLink && tab === 'links' && (
            <>
              <button type="button" className="td-option" onClick={() => { setResult(null); setError(null); setPendingLink('new'); }} data-testid="new-link">
                <span className="td-option-main">
                  <div className="td-option-title">＋ New link</div>
                  <div className="td-option-meta">A video, song, drama clip or article, with what to do</div>
                </span>
                <span className="td-chevron">›</span>
              </button>
              {linksQuery.isLoading && <Loading message="Loading your links…" />}
              {linksQuery.isError && <div className="td-error">Couldn't load your links.</div>}
              {(linksQuery.data ?? []).map((link) => (
                <button key={link.id} type="button" className="td-option" disabled={busy} onClick={() => { setResult(null); setError(null); setPendingLink(link); }}>
                  <span className="td-option-main">
                    <div className="td-option-title">🔗 {link.title}</div>
                    <div className="td-option-meta">{link.sent_count ? `Sent to ${plural(link.sent_count, 'student')}` : 'Not sent yet'}</div>
                  </span>
                  <span className="td-chevron">›</span>
                </button>
              ))}
            </>
          )}

          {/* ---- Deck list ---- */}
          {!pendingDeck && !pendingLesson && !pendingLink && tab === 'decks' && (
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
          {!pendingDeck && !pendingLesson && !pendingLink && tab === 'lessons' && (
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
