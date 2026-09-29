import type Anthropic from '@anthropic-ai/sdk';
import { CoachBreakdown, SentenceBriefExplanation } from '../types';
import { structuredCall } from './structured-call';

/**
 * A brief breakdown of one sentence: a one-line English translation, what each
 * word means, plus a line or two on how the sentence is put together.
 *
 * Used by "What's going on here?" next to a sentence mid-study and by the
 * Sentence Coach's Explain button (instead of Google Translate), so it is
 * optimised for speed over depth — Haiku, thinking off, a tight schema, and a
 * hard instruction to stay short. The thorough version already exists at
 * /api/sentence/explain; this is deliberately not that.
 */

export const BRIEF_EXPLAIN_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You explain a single Chinese sentence to an intermediate learner, briefly.

First give a natural English translation of the whole sentence — one line, what a good translator would write. If a translation is supplied, you may reuse it.

Split the sentence into its words (not individual characters, unless the character is a word on its own). For each word give the hanzi, its pinyin with tone marks, and a short gloss — a few words, not a definition. Grammar particles (了, 的, 吗, 把, 被, 过, 着) count as words: gloss them by their job ("completed action", "possessive", "yes/no question"). Leave punctuation out. English words in the sentence are glossed as themselves.

Then write one or two sentences on the construction: the pattern the sentence uses and the order things come in. Name the pattern if it has a name (把-construction, 虽然…但是, resultative complement, topic-comment). Say what a learner would get wrong, not what is obvious.

Be brief. The whole explanation should be readable in about ten seconds. Do not restate the translation in the construction note. Do not pad with encouragement.

Return the breakdown via the explain_sentence tool.`;

const EXPLAIN_TOOL = {
  name: 'explain_sentence',
  description: 'Return a one-line translation, a brief word-by-word breakdown and a note on the construction.',
  input_schema: {
    type: 'object' as const,
    properties: {
      translation: {
        type: 'string',
        description: 'A natural one-line English translation of the whole sentence',
      },
      words: {
        type: 'array',
        description: 'The sentence split into words, in order',
        items: {
          type: 'object',
          properties: {
            hanzi: { type: 'string' },
            pinyin: { type: 'string', description: 'Tone marks, not numbers' },
            gloss: { type: 'string', description: 'A few words, not a definition' },
          },
          required: ['hanzi', 'pinyin', 'gloss'],
        },
      },
      construction: {
        type: 'string',
        description: 'One or two sentences on how the sentence is built',
      },
    },
    required: ['translation', 'words', 'construction'],
  },
};

/**
 * Clean the tool input into a SentenceBriefExplanation. Throws (so structuredCall
 * retries) when there are no words; a missing translation falls back to the one
 * supplied with the sentence, else it is left out (older cached breakdowns have none).
 */
export function normalizeBriefExplanation(
  input: unknown,
  sentence?: { translation?: string | null },
): SentenceBriefExplanation {
  const raw = (input ?? {}) as {
    words?: Array<{ hanzi?: unknown; pinyin?: unknown; gloss?: unknown }>;
    construction?: unknown;
    translation?: unknown;
  };
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const words = (Array.isArray(raw.words) ? raw.words : [])
    .filter((w) => w && str(w.hanzi).length > 0)
    .map((w) => ({ hanzi: str(w.hanzi), pinyin: str(w.pinyin), gloss: str(w.gloss) }));
  if (words.length === 0) {
    throw new Error('AI returned no words');
  }
  const translation = str(raw.translation) || str(sentence?.translation);
  return {
    words,
    construction: str(raw.construction),
    ...(translation ? { translation } : {}),
  };
}

/**
 * Accept a breakdown the client already has cached (the Coach's Explain sends it
 * so the server stores it without a second Claude call). Null when it isn't one.
 */
export function parseClientBriefExplanation(input: unknown): SentenceBriefExplanation | null {
  if (!input || typeof input !== 'object') return null;
  try {
    const e = normalizeBriefExplanation(input);
    // A cached breakdown with no translation line is regenerated, so Explain always shows one.
    if (!e.translation || e.words.length > 80) return null;
    return {
      words: e.words.map((w) => ({ hanzi: w.hanzi.slice(0, 60), pinyin: w.pinyin.slice(0, 120), gloss: w.gloss.slice(0, 200) })),
      construction: e.construction.slice(0, 1200),
      translation: e.translation.slice(0, 600),
    };
  } catch {
    return null;
  }
}

export async function explainSentenceBriefly(
  apiKey: string,
  sentence: { hanzi: string; pinyin?: string | null; translation?: string | null },
  opts: { client?: Pick<Anthropic, 'messages'>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SentenceBriefExplanation> {
  const context = [
    `Sentence: ${sentence.hanzi}`,
    sentence.pinyin ? `Pinyin: ${sentence.pinyin}` : null,
    sentence.translation ? `Means: ${sentence.translation}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return structuredCall({
    apiKey,
    model: BRIEF_EXPLAIN_MODEL,
    // Already the fast model; a retry on the same one is the fallback.
    fallbackModel: null,
    system: SYSTEM_PROMPT,
    user: context,
    tool: EXPLAIN_TOOL,
    maxTokens: 1200,
    timeoutMs: 30_000,
    validate: (input) => normalizeBriefExplanation(input, sentence),
    client: opts.client,
    sleep: opts.sleep,
  });
}

/** The Coach's Explain result: the learner's sentence + its breakdown, pinyin joined from the word rows. */
export function toCoachBreakdown(hanzi: string, explanation: SentenceBriefExplanation): CoachBreakdown {
  const pinyin = explanation.words.map((w) => w.pinyin).filter(Boolean).join(' ');
  return { hanzi, pinyin, ...explanation };
}
