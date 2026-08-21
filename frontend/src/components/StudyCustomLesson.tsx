/**
 * A custom mini lesson inside the study session.
 *
 * The lesson spec (shared/lesson) is a list of sections, each holding any
 * number of exercises of any type in any order — this player just walks the
 * flattened list and renders each exercise with the shared exercise views.
 * Fully offline: TTS comes from the cache-first speak hook, images from the
 * blob cache, and production exercises are self-assessed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LessonExercise } from '@shared/lesson';
import { LocalCustomLesson } from '../db/database';
import { QueueCounts } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import {
  ScrambleExercise,
  ChoiceExercise,
  TranslateExercise,
  MatchExercise,
  DescribeImageExercise,
  SpeakPromptExercise,
  LessonNoteCard,
} from './lesson-exercises';
import { getTTSWithCache } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import '../pages/PracticePage.css';

interface FlatExercise {
  exercise: LessonExercise;
  sectionTitle: string | null;
  /** True for the first exercise of a section — shows the section heading. */
  sectionStart: boolean;
}

function flattenSpec(lesson: LocalCustomLesson): FlatExercise[] {
  const items: FlatExercise[] = [];
  for (const section of lesson.spec.sections) {
    section.exercises.forEach((exercise, i) => {
      items.push({
        exercise,
        sectionTitle: section.title ?? null,
        sectionStart: i === 0 && !!section.title,
      });
    });
  }
  return items;
}

function useOfflineSpeak(): (text: string) => void {
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

export function StudyCustomLesson({
  lesson,
  counts,
  onComplete,
  onEnd,
}: {
  lesson: LocalCustomLesson;
  counts: QueueCounts;
  onComplete: (correct: number, total: number) => void;
  onEnd: () => void;
}) {
  const speak = useOfflineSpeak();
  const items = useMemo(() => flattenSpec(lesson), [lesson]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const done = idx >= items.length;

  function advance(gotPoint: boolean | null) {
    if (gotPoint !== null) {
      setScore(s => ({ correct: s.correct + (gotPoint ? 1 : 0), total: s.total + 1 }));
    }
    setIdx(i => i + 1);
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
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: '1rem', minHeight: '44px' }}
            onClick={() => onComplete(score.correct, score.total)}
          >
            Finish lesson
          </button>
        </div>
      );
    }

    const { exercise } = items[idx];
    const key = `ex-${idx}`;
    switch (exercise.type) {
      case 'note':
        return (
          <LessonNoteCard
            key={key}
            title={exercise.title}
            body={exercise.body}
            sentences={exercise.sentences}
            speak={speak}
            onNext={() => advance(null)}
          />
        );
      case 'scramble':
        return (
          <ScrambleExercise
            key={key}
            english={exercise.english}
            tiles={exercise.tiles}
            correctOrder={exercise.correct_order}
            altOrders={exercise.alt_orders}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      case 'choice':
        return (
          <ChoiceExercise
            key={key}
            question={exercise.question}
            options={exercise.options}
            correctIndex={exercise.correct}
            explanation={exercise.explanation}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      case 'translate':
        return (
          <TranslateExercise
            key={key}
            english={exercise.english}
            referenceHanzi={exercise.reference_hanzi}
            referencePinyin={exercise.reference_pinyin}
            note={exercise.note}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      case 'match':
        return (
          <MatchExercise
            key={key}
            pairs={exercise.pairs}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      case 'describe_image':
        return (
          <DescribeImageExercise
            key={key}
            imageKey={exercise.image_url}
            imagePrompt={exercise.image_prompt}
            task={exercise.task}
            referenceHanzi={exercise.reference_hanzi}
            referencePinyin={exercise.reference_pinyin}
            referenceEnglish={exercise.reference_english}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      case 'speak':
        return (
          <SpeakPromptExercise
            key={key}
            prompt={exercise.prompt}
            example={exercise.example}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
    }
  })();

  const current = done ? null : items[idx];

  return (
    <div className="study-fullscreen">
      <div className="study-topbar">
        <QueueCountsHeader counts={counts} />
        <div className="study-topbar-controls">
          <button className="study-close-btn" onClick={onEnd} aria-label="End session">
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
    </div>
  );
}
