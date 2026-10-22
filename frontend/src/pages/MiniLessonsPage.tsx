/**
 * Mini Lessons — every mini lesson (shared/lesson): what is to do (new ones and revisions due),
 * revisions coming later, and the ones done for good — with how big each is and exactly which
 * exercises it holds. Lessons revise until right first time (shared/study/lessonRevision.ts):
 * everything right first time → done forever; otherwise a revision a week later. They are done
 * from here and from Home's homework / to-do card (not the study session): ▶ Start / ▶ Revision /
 * ▶ Continue / ▶ Do it again (`/lessons/:id/play`, LessonReplayPage).
 *
 * Online it lists everything from the server (including completed lessons);
 * offline it falls back to the locally cached pending lessons.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { CustomLessonSpec, LessonExercise, countScoreable, EXERCISE_TYPE_INFO, exercisePrimaryText } from '@shared/lesson';
import { computeLessonLearnState, isRevisionDue, revisionKeys, type LessonLearnState } from '@shared/study/lessonRevision';
import { lessonSteps, type SavedLessonRunCore } from '@shared/study/lessonRun';
import { lessonSizeLabel, revisionSizeLabel } from '@shared/homework';
import { getCustomLessons, deleteCustomLessonById, CustomLessonListItem } from '../api/client';
import { db, getStudyCutoff, type LocalRevisitEvent } from '../db/database';
import { learnChip, runRecord } from '../services/lessonLearn';
import { lessonRunsInProgress } from '../services/lessonRuns';
import { Loading } from '../components/Loading';
import { ReadyToUnlock, type LockedLessonItem } from '../components/lesson/ReadyToUnlock';
import { earlierUnlock, lessonLockStatus } from '@shared/lesson';
import { LESSON_UNLOCKED_EVENT, listenedHere, unlockLesson } from '../services/lessonUnlock';
import { cachedLessonList } from '../services/audioLessons';
import './MiniLessonsPage.css';

/** The lesson's state (shared/study/lessonRevision.ts) from its runs + the old Done-for-good marks. */
function learnFor(lesson: CustomLessonListItem, marks: LocalRevisitEvent[]): LessonLearnState {
  const runs = (lesson.completions ?? []).map(c => ({ id: c.id, at: c.completed_at, rating: c.rating ?? null, outcome: c.outcome ?? null }));
  const own = marks.filter(m => m.item_kind === 'lesson' && m.item_id === lesson.id).map(m => ({ id: m.id, at: m.created_at, action: m.action }));
  return computeLessonLearnState(runs, own);
}

const EXERCISE_LABELS = Object.fromEntries(
  Object.values(EXERCISE_TYPE_INFO).map(info => [info.type, `${info.icon} ${info.name}`]),
) as Record<LessonExercise['type'], string>;

function exerciseSummary(ex: LessonExercise): string {
  switch (ex.type) {
    case 'note':
      return ex.title || (ex.body ? `${ex.body.slice(0, 70)}${ex.body.length > 70 ? '…' : ''}` : `${ex.sentences?.length ?? 0} example sentence(s)`);
    case 'scramble':
      return ex.english;
    case 'choice':
      return ex.question;
    case 'translate':
      return ex.english;
    case 'match':
      return ex.pairs.map(p => p.hanzi).join(' · ');
    case 'describe_image':
      return ex.task || ex.reference_hanzi;
    case 'speak':
      return ex.prompt;
    case 'listen_choice':
      return ex.question || ex.audio.hanzi;
    case 'listen_translate':
      return ex.audio.hanzi;
    default:
      return exercisePrimaryText(ex);
  }
}

function exerciseCount(spec: CustomLessonSpec): number {
  return spec.sections.reduce((sum, s) => sum + s.exercises.length, 0);
}

