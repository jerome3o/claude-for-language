/**
 * Everything a self-assessed exercise needs for Claude's answer check, in one hook so the exercise
 * views change by a few lines (TranslateExercise, ListenTranslateExercise):
 *   - `onFinal(text, source)` when the answer is final (typed submit / transcript final) → the check
 *     starts at once, when `answerCheckApplies` (an answer in Chinese);
 *   - `view(answer, speak)` → the card under "You said" + the 💬 sheet;
 *   - `suggested` → the button to ring; `report(answer)` adds the check + every earlier try;
 *   - `retry()` keeps this try and clears the check; the exercise then shows its input again.
 */
import { useState, type ReactNode } from 'react';
import {
  answerCheckApplies, type AnswerCheckInput, type AnswerTry,
} from '@shared/lesson/answerCheck';
import type { ExerciseAnswer } from '@shared/lesson';
import { useAnswerCheck } from '../../hooks/useAnswerCheck';
import { AnswerCheckCard } from './AnswerCheckCard';
import { AskAboutAnswerSheet } from './AskAboutAnswerSheet';
import { track } from '../../services/analytics';

type Source = 'spoken' | 'edited' | 'typed';

export function useLessonAnswerCheck(ctx: {
  exerciseType: string;
  promptEn: string | null | undefined;
  modelAnswer: string;
  modelPinyin?: string | null;
  focus?: string;
  /** Free speaking: the task's useful words (hanzi) and the question played in Chinese. */
  hints?: string[];
  question?: string;
  /** 🔁 Try again: the exercise clears its answer and shows its input again. */
  onRetry: () => void;
}) {
  const { state, start, reset } = useAnswerCheck();
  const [input, setInput] = useState<AnswerCheckInput | null>(null);
  const [tries, setTries] = useState<AnswerTry[]>([]);
  const [asking, setAsking] = useState(false);

  function onFinal(text: string, source: Source | null | undefined) {
    if (!ctx.promptEn || !answerCheckApplies(ctx.exerciseType, text)) {
      setInput(null);
      reset();
      return;
    }
    const next: AnswerCheckInput = {
      prompt_en: ctx.promptEn,
      model_answer: ctx.modelAnswer,
      model_pinyin: ctx.modelPinyin ?? undefined,
      answer: text.trim(),
      exercise_type: ctx.exerciseType,
      input: source ?? 'typed',
      focus: ctx.focus,
    };
    if (ctx.hints?.length) next.hints = ctx.hints;
    if (ctx.question) next.question = ctx.question;
    setInput(next);
    start(next, tries.length + 1);
  }

  const check = state.status === 'done' ? state.check : null;

  /** Keep this try (with its check) and clear the card; the exercise re-opens its input. */
  function retry() {
    if (input) setTries((t) => [...t, { text: input.answer, input: input.input, ...(check ? { check } : {}) }]);
    track('lesson.answer_retry', { verdict: check?.verdict ?? 'none', exercise_type: ctx.exerciseType, try: tries.length + 1 });
    setInput(null);
    setAsking(false);
    reset();
    ctx.onRetry();
  }

  function report(answer: ExerciseAnswer): ExerciseAnswer {
    const out: ExerciseAnswer = { ...answer };
    if (check && input && answer.text?.trim() === input.answer) out.check = check;
    if (tries.length) out.tries = tries;
    return out;
  }

  function view(answer: string, speak: (text: string) => void): ReactNode {
    if (!input) return null;
    return (
      <>
        <AnswerCheckCard
          state={state}
          answer={answer}
          speak={speak}
          onRetry={retry}
          onAsk={() => setAsking(true)}
        />
        {asking && <AskAboutAnswerSheet input={input} check={check} onClose={() => setAsking(false)} />}
      </>
    );
  }

  return {
    onFinal,
    view,
    report,
    retry,
    /** The button to ring (null while checking / without a check). */
    suggested: check?.suggested ?? null,
    tries: tries.length,
  };
}
