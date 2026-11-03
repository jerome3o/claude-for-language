/**
 * 💬 Ask Claude on a mini lesson exercise = the exercise's Claude THREAD in a sheet over the lesson
 * (docs/STUDY_SESSION.md "Mini lessons" → "Ask Claude about an exercise"; the unified-Claude-chats plan
 * §6.5). The lesson player (StudyCustomLesson) wraps the exercise on screen in `ExerciseClaudeProvider`
 * for a REAL run of one of his lessons (a preview / the catalogue / a Coach mistake lesson has no stored
 * lesson for Claude to read — the answer check there keeps its old inline "💬 Ask about this" chat).
 *
 * Two ways in: the player's top-bar 💬 (any exercise, before or after answering) and, on a checked
 * answer, the answer check's "💬 Ask Claude" (useLessonAnswerCheck) — that one sends his answer and
 * Claude's check of it with the context, so "Why is my answer wrong?" knows what he wrote.
 */
import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ClaudeContextSnapshot, ClaudeThreadContext, ExerciseAnswerContext } from '@shared/claude/context';
import type { AnswerCheck } from '@shared/lesson/answerCheck';
import { exerciseTypeInfo } from '@shared/lesson/registry';
import { track } from '../../services/analytics';

// Loaded on first use: the thread view is a big chunk the reading / lesson screens rarely need.
const ContextClaudeSheet = lazy(() => import('../claude/ContextClaudeSheet'));

export interface ExerciseClaudeTarget {
  lessonId: string;
  lessonTitle: string;
  /** `s<section>e<index>`. */
  exerciseKey: string;
  exerciseType: string;
}

type AskFrom = 'answer_check' | 'toolbar';

interface ExerciseClaudeApi {
  /** Opens the exercise's thread; `answer` = his answer on this showing (+ its check). */
  ask: (from: AskFrom, answer?: ExerciseAnswerContext | null) => void;
}

const Ctx = createContext<ExerciseClaudeApi | null>(null);

/** The exercise's Claude, when the exercise on screen belongs to a stored lesson of his (null otherwise). */
export function useExerciseClaude(): ExerciseClaudeApi | null {
  return useContext(Ctx);
}

/** His checked answer as the exercise context carries it (the check trimmed to what Claude needs). */
export function exerciseAnswerOf(answer: string, check: AnswerCheck | null): ExerciseAnswerContext {
  const out: ExerciseAnswerContext = { text: answer.trim().slice(0, 400) };
  if (check) {
    out.verdict = check.verdict;
    if (check.headline) out.headline = check.headline;
    if (check.corrected) out.corrected = check.corrected;
    const tips = check.tips.map((t) => (t.quote ? `${t.quote}: ${t.text}` : t.text)).filter(Boolean).slice(0, 3);
    if (tips.length) out.tips = tips;
  }
  return out;
}

export function ExerciseClaudeProvider({ target, children }: { target: ExerciseClaudeTarget | null; children: ReactNode }) {
  const [open, setOpen] = useState<{ target: ExerciseClaudeTarget; answer: ExerciseAnswerContext | null; from: AskFrom } | null>(null);

  const ask = useCallback(
    (from: AskFrom, answer?: ExerciseAnswerContext | null) => {
      if (target) setOpen({ target, answer: answer ?? null, from });
    },
    [target],
  );
  const api = useMemo(() => (target ? { ask } : null), [target, ask]);

  const context = useMemo<(ClaudeThreadContext & ClaudeContextSnapshot) | null>(() => {
    if (!open) return null;
    const t = open.target;
    return {
      kind: 'exercise',
      lesson_id: t.lessonId,
      exercise_key: t.exerciseKey,
      exercise_type: t.exerciseType,
      ...(open.answer ? { answer: open.answer } : {}),
      label: exerciseTypeInfo(t.exerciseType)?.name ?? t.exerciseType,
      sublabel: t.lessonTitle,
    };
  }, [open]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {open && context && (
        <Suspense fallback={null}>
        <ContextClaudeSheet
          context={context}
          fields={{ answer: open.answer }}
          label="Ask Claude about this exercise"
          source="lesson"
          onResolved={(resumed) => track('lesson.exercise_ask', { from: open.from, exercise_type: open.target.exerciseType, verdict: open.answer?.verdict ?? 'none', resumed })}
          onClose={() => setOpen(null)}
        />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}
