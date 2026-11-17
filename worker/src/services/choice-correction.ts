/**
 * The correction of a "which sentence is wrong?" choice's wrong option, for lessons written before choices carried
 * their own `correction` (shared/lesson/choiceMistake.ts; docs/STUDY_SESSION.md "Which sentence is wrong?"). The apps
 * never read the mistake aloud: the reveal shows "✓ Correct: …" and plays THIS sentence.
 *
 * One small call — the answer check's model through structuredCall (forced tool, thinking off, the smallest change
 * that fixes the sentence) — cached for everyone in `lesson_answer_checks` (exercise_type `choice_correction`) by
 * SHA-256 of `choiceCorrectionCacheText` (question + sentence). Pinyin is the app's (appPinyin), never the model's.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  choiceCorrectionCacheText, normalizeChoiceCorrection, CHOICE_CORRECTION_VERSION,
  type ChoiceCorrectionInput, type ChoiceCorrectionResult,
} from '@shared/lesson/choiceMistake';
import { structuredCall } from './structured-call';
import { appPinyin, ANSWER_CHECK_MODEL, ANSWER_CHECK_FALLBACK_MODEL } from './answer-check';

export const CHOICE_CORRECTION_TYPE = 'choice_correction';

export const CHOICE_CORRECTION_SYSTEM = `A multiple-choice exercise in a Chinese lesson asked the learner to pick the WRONG sentence; the author marked the sentence below as the one with the mistake. Write the corrected sentence.

Rules:
- Make the SMALLEST change that makes it correct, natural Chinese with the meaning the author intended: keep its words, structure and punctuation wherever you can. Fix only the mistake the exercise is about (the question, the other options and the explanation show what it tests).
- Simplified characters only; no pinyin, brackets, slashes or alternatives in "hanzi".
- "english": one short translation of the corrected sentence.
- If the sentence really has nothing wrong with it (the exercise was about something else, e.g. facts in a text), set already_correct: true and repeat it unchanged.
Answer with the give_correction tool.`;

const TOOL = {
  name: 'give_correction',
  description: 'The corrected sentence.',
  input_schema: {
    type: 'object' as const,
    properties: {
      hanzi: { type: 'string', description: 'The corrected Chinese sentence (smallest change)' },
      english: { type: 'string', description: 'A short English translation of it' },
      already_correct: { type: 'boolean', description: 'true only when nothing is wrong with the sentence' },
    },
    required: ['hanzi', 'english', 'already_correct'],
  },
};

export function choiceCorrectionUserTurn(input: ChoiceCorrectionInput): string {
  return [
    input.question ? `Question: ${input.question}` : null,
    `The sentence with the mistake (the answer the author marked): <wrong>${input.sentence}</wrong>`,
    input.others?.length ? `The other options (correct sentences):\n${input.others.map((o) => `- ${o}`).join('\n')}` : null,
    input.explanation ? `The author's explanation: ${input.explanation}` : null,
  ].filter(Boolean).join('\n');
}

export async function choiceCorrectionHash(input: Pick<ChoiceCorrectionInput, 'question' | 'sentence'>): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(choiceCorrectionCacheText(input)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ChoiceCorrectionDeps {
  apiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  onUsage?: (usage: { input_tokens: number; output_tokens: number }, model: string) => void;
}

function withAppPinyin(result: ChoiceCorrectionResult): ChoiceCorrectionResult {
  const pinyin = appPinyin(result.correction.hanzi);
  return pinyin ? { ...result, correction: { ...result.correction, pinyin } } : result;
}

/** One model call (no cache). */
export async function runChoiceCorrection(input: ChoiceCorrectionInput, deps: ChoiceCorrectionDeps): Promise<ChoiceCorrectionResult> {
  const result = await structuredCall({
    apiKey: deps.apiKey,
    model: ANSWER_CHECK_MODEL,
    fallbackModel: ANSWER_CHECK_FALLBACK_MODEL,
    system: CHOICE_CORRECTION_SYSTEM,
    user: choiceCorrectionUserTurn(input),
    tool: TOOL,
    maxTokens: 300,
    attempts: 2,
    timeoutMs: 15_000,
    validate: (raw) => normalizeChoiceCorrection(raw, input.sentence),
    onUsage: deps.onUsage,
    client: deps.client,
  });
  return withAppPinyin(result);
}

/** Cached for everyone; a miss asks the model once and stores the answer. */
export async function correctChoiceSentence(
  db: D1Database,
  input: ChoiceCorrectionInput,
  deps: ChoiceCorrectionDeps,
): Promise<ChoiceCorrectionResult & { cached: boolean }> {
  const hash = await choiceCorrectionHash(input);
  try {
    const row = await db.prepare('SELECT check_json FROM lesson_answer_checks WHERE hash = ? AND version = ?')
      .bind(hash, CHOICE_CORRECTION_VERSION).first<{ check_json: string }>();
    if (row) return { ...normalizeChoiceCorrection(JSON.parse(row.check_json), input.sentence), cached: true };
  } catch (error) {
    console.warn('[choice-correction] cache read failed:', error instanceof Error ? error.message : error);
  }
  const result = await runChoiceCorrection(input, deps);
  try {
    await db.prepare(
      'INSERT OR REPLACE INTO lesson_answer_checks (hash, version, exercise_type, verdict, check_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(hash, CHOICE_CORRECTION_VERSION, CHOICE_CORRECTION_TYPE, result.unchanged ? 'unchanged' : 'corrected', JSON.stringify(result), new Date().toISOString()).run();
  } catch (error) {
    console.warn('[choice-correction] cache write failed:', error instanceof Error ? error.message : error);
  }
  return { ...result, cached: false };
}
