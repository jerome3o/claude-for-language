/**
 * A custom mini lesson inside the study session.
 *
 * The lesson spec (shared/lesson) is a list of sections, each holding any
 * number of exercises of any type in any order — this player just walks the
 * flattened list and renders each exercise with ExerciseView. Fully offline:
 * TTS comes from the cache-first speak hook, images from the blob cache, and
 * production exercises are self-assessed (Claude checks made sentences when
 * online).
 *
 * While the learner works it builds the attempt — what they answered in each
 * exercise and how long it took — handed to onComplete with the rating so it
 * travels with the completion event (and any recordings) for the tutor.
 *
 * `trial` runs the same lesson with nothing recorded: no rating, no event —
 * the tutor catalogue uses it so a tutor can take a sample lesson.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  exerciseMediaKey,
  exercisePoints,
  type CustomLessonSpec,
  type ExerciseAnswer,
  type ExerciseAttempt,
  type LessonAttemptData,
  type LessonExercise,
} from '@shared/lesson';
import { QueueCounts, Rating, IntervalPreview } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import { RatingButtons } from './RatingButtons';
import { ExerciseView } from './ExerciseView';
import { getTTSWithCache } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import type { LessonRecording } from '../services/custom-lesson-study';
import '../pages/PracticePage.css';

interface FlatExercise {
  exercise: LessonExercise;
  section: number;
  index: number;
  sectionTitle: string | null;
  /** True for the first exercise of a section — shows the section heading. */
  sectionStart: boolean;
}

function flattenSpec(spec: CustomLessonSpec): FlatExercise[] {
  const items: FlatExercise[] = [];
  spec.sections.forEach((section, si) => {
    section.exercises.forEach((exercise, i) => {
      items.push({
        exercise,
        section: si,
        index: i,
        sectionTitle: section.title ?? null,
        sectionStart: i === 0 && !!section.title,
      });
    });
  });
  return items;
}

