import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  homeHomework,
  homeHomeworkRows,
  homeRowKind,
  isLessonRow,
  isSkipped,
  readerSizeLabel,
  WORD_UNIT,
  type HomeHomeworkRow,
  type HomeLesson,
  type LongTermHomework,
  type RetryBar,
} from '@shared/homework';
import { EXERCISE_UNIT, savedRunBar } from '@shared/study/lessonRun';
import { tutorNotesHomeLine } from '@shared/tutor-notes';
import { useHomeworkItems } from '../homework/useHomeworkItems';
import type { HomeworkView } from './useHomework';
import { homeLessonOf, lessonSize, revisionSize, stepOptions } from '../../services/lessonLearn';
import { db, getStudyCutoff } from '../../db/database';
import { RetryProgressBar } from '../homework/RetryProgressBar';
import { RowMenuButton, useRowActions, useRowPress, type RowActionsFrom, type RowActionTarget } from '../homework/RowActions';
import { useSkipHandwriting } from '../settings/SkipHandwritingSetting';
import '../homework/homework.css';

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Lessons a tutor sent for long-term review (fsrs-mode, or before assignments existed — the old
 * "From <tutor>" pick), live from IndexedDB. Long-term DECKS are not homework rows any more
 * (docs/HOMEWORK.md §11): they are decks in the queue (Home's "Next up", the Decks tab).
 */
function useLongTerm(view: HomeworkView): LongTermHomework[] | undefined {
  const pick = view.pick;
  const legacyKey = pick?.item ? `${pick.item.kind}:${pick.item.kind === 'deck' ? pick.item.deckId : pick.item.lessonId}` : '';
  return useLiveQuery(async () => {
    const [assignments, events] = await Promise.all([db.homeworkAssignments.toArray(), db.homeworkEvents.toArray()]);
    // "Skip this homework" on a tutor's long-term lesson (docs/HOMEWORK.md §3d) takes it off the card.
    const skipped = (id: string, at: string | null | undefined) => isSkipped(events.filter((e) => e.assignment_id === id), at);
    const items: LongTermHomework[] = assignments
      .filter((a) => a.mode === 'fsrs' && a.status === 'active' && a.kind === 'lesson' && !skipped(a.id, a.skipped_at))
      .map((a) => ({ kind: 'lesson' as const, target_id: a.target_id, title: a.title, tutor_name: a.tutor_name ?? null, sent_at: a.created_at, met: null, total: null, assignment_id: a.id }));
    const item = pick?.item;
    if (pick && item?.kind === 'lesson' && !assignments.some((a) => a.target_id === item.lessonId)) {
      items.push({ kind: 'lesson', target_id: item.lessonId, title: item.title, tutor_name: pick.tutorName, sent_at: item.sentAt, met: null, total: null });
    }
    return items;
  }, [legacyKey]);
}

/**
 * Every mini lesson on the device as Home sees it (due revisions + new ones; shared/homework/home.ts)
 * and the size of each homework lesson / reader by target id ("18 exercises · ~12 min", "6 pages").
 */
function useHomeLessons(): { lessons: HomeLesson[]; sizes: Record<string, string>; runBars: Record<string, RetryBar | null> } | undefined {
  const skipHandwriting = useSkipHandwriting();
  return useLiveQuery(async () => {
    const cutoff = getStudyCutoff().ts;
    const [rows, assignments, readers, runs] = await Promise.all([
      db.customLessons.toArray(),
      db.homeworkAssignments.toArray(),
      db.readers.toArray().catch(() => []),
      db.lessonRuns.toArray().catch(() => []),
    ]);
    const specs = new Map(rows.map((r) => [r.id, r.spec]));
    // A lesson started on this device: its run's retry bar (blue answered · orange owed); none = no bar.
    const runBars: Record<string, RetryBar | null> = {};
    for (const run of runs) {
      const spec = specs.get(run.lesson_id);
      if (spec) runBars[run.lesson_id] = savedRunBar(run, run.lesson_id, spec, stepOptions(skipHandwriting));
    }
    const tutorOf = new Map<string, string | null>();
    for (const a of assignments) if (a.kind === 'lesson' && a.tutor_name) tutorOf.set(a.target_id, a.tutor_name);
    const sizes: Record<string, string> = {};
    const lessons = rows.map((row) => {
      const home = homeLessonOf(row, cutoff, tutorOf.get(row.id) ?? null);
      // A homework row of a lesson whose revision is due plays the revision: its size, else the whole lesson's.
      sizes[row.id] = home.revision_due ? revisionSize(row) : lessonSize(row.spec);
      return home;
    });
    for (const r of readers) sizes[r.id] = readerSizeLabel(r.pages?.length ?? 0);
    return { lessons, sizes, runBars };
  }, [skipHandwriting]);
}

/**
 * The card's lesson rows — revisions due + new lessons a tutor sent for long-term review — all of
 * them, for /homework's "Mini lessons" section (what Home's "+N more" also counts).
 */
export function useHomeworkLessonRows(view: HomeworkView): HomeHomeworkRow[] | undefined {
  const items = useHomeworkItems();
  const longTerm = useLongTerm(view);
  const homeLessons = useHomeLessons();
  return useMemo(() => {
    if (!items || !longTerm || !homeLessons) return undefined;
    return homeHomeworkRows(items.todo, longTerm, { lessons: homeLessons.lessons, sizes: homeLessons.sizes, runBars: homeLessons.runBars }).filter(isLessonRow);
  }, [items, longTerm, homeLessons]);
}

/** What a row's ⋯ / long-press menu acts on (shared/homework/row-actions.ts). */
export function rowActionTarget(row: HomeHomeworkRow): RowActionTarget {
  return {
    kind: homeRowKind(row),
    title: row.title,
    tutor_name: row.tutor_name,
    assignment_id: row.assignment_id,
    assignment_kind: row.assignment_id ? (row.kind === 'revision' ? 'lesson' : row.kind) : null,
    lesson_id: row.lesson_id,
  };
}

/**
 * One slim row: icon, title, progress, size, due label — and, once started, the retry bar (blue
 * answered, orange still owed; shared/homework/retry-bar.ts). Long-press / right-click / ⋯ opens
 * the row's menu (Skip this homework · Done for good · Delete · Skip handwriting).
 */
export function HomeworkRowSlim({ row, onMenu }: { row: HomeHomeworkRow; onMenu?: (row: HomeHomeworkRow) => void }) {
  const press = useRowPress(() => onMenu?.(row));
  const unit = row.kind === 'deck' ? WORD_UNIT : EXERCISE_UNIT;
  return (
    <div className="hw-slim-row" data-testid="home-hw-row-wrap">
      <Link
        to={row.route}
        className="hw-slim"
        data-testid="home-hw-row"
        aria-label={`${row.title}, ${row.progress}${row.size ? `, ${row.size}` : ''}${row.due ? `, ${row.due}` : ''}`}
        {...(onMenu ? press.handlers : {})}
        onClick={(e) => { if (onMenu && press.suppressTap()) e.preventDefault(); }}
      >
        <span className="hw-slim-icon" aria-hidden="true">{row.icon}</span>
        <span className="hw-slim-main">
          <span className="hw-slim-line">
            <span className="hw-slim-title" lang="zh">{row.title}</span>
            {row.progress && <span className="hw-slim-progress">{row.progress}</span>}
          </span>
          {row.size && <span className="hw-slim-size" data-testid="hw-size">{row.size}</span>}
          {row.bar && <RetryProgressBar bar={row.bar} unit={unit} className="hw-slim-retry-bar" testId="hw-row-bar" />}
        </span>
        {row.due && <span className={`hw-slim-due hw-slim-due-${row.tone}`} data-testid="hw-due">{row.due}</span>}
      </Link>
      {onMenu && <RowMenuButton onClick={() => onMenu(row)} label={row.title} />}
    </div>
  );
}

/** The menu for a list of slim rows (Home's card, /homework's Mini lessons). */
export function useSlimRowMenu(from: RowActionsFrom) {
  const { open, element } = useRowActions(from);
  return { onMenu: (row: HomeHomeworkRow) => open(rowActionTarget(row)), element };
}

/**
 * Home's homework card, compact: one slim row per active item (title, "5 / 12", its size —
 * "18 exercises · ~12 min", "12 words", "6 pages" —, due label, a thin bar), then mini lesson
 * revisions due ("🔁 Revision 1 · 5 questions · ~4 min · due today") and new mini lessons a tutor
 * sent for long-term review (they are no longer in the study session; his own never-started
 * lessons and cancelled ones stay on Mini Lessons only); "+N more" → /homework, which lists the
 * same rows; a tap opens it — the pass for one-off / both items (the lesson / reader player for those
 * kinds). An unread tutor message is one small line.
 * Hidden when there is nothing. Rows come from the shared `homeHomework` (Lab app: same rules).
 */
export function HomeworkHomeCard({ view }: { view: HomeworkView }) {
  const items = useHomeworkItems();
  const longTerm = useLongTerm(view);
  const homeLessons = useHomeLessons();
  const unread = view.pick?.unreadMessage ?? null;
  const menu = useSlimRowMenu('home');
  const model = useMemo(
    () =>
      homeHomework(items?.todo ?? [], longTerm ?? [], {
        unreadFrom: unread ? view.pick?.tutorName ?? null : null,
        lessons: homeLessons?.lessons ?? [],
        sizes: homeLessons?.sizes ?? {},
        runBars: homeLessons?.runBars ?? {},
      }),
    [items, longTerm, unread, view.pick?.tutorName, homeLessons]
  );
  if (!items || (model.rows.length === 0 && !unread)) return <>{menu.element}</>;

  return (
    <section className="card hw-home" aria-label="Homework" data-testid="homework-home-card">
      <div className="hw-home-head">
        <h2>{model.heading}</h2>
        <Link to="/homework" className="hw-home-all">
          {model.more > 0 ? `+${model.more} more ›` : 'All ›'}
        </Link>
      </div>
      {model.rows.length > 0 && (
        <div className="hw-slim-list">
          {model.rows.map((row) => <HomeworkRowSlim key={row.key} row={row} onMenu={menu.onMenu} />)}
        </div>
      )}
      {menu.element}
      {unread && view.pick && (
        <Link to={`/connections/${view.pick.relationshipId}/chat/${unread.conversationId}`} className="hw-home-message" data-testid="home-hw-message">
          <span aria-hidden="true">💬</span>
          <span className="hw-home-message-text">{unread.text ? `“${truncate(unread.text, 48)}”` : `New message from ${view.pick.tutorName}`}</span>
          <span className="hw-home-message-dot" aria-label="unread" />
        </Link>
      )}
    </section>
  );
}

/** "🗒 3 new notes from 明慧老师 ›" — only while a tutor note is unseen; opens /tutor-notes. */
export function TutorNotesHomeRow() {
  const line = useLiveQuery(async () => {
    const rows = await db.recordingNotes.toArray();
    return tutorNotesHomeLine(rows.filter((r) => r.seen_at === null));
  }, []);
  if (!line) return null;
  return (
    <Link to="/tutor-notes" className="card hw-notes-row" data-testid="home-tutor-notes">
      <span aria-hidden="true">🗒</span>
      <span className="hw-notes-row-text">{line}</span>
      <span className="hw-notes-row-chevron" aria-hidden="true">›</span>
    </Link>
  );
}
