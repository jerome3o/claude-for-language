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
import { getCustomLessons, deleteCustomLessonById, CustomLessonListItem } from '../api/client';
import { db } from '../db/database';
import { Loading } from '../components/Loading';
import './MiniLessonsPage.css';

const EXERCISE_LABELS: Record<LessonExercise['type'], string> = {
  note: '📖 Note',
  scramble: '🧩 Word order',
  choice: '🔘 Choice',
  translate: '✍️ Translate',
  match: '🔗 Match',
  describe_image: '🖼 Describe picture',
  speak: '🎤 Speak',
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

  return (
    <div className={`mini-lesson-card ${lesson.status === 'done' ? 'done' : ''}`}>
      <div className="mini-lesson-head" onClick={() => setExpanded(!expanded)}>
        <div className="mini-lesson-icon">{lesson.icon || '🎓'}</div>
        <div className="mini-lesson-titles">
          <div className="mini-lesson-title">{lesson.title}</div>
          {lesson.description && <div className="mini-lesson-desc">{lesson.description}</div>}
          <div className="mini-lesson-meta">
            {exerciseCount(lesson.spec)} exercises ({countScoreable(lesson.spec)} scored)
            {' · '}from {lesson.source}
            {' · '}{created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </div>
        </div>
        <span className={`mini-lesson-status ${lesson.status}`}>
          {lesson.status === 'active' ? 'In queue' : 'Done'}
        </span>
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

  // Offline fallback: the locally cached pending lessons
  const localLessons = useLiveQuery(() => db.customLessons.toArray(), []);

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
    ?? (localLessons ?? []).map(l => ({
      id: l.id,
      title: l.title,
      description: l.description,
      icon: l.icon,
      source: l.source,
      status: l.status,
      created_at: l.created_at,
      spec: l.spec,
    }));

  const active = lessons.filter(l => l.status === 'active');
  const done = lessons.filter(l => l.status === 'done');

  return (
    <div className="page">
      <div className="container mini-lessons-page">
        <h1>🎓 Mini Lessons</h1>
        <p className="text-light mini-lessons-sub">
          Custom lessons authored by Claude (from chat or MCP). Pending ones mix
          into your study sessions — one every few cards, up to two per session.
        </p>
        {!serverLessons && (
          <p className="mini-lessons-offline-note">
            Offline — showing the lessons cached on this device.
          </p>
        )}

        <h2 className="mini-lessons-heading">In the study queue ({active.length})</h2>
        {active.length === 0 && (
          <p className="text-light">
            Nothing waiting. Ask Claude for one — during study, in the Sentence
            Coach, or from any connected Claude chat: “make me a mini lesson on …”
          </p>
        )}
        {active.map(lesson => (
          <LessonCard
            key={lesson.id}
            lesson={lesson}
            onDelete={handleDelete}
            deleting={deleteMutation.isPending && deleteMutation.variables?.id === lesson.id}
          />
        ))}

        {done.length > 0 && (
          <>
            <h2 className="mini-lessons-heading">Completed ({done.length})</h2>
            {done.map(lesson => (
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
