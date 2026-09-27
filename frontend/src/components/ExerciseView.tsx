/**
 * One lesson exercise of any type, rendered with its study component. The
 * single switch over exercise types on the study side — used by the study
 * session's lesson player, the editor preview and the catalogue trial.
 */

import type { ExerciseAnswer, LessonExercise } from '@shared/lesson';
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
  SentenceMakingExercise,
  WriteTypedExercise,
  WriteHandwritingExercise,
  DictationExercise,
  OralExpressionExercise,
  ConversationExercise,
} from './lesson-exercises';

/** correct is null for unscored exercises (notes). */
export type ExerciseDone = (correct: boolean | null, answer?: ExerciseAnswer, recording?: Blob) => void;

export function ExerciseView({ exercise, speak, onDone, mediaKey }: {
  exercise: LessonExercise;
  speak: (text: string) => void;
  onDone: ExerciseDone;
  /** Where a recording made in this exercise is kept (oral expression). */
  mediaKey?: string;
}) {
  const onNext = (correct: boolean, answer?: ExerciseAnswer) => onDone(correct, answer);
  switch (exercise.type) {
    case 'note':
      return <LessonNoteCard title={exercise.title} body={exercise.body} sentences={exercise.sentences} speak={speak} onNext={() => onDone(null)} />;
    case 'scramble':
      return <ScrambleExercise english={exercise.english} tiles={exercise.tiles} correctOrder={exercise.correct_order} altOrders={exercise.alt_orders} speak={speak} onNext={onNext} />;
    case 'choice':
      return <ChoiceExercise question={exercise.question} options={exercise.options} correctIndex={exercise.correct} explanation={exercise.explanation} speak={speak} onNext={onNext} />;
    case 'translate':
      return <TranslateExercise english={exercise.english} referenceHanzi={exercise.reference_hanzi} referencePinyin={exercise.reference_pinyin} note={exercise.note} speak={speak} onNext={onNext} />;
    case 'match':
      return <MatchExercise pairs={exercise.pairs} speak={speak} onNext={onNext} />;
    case 'describe_image':
      return (
        <DescribeImageExercise
          imageKey={exercise.image_url}
          imagePrompt={exercise.image_prompt}
          task={exercise.task}
          referenceHanzi={exercise.reference_hanzi}
          referencePinyin={exercise.reference_pinyin}
          referenceEnglish={exercise.reference_english}
          speak={speak}
          onNext={onNext}
        />
      );
    case 'speak':
      return <SpeakPromptExercise prompt={exercise.prompt} example={exercise.example} speak={speak} onNext={onNext} />;
    case 'listen_choice':
      return <ListenChoiceExercise audio={exercise.audio} question={exercise.question} options={exercise.options} correctIndex={exercise.correct} explanation={exercise.explanation} speak={speak} onNext={onNext} />;
    case 'listen_translate':
      return <ListenTranslateExercise audio={exercise.audio} note={exercise.note} speak={speak} onNext={onNext} />;
    case 'sentence_making':
      return <SentenceMakingExercise words={exercise.words} task={exercise.task} input={exercise.input} example={exercise.example} speak={speak} onNext={onNext} />;
    case 'write_typed':
      return <WriteTypedExercise answer={exercise.answer} prompt={exercise.prompt} cues={exercise.cues} alternatives={exercise.alternatives} speak={speak} onNext={onNext} />;
    case 'write_handwriting':
      return <WriteHandwritingExercise answer={exercise.answer} prompt={exercise.prompt} cues={exercise.cues} speak={speak} onNext={onNext} />;
    case 'dictation':
      return <DictationExercise audio={exercise.audio} input={exercise.input} alternatives={exercise.alternatives} note={exercise.note} speak={speak} onNext={onNext} />;
    case 'oral_expression':
      return (
        <OralExpressionExercise
          prompt={exercise.prompt}
          questionAudio={exercise.question_audio}
          hints={exercise.hints}
          example={exercise.example}
          targetSeconds={exercise.target_seconds}
          mediaKey={mediaKey}
          speak={speak}
          onNext={(correct, answer, recording) => onDone(correct, answer, recording)}
        />
      );
    case 'conversation':
      return <ConversationExercise situation={exercise.situation} speakers={exercise.speakers} lines={exercise.lines} questions={exercise.questions} onNext={onNext} />;
  }
}
