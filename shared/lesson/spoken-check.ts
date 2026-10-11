/**
 * A mini lesson's written-Chinese answer that was SPOKEN (the voice-first box, shared/voice/dictation.ts).
 * The recogniser picks the characters, not the learner, so an unchanged transcript is checked the way a
 * spoken study answer is (shared/cards/answer.ts `checkSpokenAnswer`, PR #584): a homophone is right by
 * sound, and the answer said inside a longer sentence counts. Typed or edited text stays strict
 * (`diffHanzi`). Lab port: core `LessonAnswers.spokenCheck`, parity-tested (parity/fixtures/lesson-spoken.ts).
 */
import { checkSpokenAnswer, isAcceptedVerdict, spokenVerdictNote, type AnswerVerdict } from '../cards/answer';
import type { DictationSource } from '../voice/dictation';

export interface LessonSpokenCheck {
  /** The spoken verdict (null: typed / edited — the strict check alone decides). */
  verdict: AnswerVerdict | null;
  /** Right by the spoken rule (sound / contains / exact…). */
  accepted: boolean;
  /** The line under the result ("Sounded right ✓ — written 由", "Said inside a sentence ✓"), or null. */
  note: string | null;
}

export function lessonSpokenCheck(
  answer: string,
  expected: string,
  alternatives: readonly string[] = [],
  source: DictationSource | null | undefined = 'typed',
): LessonSpokenCheck {
  if (source !== 'spoken' || !answer.trim()) return { verdict: null, accepted: false, note: null };
  const verdict = checkSpokenAnswer(answer, expected, alternatives);
  const accepted = isAcceptedVerdict(verdict);
  const note = verdict === 'contains' ? `Said inside a sentence ✓ — ${expected.trim()}` : spokenVerdictNote(verdict, expected);
  return { verdict, accepted, note };
}

/** An auto-checked exercise's verdict: the strict character check, or — for an unchanged spoken answer — the spoken rule. */
export function lessonAnswerCorrect(strictCorrect: boolean, spoken: LessonSpokenCheck): boolean {
  return strictCorrect || spoken.accepted;
}

/** The attempt review's label for a text answer by how it was given (`ExerciseAnswer.input`). */
export function answerInputLabel(input: 'spoken' | 'edited' | 'typed' | null | undefined, typedLabel = 'Typed'): string {
  if (input === 'spoken') return '🎤 Said';
  if (input === 'edited') return '🎤 Said, then edited';
  return typedLabel;
}
