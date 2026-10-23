/**
 * The answer check of one self-assessed lesson exercise (services/answerCheck.ts): started the
 * moment the answer is final (an exact match of the model answer is checked locally, no call), so it is usually back by the time the reveal is read. A newer
 * start (🔁 Try again) or reset makes an older reply land nowhere.
 */
import { useCallback, useRef, useState } from 'react';
import { exactAnswerCheck, type AnswerCheck, type AnswerCheckInput } from '@shared/lesson/answerCheck';
import { AnswerCheckUnavailable, checkLessonAnswer } from '../services/answerCheck';
import { track } from '../services/analytics';

export type AnswerCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  /** local = the answer IS the model answer: checked on the device, no call (exactAnswerCheck). */
  | { status: 'done'; check: AnswerCheck; cached: boolean; local?: boolean }
  /** Offline / failed: no card, the self-assessment as before. */
  | { status: 'unavailable'; offline: boolean };

export function useAnswerCheck() {
  const [state, setState] = useState<AnswerCheckState>({ status: 'idle' });
  const run = useRef(0);

  const start = useCallback((input: AnswerCheckInput, tryNumber = 1) => {
    const id = ++run.current;
    // The model answer itself ("✓ Exact match"): nothing for Claude to add — shown at once, offline too.
    const exact = exactAnswerCheck(input);
    if (exact) {
      setState({ status: 'done', check: exact, cached: false, local: true });
      track('lesson.answer_check', { verdict: exact.verdict, ms: 0, cached: false, local: true, exercise_type: input.exercise_type, input: input.input ?? 'typed', try: tryNumber });
      return;
    }
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