export function useOfflineSpeak(): (text: string) => void {
  const playerRef = useRef(createAudioPlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  return useCallback((text: string) => {
    const playId = playerRef.current.claim();
    void getTTSWithCache(text).then(blob => {
      if (!blob || !playerRef.current.isCurrent(playId)) return;
      playerRef.current.play(blob, { label: 'lesson-example' });
    });
  }, []);
}

/** The lesson fields the player needs (a cached lesson or a catalogue sample). */
export interface PlayableLesson {
  title: string;
  icon: string | null;
  spec: CustomLessonSpec;
}

export function StudyCustomLesson({
  lesson,
  intervalPreviews,
  counts,
  onComplete,
  onEnd,
  trial = false,
}: {
  lesson: PlayableLesson;
  intervalPreviews?: Record<Rating, IntervalPreview>;
  counts?: QueueCounts;
  onComplete: (correct: number, total: number, rating: Rating, attempt: LessonAttemptData, recordings: LessonRecording[]) => void;
  onEnd: () => void;
  trial?: boolean;
}) {
  const speak = useOfflineSpeak();
  const items = useMemo(() => flattenSpec(lesson.spec), [lesson]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [isRating, setIsRating] = useState(false);
  const done = idx >= items.length;

  // The attempt, built as the learner goes (refs: nothing here re-renders).
  const startedAt = useRef(new Date());
  const exerciseStart = useRef(Date.now());
  const attempts = useRef<ExerciseAttempt[]>([]);
  const recordings = useRef<LessonRecording[]>([]);

  function advance(correct: boolean | null, answer?: ExerciseAnswer, recording?: Blob) {
    const item = items[idx];
    const maxPoints = exercisePoints(item.exercise);
    // A conversation scores one point per question; everything else 0/1.
    const points = answer?.questions
      ? answer.questions.filter(q => q.correct).length
      : correct ? maxPoints : 0;
    if (correct !== null && maxPoints > 0) {
      setScore(s => ({ correct: s.correct + Math.min(points, maxPoints), total: s.total + maxPoints }));
    }
    attempts.current.push({
      section: item.section,
      index: item.index,
      type: item.exercise.type,
      correct,
      points: correct === null ? 0 : Math.min(points, maxPoints),
      max_points: correct === null ? 0 : maxPoints,
      duration_ms: Date.now() - exerciseStart.current,
      answer,
    });
    if (recording && answer?.recording) {
      recordings.current.push({ media_key: answer.recording.media_key, blob: recording });
    }
    exerciseStart.current = Date.now();
    setIdx(i => i + 1);
  }

  function attemptData(): LessonAttemptData {
    return {
      started_at: startedAt.current.toISOString(),
      duration_ms: Date.now() - startedAt.current.getTime(),
      exercises: attempts.current,
    };
  }

  function restart() {
    attempts.current = [];
    recordings.current = [];
    startedAt.current = new Date();
    exerciseStart.current = Date.now();
    setScore({ correct: 0, total: 0 });
    setIdx(0);
  }

  const body = (() => {
    if (done) {
      const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 100;
      return (
        <div className="practice-page center" style={{ minHeight: 'auto' }}>
          <div className="done-emoji">{lesson.icon || '🎓'}</div>
          <h2>Lesson complete</h2>
          <h3>{lesson.title}</h3>
          {score.total > 0 && (
            <div className="done-score">
              {score.correct}/{score.total} correct ({pct}%)
            </div>
          )}
          {trial && <p className="text-light">Trial run — nothing was recorded.</p>}
        </div>
      );
    }
    const item = items[idx];
    return (
      <ExerciseView
        key={`ex-${idx}`}
        exercise={item.exercise}
        speak={speak}
        mediaKey={trial ? undefined : exerciseMediaKey(item.section, item.index)}
        onDone={advance}
      />
    );
  })();

  const current = done ? null : items[idx];

  return (
    <div className="study-fullscreen">
      <div className="study-topbar">
        {counts ? <QueueCountsHeader counts={counts} /> : <div className="lesson-trial-badge">{trial ? 'Trial — nothing is recorded' : ''}</div>}
        <div className="study-topbar-controls">
          <button className="study-close-btn" onClick={onEnd} aria-label={trial ? 'Close trial' : 'End session'}>
            ✕
          </button>
        </div>
      </div>

      <div className="study-card-content study-reader-content">
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {lesson.icon || '🎓'} Mini Lesson
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{lesson.title}</div>
        </div>

        {!done && (
          <div className="reader-progress-bar" style={{ marginBottom: '0.75rem' }}>
            <div
              className="reader-progress-fill"
              style={{ width: `${(idx / items.length) * 100}%` }}
            />
          </div>
        )}

        {current?.sectionStart && (
          <div className="lesson-section-title">{current.sectionTitle}</div>
        )}

        <div className="practice-page" style={{ padding: 0, minHeight: 'auto' }}>
          {body}
        </div>
      </div>

      {/* Fixed rating footer once the lesson is finished — same FSRS rating
          bar as cards and readers, pinned to the bottom of the screen. */}
      {done && !trial && intervalPreviews && (
        <div className="study-rating-sticky">
          <div className="study-reader-rating-header">
            {/* marginRight 0: the shared prompt class offsets for a Back
                button that this footer doesn't have */}
            <div className="study-reader-rating-prompt" style={{ marginRight: 0 }}>
              How well do you know this material now?
            </div>
          </div>
          <RatingButtons
            intervalPreviews={intervalPreviews}
            onRate={rating => {
              if (isRating) return;
              setIsRating(true);
              onComplete(score.correct, score.total, rating, attemptData(), recordings.current);
            }}
            disabled={isRating}
          />
        </div>
      )}
      {done && trial && (
        <div className="study-rating-sticky">
          <div className="exercise-actions" style={{ padding: '0 1rem 1rem' }}>
            <button className="practice-btn" onClick={restart}>↻ Try again</button>
            <button className="practice-btn primary" onClick={onEnd}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
