/**
 * Claude's check of a sentence the learner made in a sentence_making lesson
 * exercise: is it grammatical and natural, did it use every target word, and
 * what would a native speaker write. Short and fast — the learner is mid-
 * lesson — so it rides on structuredCall (forced tool, thinking off, retries,
 * Haiku fallback). Offline the exercise is self-assessed instead.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { sentenceUsesWord, type SentenceFeedback } from '@shared/lesson';
import { structuredCall } from './structured-call';

const SYSTEM = `You check one sentence a Chinese learner wrote in a lesson exercise: they had to make their OWN sentence using the target words (in the situation given, if any).

Judge it like an encouraging, rigorous tutor:
- verdict "correct": grammatical and natural, uses every target word appropriately.
- verdict "minor": understandable with a small slip (a measure word, 了 placement, word choice, an unnatural but grammatical phrasing).
- verdict "incorrect": ungrammatical, a target word misused or missing, or it doesn't mean what they probably meant.
- uses_all_words: true only if every target word appears and is used in a sense that fits.
- corrected: the closest natural version of THEIR sentence (keep their meaning and as much wording as possible) with tone-marked pinyin and English. Omit it when the verdict is "correct".
- comment: 1-2 short sentences in English — what's good, and the one thing to fix (name the words). No lists.
Pinyin always uses tone marks (nǐ hǎo), never numbers. Answer with the check_sentence tool.`;

const TOOL = {
  name: 'check_sentence',
  description: 'Return the verdict, whether all target words were used, an optional corrected sentence and a short comment.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', enum: ['correct', 'minor', 'incorrect'] },
      uses_all_words: { type: 'boolean' },
      corrected: {
        type: 'object',
        properties: {
          hanzi: { type: 'string' },
          pinyin: { type: 'string', description: 'Tone marks, not numbers' },
          english: { type: 'string' },
        },
        required: ['hanzi', 'pinyin', 'english'],
      },
      comment: { type: 'string', description: '1-2 sentences in English' },
    },
    required: ['verdict', 'uses_all_words', 'comment'],
  },
};

export interface SentenceMakingInput {
  words: string[];
  task?: string;
  sentence: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Shape-check the tool input; throws (→ retried) when the essentials are missing. */
export function normalizeSentenceFeedback(raw: unknown, input: SentenceMakingInput): SentenceFeedback {
  const r = (raw ?? {}) as Record<string, unknown>;
  const verdict = r.verdict === 'correct' || r.verdict === 'minor' || r.verdict === 'incorrect' ? r.verdict : null;
  const comment = str(r.comment);
  if (!verdict || !comment) throw new Error('Invalid sentence check from AI');
  // A word that isn't in the sentence at all is never "used", whatever the model says.
  const allPresent = input.words.every(w => sentenceUsesWord(input.sentence, w));
  const c = (r.corrected ?? null) as Record<string, unknown> | null;
  const corrected = c && str(c.hanzi) && verdict !== 'correct'
    ? { hanzi: str(c.hanzi), pinyin: str(c.pinyin) || undefined, english: str(c.english) || undefined }
    : undefined;
  return { verdict, uses_all_words: r.uses_all_words === true && allPresent, corrected, comment };
}

export async function checkMadeSentence(
  apiKey: string,
  input: SentenceMakingInput,
  client?: Pick<Anthropic, 'messages'>,
): Promise<SentenceFeedback> {
  const user = [
    `Target words: ${input.words.join('、')}`,
    input.task ? `Task: ${input.task}` : null,
    `The learner wrote: ${input.sentence.trim()}`,
  ].filter(Boolean).join('\n');
  return structuredCall({
    apiKey,
    model: 'claude-sonnet-5',
    system: SYSTEM,
    user,
    tool: TOOL,
    maxTokens: 1200,
    timeoutMs: 30_000,
    validate: raw => normalizeSentenceFeedback(raw, input),
    client,
  });
}
