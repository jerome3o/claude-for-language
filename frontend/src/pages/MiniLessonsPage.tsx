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
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { CustomLessonSpec, LessonExercise, countScoreable, EXERCISE_TYPE_INFO, exercisePrimaryText } from '@shared/lesson';
import { computeRevisitState, type RevisitEvent, type RevisitSettings, type RevisitState } from '@shared/study/revisit';
import { getCustomLessons, deleteCustomLessonById, CustomLessonListItem } from '../api/client';
import { db, getStudyCutoff, type LocalRevisitEvent } from '../db/database';
import { markRevisit, readRevisitSettings, revisitChip } from '../services/revisit';
import { Loading } from '../components/Loading';
import './MiniLessonsPage.css';

/** The lesson's "revisit later" schedule (shared/study/revisit.ts) from its
 * completions + this device's Done-for-good / Bring-back events. */
function scheduleFor(lesson: CustomLessonListItem, marks: LocalRevisitEvent[], settings: RevisitSettings): RevisitState {
  const history: RevisitEvent[] = (lesson.completions ?? []).map(c => ({ id: c.id, at: c.completed_at, kind: 'rating' as const, rating: c.rating ?? null }));
  for (const m of marks) if (m.item_kind === 'lesson' && m.item_id === lesson.id) history.push({ id: m.id, at: m.created_at, kind: m.action });
  return computeRevisitState(history, settings);
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

function LessonCard({ lesson, schedule, onDelete, deleting }: {
  lesson: CustomLessonListItem;
  schedule: RevisitState;
  onDelete: (lesson: CustomLessonListItem) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const created = new Date(lesson.created_at + (lesson.created_at.endsWith('Z') ? '' : 'Z'));
  const chip = revisitChip(schedule, getStudyCutoff().ts);
  const retired = schedule.status === 'retired';

  return (
    <div className="mini-lesson-card">
      <div className="mini-lesson-head" onClick={() => setExpanded(!expanded)}>
        <div className="mini-lesson-icon">{lesson.icon || '🎓'}</div>
        <div className="mini-lesson-titles">
          <div className="mini-lesson-title">{lesson.title}</div>
          {lesson.description && <div className="mini-lesson-desc">{lesson.description}</div>}
          <div className="mini-lesson-meta">
            {exerciseCount(lesson.spec)} exercises ({countScoreable(lesson.spec)} scored)
            {schedule.finishes > 0 && ` · studied ${schedule.finishes}×`}
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
          <div className="mini-lesson-actions">
            <Link to={`/lessons/${lesson.id}/edit`} className="btn btn-primary btn-sm">✏️ Edit</Link>
            {retired ? (
              <button className="btn btn-secondary btn-sm" onClick={() => void markRevisit('lesson', lesson.id, 'restore')} data-testid="lesson-bring-back">
                ↩ Bring back
              </button>
            ) : schedule.finishes > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => void markRevisit('lesson', lesson.id, 'retire', 'list')}>
                ✓ Done for good
              </button>
            )}
            {schedule.finishes > 0 && (
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
        })),
    }));
  }, []);

  // Done for good / Bring back (this device's events, pending ones included) and the gaps.
  const marks = useLiveQuery(() => db.revisitEvents.toArray(), []) ?? [];
  const settings = readRevisitSettings();

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

  // Lessons come back on the "revisit later" schedule: split into up next
  // (new / due today), scheduled out, and done for good.
  const cutoff = getStudyCutoff();
  const withSchedule = lessons.map(lesson => ({ lesson, schedule: scheduleFor(lesson, marks, settings) }));
  const upNext = withSchedule.filter(x => x.schedule.status === 'new' || (x.schedule.status === 'scheduled' && (x.schedule.due_ms ?? 0) <= cutoff.ts));
  const scheduled = withSchedule.filter(x => x.schedule.status === 'scheduled' && (x.schedule.due_ms ?? 0) > cutoff.ts)
    .sort((a, b) => (a.schedule.due_ms ?? 0) - (b.schedule.due_ms ?? 0));
  const retired = withSchedule.filter(x => x.schedule.status === 'retired');
  const card = ({ lesson, schedule }: { lesson: CustomLessonListItem; schedule: RevisitState }) => (
    <LessonCard
      key={lesson.id}
      lesson={lesson}
      schedule={schedule}
      onDelete={handleDelete}
      deleting={deleteMutation.isPending && deleteMutation.variables?.id === lesson.id}
    />
  );

  return (
    <div className="page">
      <div className="container mini-lessons-page">
        <h1>🎓 Mini Lessons</h1>
        <p className="text-light mini-lessons-sub">
          Custom lessons authored by Claude (from chat or MCP). They mix into
          your study sessions; once finished, your rating decides when one comes
          back (Good: in two weeks, then longer each time — Settings → Lessons &amp; readers).
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
        {upNext.map(card)}

        {scheduled.length > 0 && (
          <>
            <h2 className="mini-lessons-heading">Coming back later ({scheduled.length})</h2>
            {scheduled.map(card)}
          </>
        )}

        {retired.length > 0 && (
          <>
            <h2 className="mini-lessons-heading">Done for good ({retired.length})</h2>
            <p className="text-light" style={{ fontSize: '0.875rem' }}>Never offered again. Bring one back to put it in rotation.</p>
            {retired.map(card)}
          </>
        )}
      </div>
    </div>
  );
}
