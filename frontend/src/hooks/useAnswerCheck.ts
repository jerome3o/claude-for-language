/**
 * The answer check of one self-assessed lesson exercise (services/answerCheck.ts): started the
 * moment the answer is final, so it is usually back by the time the reveal is read. A newer
 * start (🔁 Try again) or reset makes an older reply land nowhere.
 */
import { useCallback, useRef, useState } from 'react';
import type { AnswerCheck, AnswerCheckInput } from '@shared/lesson/answerCheck';
import { AnswerCheckUnavailable, checkLessonAnswer } from '../services/answerCheck';
import { track } from '../services/analytics';

export type AnswerCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; check: AnswerCheck; cached: boolean }
  /** Offline / failed: no card, the self-assessment as before. */
  | { status: 'unavailable'; offline: boolean };

export function useAnswerCheck() {
  const [state, setState] = useState<AnswerCheckState>({ status: 'idle' });
  const run = useRef(0);

  const start = useCallback((input: AnswerCheckInput, tryNumber = 1) => {
    const id = ++run.current;
    const began = Date.now();
    setState({ status: 'checking' });
    checkLessonAnswer(input).then(
      ({ check, cached }) => {
        if (run.current !== id) return;
        setState({ status: 'done', check, cached });
        track('lesson.answer_check', { verdict: check.verdict, ms: Date.now() - began, cached, exercise_type: input.exercise_type, input: input.input ?? 'typed', try: tryNumber });
      },
      (error: unknown) => {
        if (run.current !== id) return;
        const offline = error instanceof AnswerCheckUnavailable && error.offline;
        setState({ status: 'unavailable', offline });
        track('lesson.answer_check', { verdict: offline ? 'offline' : 'error', ms: Date.now() - began, cached: false, exercise_type: input.exercise_type, input: input.input ?? 'typed', try: tryNumber });
      },
    );
  }, []);

  const reset = useCallback(() => {
    run.current++;
    setState({ status: 'idle' });
  }, []);

  return { state, start, reset };
}