function LessonCard({ lesson, learn, run, onDelete, deleting }: {
  lesson: CustomLessonListItem;
  learn: LessonLearnState;
  /** A run in progress on this device. */
  run: SavedLessonRunCore | undefined;
  onDelete: (lesson: CustomLessonListItem) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const created = new Date(lesson.created_at + (lesson.created_at.endsWith('Z') ? '' : 'Z'));
  const cutoff = getStudyCutoff().ts;
  const chip = learnChip(learn, cutoff);
  const revision = learn.status === 'revision';
  const due = isRevisionDue(learn, cutoff);
  const steps = lessonSteps(lesson.spec);
  const revKeys = revision ? revisionKeys(learn, steps, lesson.id) : [];
  const size = revision ? revisionSizeLabel(revKeys.length, lessonSteps(lesson.spec, revKeys).map(s => s.type)) : lessonSizeLabel(steps.map(s => s.type));
  const play = run
    ? { to: `/lessons/${lesson.id}/play?from=lessons_page${run.mode === 'revision' ? '&mode=revision' : ''}`, label: '▶ Continue' }
    : revision
      ? { to: `/lessons/${lesson.id}/play?from=lessons_page&mode=revision`, label: due ? '▶ Revision' : '▶ Revise now' }
      : { to: `/lessons/${lesson.id}/play?from=lessons_page`, label: learn.status === 'new' ? '▶ Start' : '▶ Do it again' };

  return (
    <div className="mini-lesson-card">
      <div className="mini-lesson-head" onClick={() => setExpanded(!expanded)}>
        <div className="mini-lesson-icon">{lesson.icon || '🎓'}</div>
        <div className="mini-lesson-titles">
          <div className="mini-lesson-title">{lesson.title}</div>
          {lesson.description && <div className="mini-lesson-desc">{lesson.description}</div>}
          <div className="mini-lesson-meta" data-testid="mini-lesson-size">
            {size || `${exerciseCount(lesson.spec)} exercises (${countScoreable(lesson.spec)} scored)`}
            {learn.runs > 0 && ` · done ${learn.runs}×`}
            {' · '}from {lesson.source}
            {' · '}{created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </div>
        </div>
        <span className={`mini-lesson-status ${chip.cls}`}>{chip.label}</span>
      </div>
      {/* Play it from here: the real player (LessonReplayPage) — a run in progress continues, a
          revision plays what was missed (+ a few), a new lesson starts, a done one is "Do it again". */}
      <div className="mini-lesson-play-row">
        <Link
          to={play.to}
          className="btn btn-primary btn-sm mini-lesson-play"
          data-testid={`lesson-play-${lesson.id}`}
        >
          {play.label}
        </Link>
        {revision && !run && (
          <Link to={`/lessons/${lesson.id}/play?from=lessons_page`} className="mini-lesson-parts" data-testid={`lesson-whole-${lesson.id}`}>
            Whole lesson
          </Link>
        )}
        <button type="button" className="mini-lesson-parts" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? 'Hide the parts' : 'See the parts'}
        </button>
      </div>

      {expanded && (
        <div className="mini-lesson-detail">
          {lesson.spec.sections.map((section, si) => (
            <div key={si} className="mini-lesson-section">
              {section.title && <div className="mini-lesson-section-title">{section.title}</div>}
              {section.exercises.map((ex, ei) => (
                <div key={ei} className="mini-lesson-exercise">
                  <span className="mini-lesson-exercise-type">{EXERCISE_LABELS[ex.type] ?? ex.type}</span>
                  <span className="mini-lesson-exercise-text">{exerciseSummary(ex)}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="mini-lesson-actions">
            <Link to={`/lessons/${lesson.id}/edit`} className="btn btn-primary btn-sm">✏️ Edit</Link>
            {learn.runs > 0 && (
              <Link to={`/lesson-attempts?lesson=${lesson.id}`} className="btn btn-secondary btn-sm">📝 My answers</Link>
            )}
            <button
              className="btn btn-secondary btn-sm mini-lesson-delete"
              onClick={() => onDelete(lesson)}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : '🗑 Delete lesson'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MiniLessonsPage() {
  const queryClient = useQueryClient();

  const lessonsQuery = useQuery({
    queryKey: ['custom-lessons-all'],
    queryFn: () => getCustomLessons('all'),
    retry: 1,
  });

  // Offline fallback: the locally cached lessons, with their local completion
  // events attached so the schedule chips still compute.
  const localLessons = useLiveQuery(async () => {
    const [lessons, events] = await Promise.all([
      db.customLessons.toArray(),
      db.customLessonCompletionEvents.toArray(),
    ]);
    return lessons.map(l => ({
      lesson: l,
      completions: events
        .filter(e => e.lesson_id === l.id)
        .map(e => ({
          id: e.id,
          lesson_id: e.lesson_id,
          correct: e.correct,
          total: e.total,
          completed_at: e.completed_at,
          rating: e.rating,
          outcome: runRecord(e).outcome,
        })),
    }));
  }, []);

  // The old Done-for-good marks (a retire = done forever).
  const marks = useLiveQuery(() => db.revisitEvents.toArray(), []) ?? [];
  // Runs in progress on this device ("▶ Continue").
  const runs = useLiveQuery(() => lessonRunsInProgress(), []) ?? new Map<string, SavedLessonRunCore>();
  // This device's unlocks (pending ones count at once, before the server list has them).
  const localUnlocks = useLiveQuery(() => db.lessonUnlocks.toArray(), []) ?? [];
  const [unlocking, setUnlocking] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['custom-lessons-all'] }); };
    window.addEventListener(LESSON_UNLOCKED_EVENT, refresh);
    return () => window.removeEventListener(LESSON_UNLOCKED_EVENT, refresh);
  }, [queryClient]);

  const deleteMutation = useMutation({
    mutationFn: async (lesson: CustomLessonListItem) => {
      await deleteCustomLessonById(lesson.id);
      await db.customLessons.delete(lesson.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-lessons-all'] }),
  });

  const handleDelete = (lesson: CustomLessonListItem) => {
    if (!confirm(`Delete "${lesson.title}"? This can't be undone.`)) return;
    deleteMutation.mutate(lesson);
  };

  if (lessonsQuery.isLoading) return <Loading />;

  const serverLessons = lessonsQuery.data;
  const lessons: CustomLessonListItem[] = serverLessons
    ?? (localLessons ?? []).map(({ lesson, completions }) => ({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      icon: lesson.icon,
      source: lesson.source,
      status: lesson.status,
      created_at: lesson.created_at,
      spec: lesson.spec,
      completions,
      unlock: lesson.unlock ?? null,
      unlocked_at: lesson.unlocked_at ?? null,
      companion_of: lesson.companion_of ?? null,
    }));

  // Locked lessons (shared/lesson/unlock.ts) wait in "Ready to unlock" and nowhere else.
  // Three sources, the earliest wins: the server list (refetched the moment I unlock — usually
  // before the unlock has been uploaded), this device's pending unlocks (forgotten once a sync sees
  // the server carry it) and the cached lesson row (where that sync put it). With only the first
  // two, a sync landing between the upload and the next refetch left the page showing the lesson
  // locked again (unlockable-lessons.spec, flaky in CI).
  const cachedUnlockedAt = new Map((localLessons ?? []).map(({ lesson }) => [lesson.id, lesson.unlocked_at ?? null]));
  const unlockedAt = (l: CustomLessonListItem) =>
    earlierUnlock(
      earlierUnlock(l.unlocked_at ?? null, localUnlocks.find(u => u.lesson_id === l.id)?.unlocked_at ?? null),
      cachedUnlockedAt.get(l.id) ?? null,
    );
  const audioTitles = new Map(cachedLessonList().map(a => [a.id, a]));
  const locked: LockedLessonItem[] = lessons
    .filter(l => l.unlock && lessonLockStatus(l.unlock, unlockedAt(l)) === 'locked')
    .map(l => {
      const audio = l.unlock!.kind === 'audio_lesson' ? audioTitles.get(l.unlock!.audio_lesson_id) : undefined;
      return {
        id: l.id, title: l.title, icon: l.icon, unlock: l.unlock!,
        audioTitle: audio?.title ?? null,
        listened: l.unlock!.kind === 'audio_lesson' && !!(audio?.listened_at || listenedHere(l.unlock!.audio_lesson_id)),
      };
    });
  const lockedIds = new Set(locked.map(l => l.id));
  const handleUnlock = async (item: LockedLessonItem) => {
    setUnlocking(item.id);
    try {
      await unlockLesson(item.id, 'manual', item.unlock.kind);
    } finally {
      setUnlocking(null);
    }
  };

  // Revise until right first time: to do (a run in progress, revisions due, new ones), revisions
  // coming later, and done for good (everything right first time).
  const cutoff = getStudyCutoff();
  const withLearn = lessons.filter(l => !lockedIds.has(l.id)).map(lesson => ({ lesson, learn: learnFor(lesson, marks) }));
  const toDo = withLearn.filter(x => runs.has(x.lesson.id) || x.learn.status === 'new' || isRevisionDue(x.learn, cutoff.ts))
    .sort((a, b) => Number(runs.has(b.lesson.id)) - Number(runs.has(a.lesson.id)) || (a.learn.status === 'revision' ? 0 : 1) - (b.learn.status === 'revision' ? 0 : 1));
  const toDoIds = new Set(toDo.map(x => x.lesson.id));
  const later = withLearn.filter(x => !toDoIds.has(x.lesson.id) && x.learn.status === 'revision')
    .sort((a, b) => (a.learn.due_ms ?? 0) - (b.learn.due_ms ?? 0));
  const done = withLearn.filter(x => !toDoIds.has(x.lesson.id) && x.learn.status === 'done');
  const card = ({ lesson, learn }: { lesson: CustomLessonListItem; learn: LessonLearnState }) => (
    <LessonCard
      key={lesson.id}
      lesson={lesson}
      learn={learn}
      run={runs.get(lesson.id)}
      onDelete={handleDelete}
      deleting={deleteMutation.isPending && deleteMutation.variables?.id === lesson.id}
    />
  );

  return (
    <div className="page">
      <div className="container mini-lessons-page">
        <h1>🎓 Mini Lessons</h1>
        <p className="text-light mini-lessons-sub">
          Lessons from your tutor and from Claude. Get everything right first time and a lesson is
          done for good; anything you miss comes back a week later as a short revision.
        </p>
        {!serverLessons && (
          <p className="mini-lessons-offline-note">
            Offline — showing the lessons cached on this device.
          </p>
        )}

        <ReadyToUnlock items={locked} onUnlock={item => void handleUnlock(item)} busyId={unlocking} />

        <h2 className="mini-lessons-heading">To do ({toDo.length})</h2>
        {toDo.length === 0 && (
          <p className="text-light">
            Nothing waiting. Ask Claude for one — during study, in the Sentence
            Coach, or from any connected Claude chat: “make me a mini lesson on …”
          </p>
        )}
        {toDo.map(card)}

        {later.length > 0 && (
          <>
            <h2 className="mini-lessons-heading">Revision coming ({later.length})</h2>
            {later.map(card)}
          </>
        )}

        {done.length > 0 && (
          <>
            <h2 className="mini-lessons-heading">Done for good ({done.length})</h2>
            <p className="text-light" style={{ fontSize: '0.875rem' }}>Everything right first time. Do one again any time.</p>
            {done.map(card)}
          </>
        )}
      </div>
    </div>
  );
}
