/**
 * Preview: the real exercise components (lesson-exercises.tsx) rendered
 * one at a time, exactly as the learner sees them, in a non-scoring
 * walkthrough with previous / next controls and a jump list.
 */

import { useMemo, useState } from 'react';
import type { CustomLessonSpec, LessonExercise } from '@shared/lesson';
import { exercisePrimaryText } from '@shared/lesson';
import {
  ScrambleExercise,
  ChoiceExercise,
  TranslateExercise,
  MatchExercise,
  DescribeImageExercise,
  SpeakPromptExercise,
  ListenChoiceExercise,
  ListenTranslateExercise,
  LessonNoteCard,
} from '../lesson-exercises';
import { EXERCISE_ICONS, EXERCISE_TYPE_NAMES } from './DiffCard';
import type { Speak } from './fields';
import '../../pages/PracticePage.css';

interface FlatExercise {
  exercise: LessonExercise;
  section: number;
  sectionTitle: string | null;
  sectionStart: boolean;
}

function flatten(spec: CustomLessonSpec): FlatExercise[] {
  const out: FlatExercise[] = [];
  spec.sections.forEach((section, si) => {
    section.exercises.forEach((exercise, ei) => {
      out.push({ exercise, section: si, sectionTitle: section.title ?? null, sectionStart: ei === 0 && !!section.title });
    });
  });
  return out;
}

/** Is the exercise complete enough to render without crashing? The
 * validator is the authority; this just keeps a half-typed form from
 * blowing up the preview. */
function renderable(ex: LessonExercise): boolean {
  switch (ex.type) {
    case 'scramble':
      return ex.tiles.length > 0 && ex.correct_order.length > 0;
    case 'choice':
    case 'listen_choice':
      return ex.options.length >= 2 && ex.correct >= 0 && ex.correct < ex.options.length;
    case 'match':
      return ex.pairs.length >= 2;
    default:
      return true;
  }
}

export function LessonPreview({ spec, speak }: { spec: CustomLessonSpec; speak: Speak }) {
  const items = useMemo(() => flatten(spec), [spec]);
  const [idx, setIdx] = useState(0);
  // Remounting the exercise resets its internal state (a fresh attempt).
  const [attempt, setAttempt] = useState(0);
  const clamped = Math.min(idx, Math.max(items.length - 1, 0));
  const current = items[clamped];

  function go(next: number) {
    setIdx(Math.max(0, Math.min(items.length - 1, next)));
    setAttempt(a => a + 1);
  }

  if (items.length === 0) {
    return <div className="ed-preview-empty">Add an exercise to preview it.</div>;
  }

  const key = `${clamped}-${attempt}`;
  const advance = () => go(clamped + 1);
  const { exercise } = current;

  let body: JSX.Element;
  if (!renderable(exercise)) {
    body = <div className="ed-preview-empty">This exercise isn't complete yet — fill in its fields to preview it.</div>;
  } else {
    switch (exercise.type) {
      case 'note':
        body = <LessonNoteCard key={key} title={exercise.title} body={exercise.body} sentences={exercise.sentences} speak={speak} onNext={advance} />;
        break;
      case 'scramble':
        body = <ScrambleExercise key={key} english={exercise.english} tiles={exercise.tiles} correctOrder={exercise.correct_order} altOrders={exercise.alt_orders} speak={speak} onNext={advance} />;
        break;
      case 'choice':
        body = <ChoiceExercise key={key} question={exercise.question} options={exercise.options} correctIndex={exercise.correct} explanation={exercise.explanation} speak={speak} onNext={advance} />;
        break;
      case 'translate':
        body = <TranslateExercise key={key} english={exercise.english} referenceHanzi={exercise.reference_hanzi} referencePinyin={exercise.reference_pinyin} note={exercise.note} speak={speak} onNext={advance} />;
        break;
      case 'match':
        body = <MatchExercise key={key} pairs={exercise.pairs} speak={speak} onNext={advance} />;
        break;
      case 'describe_image':
        body = <DescribeImageExercise key={key} imageKey={exercise.image_url} imagePrompt={exercise.image_prompt} task={exercise.task} referenceHanzi={exercise.reference_hanzi} referencePinyin={exercise.reference_pinyin} referenceEnglish={exercise.reference_english} speak={speak} onNext={advance} />;
        break;
      case 'speak':
        body = <SpeakPromptExercise key={key} prompt={exercise.prompt} example={exercise.example} speak={speak} onNext={advance} />;
        break;
      case 'listen_choice':
        body = <ListenChoiceExercise key={key} audio={exercise.audio} question={exercise.question} options={exercise.options} correctIndex={exercise.correct} explanation={exercise.explanation} speak={speak} onNext={advance} />;
        break;
      case 'listen_translate':
        body = <ListenTranslateExercise key={key} audio={exercise.audio} note={exercise.note} speak={speak} onNext={advance} />;
        break;
    }
  }

  return (
    <div className="ed-preview">
      <div className="ed-preview-bar">
        <button type="button" className="ed-mini-btn" onClick={() => go(clamped - 1)} disabled={clamped === 0} aria-label="Previous exercise">‹</button>
        <select className="ed-input ed-preview-jump" value={clamped} onChange={e => go(Number(e.target.value))} aria-label="Jump to exercise">
          {items.map((it, i) => (
            <option key={i} value={i}>
              {i + 1}. {EXERCISE_ICONS[it.exercise.type]} {EXERCISE_TYPE_NAMES[it.exercise.type]} — {exercisePrimaryText(it.exercise).slice(0, 30) || '(empty)'}
            </option>
          ))}
        </select>
        <button type="button" className="ed-mini-btn" onClick={() => go(clamped + 1)} disabled={clamped >= items.length - 1} aria-label="Next exercise">›</button>
        <button type="button" className="ed-mini-btn text" onClick={() => setAttempt(a => a + 1)} title="Restart this exercise">↺</button>
      </div>
      <div className="ed-preview-note">Preview — nothing is recorded. {clamped + 1} of {items.length}</div>
      <div className="ed-preview-stage study-card-content">
        <div className="reader-progress-bar" style={{ marginBottom: '0.75rem' }}>
          <div className="reader-progress-fill" style={{ width: `${(clamped / items.length) * 100}%` }} />
        </div>
        {current.sectionStart && <div className="lesson-section-title">{current.sectionTitle}</div>}
        <div className="practice-page" style={{ padding: 0, minHeight: 'auto' }}>
          {body}
        </div>
      </div>
    </div>
  );
}
