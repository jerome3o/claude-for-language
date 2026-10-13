/**
 * The group class's one activity (EXPERIMENTAL): a quick quiz. The tutor asks
 * one multiple-choice question; every student answers on their own device
 * (and may change their answer until the reveal); the tutor sees who answered
 * what as it happens; students see only how many have answered until the
 * tutor reveals the answer and the counts. One question at a time.
 */

export const QUIZ_QUESTION_MAX = 200;
export const QUIZ_OPTION_MAX = 80;
export const QUIZ_MIN_OPTIONS = 2;
export const QUIZ_MAX_OPTIONS = 6;

export interface QuizSpec {
  question: string;
  options: string[];
  /** Index of the right option, or null for an opinion question. */
  correct: number | null;
}

export interface QuizAnswer {
  choice: number;
  name: string;
  at: number;
}

export interface GroupQuiz extends QuizSpec {
  id: string;
  started_at: number;
  revealed: boolean;
  /** By user id. */
  answers: Record<string, QuizAnswer>;
}

/** What one person's screen shows. */
export interface GroupQuizView {
  id: string;
  question: string;
  options: string[];
  revealed: boolean;
  /** Only after the reveal (or for the tutor). */
  correct: number | null;
  /** How many students answered. */
  answered: number;
  /** My own answer (students). */
  mine: number | null;
  /** Answers per option — the tutor always, students after the reveal. */
  counts: number[] | null;
  /** Who answered what — the tutor only (live), everyone after the reveal. */
  answers: { user_id: string; name: string; choice: number }[] | null;
}

const line = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && Array.from(s).length <= max ? s : null;
};

/** A quiz from the tutor's form, or null when it doesn't make a question. */
export function sanitizeQuizSpec(raw: unknown): QuizSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const question = line(r.question, QUIZ_QUESTION_MAX);
  if (!question || !Array.isArray(r.options)) return null;
  const options: string[] = [];
  for (const o of r.options) {
    const s = line(o, QUIZ_OPTION_MAX);
    if (s) options.push(s);
  }
  if (options.length < QUIZ_MIN_OPTIONS || options.length > QUIZ_MAX_OPTIONS) return null;
  const correct = typeof r.correct === 'number' && Number.isInteger(r.correct) && r.correct >= 0 && r.correct < options.length ? r.correct : null;
  return { question, options, correct };
}

export function startQuiz(spec: QuizSpec, id: string, now: number): GroupQuiz {
  return { ...spec, id, started_at: now, revealed: false, answers: {} };
}

/** A student's answer (changeable until the reveal); null = refused / unchanged. */
export function answerQuiz(quiz: GroupQuiz, userId: string, name: string, choice: unknown, now: number): GroupQuiz | null {
  if (quiz.revealed) return null;
  if (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0 || choice >= quiz.options.length) return null;
  if (quiz.answers[userId]?.choice === choice) return null;
  return { ...quiz, answers: { ...quiz.answers, [userId]: { choice, name, at: now } } };
}

export function revealQuiz(quiz: GroupQuiz): GroupQuiz | null {
  return quiz.revealed ? null : { ...quiz, revealed: true };
}

export function quizCounts(quiz: GroupQuiz): number[] {
  const counts = quiz.options.map(() => 0);
  for (const a of Object.values(quiz.answers)) counts[a.choice]++;
  return counts;
}

/** The quiz as `userId` may see it. */
export function quizViewFor(quiz: GroupQuiz, userId: string, isTutor: boolean): GroupQuizView {
  const showAll = isTutor || quiz.revealed;
  const answers = Object.entries(quiz.answers)
    .sort((a, b) => a[1].at - b[1].at)
    .map(([user_id, a]) => ({ user_id, name: a.name, choice: a.choice }));
  return {
    id: quiz.id,
    question: quiz.question,
    options: quiz.options,
    revealed: quiz.revealed,
    correct: showAll ? quiz.correct : null,
    answered: answers.length,
    mine: quiz.answers[userId]?.choice ?? null,
    counts: showAll ? quizCounts(quiz) : null,
    answers: showAll ? answers : null,
  };
}
