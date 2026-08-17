import Anthropic from '@anthropic-ai/sdk';
import { SentenceBriefExplanation } from '../types';

/**
 * A brief breakdown of one sentence from a note's sentence set: what each word
 * means, plus a line or two on how the sentence is put together.
 *
 * This is the "what is going on here?" button next to a sentence mid-study, so
 * it is optimised for speed over depth — Haiku, thinking off, a tight schema,
 * and a hard instruction to stay short. The thorough version already exists at
 * /api/sentence/explain; this is deliberately not that.
 */

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You explain a single Chinese sentence to an intermediate learner, briefly.

Split the sentence into its words (not individual characters, unless the character is a word on its own). For each word give the hanzi, its pinyin with tone marks, and a short gloss — a few words, not a definition. Grammar particles (了, 的, 吗, 把, 被, 过, 着) count as words: gloss them by their job ("completed action", "possessive", "yes/no question").

Then write one or two sentences on the construction: the pattern the sentence uses and the order things come in. Name the pattern if it has a name (把-construction, 虽然…但是, resultative complement, topic-comment). Say what a learner would get wrong, not what is obvious.

Be brief. The whole explanation should be readable in about ten seconds. Do not restate the translation. Do not pad with encouragement.

Return the breakdown via the explain_sentence tool.`;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

export async function explainSentenceBriefly(
  apiKey: string,
  sentence: { hanzi: string; pinyin?: string | null; translation?: string | null }
): Promise<SentenceBriefExplanation> {
  const client = new Anthropic({ apiKey });

  const context = [
    `Sentence: ${sentence.hanzi}`,
    sentence.pinyin ? `Pinyin: ${sentence.pinyin}` : null,
    sentence.translation ? `Means: ${sentence.translation}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'explain_sentence',
            description: 'Return a brief word-by-word breakdown and a note on the construction.',
            input_schema: {
              type: 'object' as const,
              properties: {
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
              required: ['words', 'construction'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'explain_sentence' },
        messages: [{ role: 'user', content: context }],
      });

      const toolUse = response.content.find((c) => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('No explanation in AI response');
      }

      const raw = toolUse.input as {
        words?: Array<{ hanzi?: string; pinyin?: string; gloss?: string }>;
        construction?: string;
      };

      const words = (raw.words || [])
        .filter((w) => w && typeof w.hanzi === 'string' && w.hanzi.trim().length > 0)
        .map((w) => ({
          hanzi: (w.hanzi as string).trim(),
          pinyin: (w.pinyin || '').trim(),
          gloss: (w.gloss || '').trim(),
        }));

      if (words.length === 0) {
        throw new Error('AI returned no words');
      }

      return { words, construction: (raw.construction || '').trim() };
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to explain sentence');
}
