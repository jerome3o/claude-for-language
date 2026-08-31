/**
 * Mini Lessons — inspect the agent-authored custom lessons (shared/lesson):
 * what's waiting in the study queue, what's been completed, and exactly which
 * exercises each lesson holds. Lessons are created by agents (MCP tools, the
 * in-app chats); this page is for looking and pruning, not authoring.
 *
 * Online it lists everything from the server (including completed lessons);
 * offline it falls back to the locally cached pending lessons.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { CustomLessonSpec, LessonExercise, countScoreable } from '@shared/lesson';
import { computeCardState, DEFAULT_DECK_SETTINGS } from '@shared/scheduler';
import { getCustomLessons, deleteCustomLessonById, CustomLessonListItem } from '../api/client';
import { db, getStudyCutoff } from '../db/database';
import { CardQueue, Rating } from '../types';
import { Loading } from '../components/Loading';
import './MiniLessonsPage.css';

interface LessonSchedule {
  queue: CardQueue;
  next_review_at: string | null;
  due_timestamp: number | null;
  reps: number;
}

/** FSRS state for the chip, computed from the lesson's completion events. */
function scheduleFromCompletions(lesson: CustomLessonListItem): LessonSchedule {
  const completions = lesson.completions ?? [];
  if (completions.length === 0) {
    return { queue: CardQueue.NEW, next_review_at: null, due_timestamp: null, reps: 0 };
  }
  const state = computeCardState(
    completions.map(c => ({
      id: c.id,
      card_id: c.lesson_id,
      rating: (c.rating ?? 2) as Rating,
      reviewed_at: c.completed_at,
    })),
    DEFAULT_DECK_SETTINGS,
  );
  return {
    queue: state.queue,
    next_review_at: state.next_review_at,
    due_timestamp: state.due_timestamp,
    reps: state.reps,
  };
}

function scheduleChip(schedule: LessonSchedule): { label: string; cls: string } {
  const cutoff = getStudyCutoff();
  if (schedule.queue === CardQueue.NEW) return { label: 'New', cls: 'active' };
  if (schedule.queue === CardQueue.LEARNING || schedule.queue === CardQueue.RELEARNING) {
    return { label: 'Learning', cls: 'learning' };
  }
  const dueNow = !schedule.next_review_at || schedule.next_review_at <= cutoff.iso;
  if (dueNow) return { label: 'Due today', cls: 'learning' };
  const due = new Date(schedule.next_review_at!);
  return {
    label: `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    cls: 'done',
  };
}

const EXERCISE_LABELS: Record<LessonExercise['type'], string> = {
  note: '📖 Note',
  scramble: '🧩 Word order',
  choice: '🔘 Choice',
  translate: '✍️ Translate',
  match: '🔗 Match',
  describe_image: '🖼 Describe picture',
  speak: '🎤 Speak',
  listen_choice: '👂 Listen & pick',
  listen_translate: '👂 Listen & translate',
};

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
  }
}

function exerciseCount(spec: CustomLessonSpec): number {
  return spec.sections.reduce((sum, s) => sum + s.exercises.length, 0);
}

function LessonCard({ lesson, onDelete, deleting }: {
  lesson: CustomLessonListItem;
  onDelete: (lesson: CustomLessonListItem) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const created = new Date(lesson.created_at + (lesson.created_at.endsWith('Z') ? '' : 'Z'));
  const schedule = scheduleFromCompletions(lesson);
  const chip = scheduleChip(schedule);

  return (
    <div className="mini-lesson-card">
      <div className="mini-lesson-head" onClick={() => setExpanded(!expanded)}>
        <div className="mini-lesson-icon">{lesson.icon || '🎓'}</div>
        <div className="mini-lesson-titles">
          <div className="mini-lesson-title">{lesson.title}</div>
          {lesson.description && <div className="mini-lesson-desc">{lesson.description}</div>}
          <div className="mini-lesson-meta">
            {exerciseCount(lesson.spec)} exercises ({countScoreable(lesson.spec)} scored)
            {schedule.reps > 0 && ` · studied ${schedule.reps}×`}
            {' · '}from {lesson.source}
            {' · '}{created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </div>
        </div>
        <span className={`mini-lesson-status ${chip.cls}`}>{chip.label}</span>
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
          <button
            className="btn btn-secondary btn-sm mini-lesson-delete"
            onClick={() => onDelete(lesson)}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : '🗑 Delete lesson'}
          </button>
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
        })),
    }));
  }, []);

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
    }));

  // Lessons recur on the FSRS cadence: split by whether they're up next
  // (new / learning / due today) or scheduled out.
  const cutoff = getStudyCutoff();
  const isUpNext = (lesson: CustomLessonListItem) => {
    const s = scheduleFromCompletions(lesson);
    if (s.queue === CardQueue.NEW || s.queue === CardQueue.LEARNING || s.queue === CardQueue.RELEARNING) return true;
    return !s.next_review_at || s.next_review_at <= cutoff.iso;
  };
  const upNext = lessons.filter(isUpNext);
  const scheduled = lessons.filter(l => !isUpNext(l));

  return (
    <div className="page">
      <div className="container mini-lessons-page">
        <h1>🎓 Mini Lessons</h1>
        <p className="text-light mini-lessons-sub">
          Custom lessons authored by Claude (from chat or MCP). They mix into
          your study sessions and, once rated, come back on the same FSRS
          cadence as cards.
        </p>
        {!serverLessons && (
          <p className="mini-lessons-offline-note">
            Offline — showing the lessons cached on this device.
          </p>
        )}

        <h2 className="mini-lessons-heading">Up next ({upNext.length})</h2>
        {upNext.length === 0 && (
          <p className="text-light">
            Nothing waiting. Ask Claude for one — during study, in the Sentence
            Coach, or from any connected Claude chat: “make me a mini lesson on …”
          </p>
        )}
        {upNext.map(lesson => (
          <LessonCard
            key={lesson.id}
            lesson={lesson}
            onDelete={handleDelete}
            deleting={deleteMutation.isPending && deleteMutation.variables?.id === lesson.id}
          />
        ))}

        {scheduled.length > 0 && (
          <>
            <h2 className="mini-lessons-heading">Scheduled ({scheduled.length})</h2>
            {scheduled.map(lesson => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                onDelete={handleDelete}
                deleting={deleteMutation.isPending && deleteMutation.variables?.id === lesson.id}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
