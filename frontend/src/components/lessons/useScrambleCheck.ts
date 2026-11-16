/**
 * Claude's check of a word order built in an order the lesson didn't list (shared/lesson/scrambleCheck.ts,
 * docs/STUDY_SESSION.md "Claude checks your answer" → "Word order"): a check seen before (device cache) and an
 * order that differs only in punctuation are answered at once, offline too; otherwise online → "checking" until
 * `POST /api/lessons/answer-check` answers; offline / failed → "unavailable" (the strict ✗ Not quite stands).
 * A newer start makes an older reply land nowhere. Analytics `lesson.scramble_checked`.
 */
import { useCallback, useRef, useState } from 'react';
import { exactAnswerCheck, type AnswerCheckInput } from '@shared/lesson/answerCheck';
import type { ScrambleCheckStatus } from '@shared/lesson/scrambleCheck';
import { AnswerCheckUnavailable, cachedAnswerCheck, checkLessonAnswer } from '../../services/answerCheck';
import { track } from '../../services/analytics';

export function useScrambleCheck() {
  const [status, setStatus] = useState<ScrambleCheckStatus | null>(null);
  const run = useRef(0);

  const start = useCallback((input: AnswerCheckInput | null) => {
    const id = ++run.current;
    if (!input) {
      setStatus({ status: 'unavailable' });
      return;
    }
    const known = exactAnswerCheck(input) ?? cachedAnswerCheck(input);
    if (known) {
      setStatus({ status: 'done', check: known });
      track('lesson.scramble_checked', { verdict: known.verdict, cached: true, ms: 0 });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus({ status: 'unavailable' });
      track('lesson.scramble_checked', { verdict: 'offline', cached: false, ms: 0 });
      return;
    }
    const began = Date.now();
    setStatus({ status: 'checking' });
    checkLessonAnswer(input).then(
      ({ check, cached }) => {
        if (run.current !== id) return;
        setStatus({ status: 'done', check });
        track('lesson.scramble_checked', { verdict: check.verdict, cached, ms: Date.now() - began });
      },
      (error: unknown) => {
        if (run.current !== id) return;
        const offline = error instanceof AnswerCheckUnavailable && error.offline;
        setStatus({ status: 'unavailable' });
        track('lesson.scramble_checked', { verdict: offline ? 'offline' : 'error', cached: false, ms: Date.now() - began });
      },
    );
  }, []);

  return { status, start };
}
