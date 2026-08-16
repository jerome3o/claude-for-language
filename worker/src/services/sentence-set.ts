import Anthropic from '@anthropic-ai/sdk';

/**
 * Sentence sets: a graded list of example sentences for a single vocabulary
 * item, generated in one AI call.
 *
 * The set is deliberately varied rather than "five ways to say the same thing":
 * it ramps from a very simple structure to a genuinely complex one, and a
 * couple of the sentences exist to place the word in the language — one uses
 * another word sharing a character with the target, one contrasts it with an
 * easily-confused word, one shows its most common collocation.
 *
 * Sonnet is used here (rather than Opus) because the set is generated
 * interactively while studying and speed matters more than prose quality.
 */

const MODEL = 'claude-sonnet-5';

export const SENTENCE_SET_DEFAULT_COUNT = 6;
export const SENTENCE_SET_MIN_COUNT = 3;
export const SENTENCE_SET_MAX_COUNT = 10;

export type SentenceFocus =
  | 'core'
  | 'shared_character'
  | 'contrast'
  | 'collocation'
  | 'complex';

const VALID_FOCUS: SentenceFocus[] = [
  'core',
  'shared_character',
  'contrast',
  'collocation',
  'complex',
];

export interface GeneratedSentence {
  hanzi: string;
  pinyin: string;
  translation: string;
  focus: SentenceFocus;
  focusNote: string | null;
}

export interface SentenceSetInput {
  hanzi: string;
  pinyin: string;
  english: string;
  /** Sentences the learner already has for this word — don't repeat them. */
  existing?: string[];
  /** Free-text bio so examples can land in the learner's actual life. */
  bio?: string | null;
  /** Extra instructions typed by the learner. */
  customPrompt?: string | null;
}

const SYSTEM_PROMPT = `You are an expert Mandarin teacher building a graded "sentence set" for a single vocabulary item.

The learner wants to see the word used several different ways in one sitting, so they can feel where it sits in the language: what it collocates with, what it is near, and what it is different from.

HARD REQUIREMENTS
1. Every sentence must contain the target word exactly as written, unchanged.
2. Order the sentences by increasing difficulty. Sentence 1 is the easiest; the last sentence is the hardest.
3. Each entry is ONE sentence. Internal Chinese commas (，) are fine in the harder sentences; never use line breaks, never return two sentences in one entry, and never use English punctuation in the Chinese.
4. Pinyin uses tone marks (nǐ hǎo), never tone numbers. Multi-syllable words stay together (zhège, not zhè ge).
5. The English translation is natural English, not a gloss.

DIFFICULTY RAMP
- First 1-2 sentences: 4-8 characters. Basic subject-verb-object, 是 / 有 / adjective predicates. Only very common vocabulary. No subordinate clauses.
- Middle sentences: everyday spoken structures — time and place words, 在 / 给 / 跟 / 对, modal verbs (想 / 要 / 会 / 可以), 了 / 过 aspect, simple 的 modifiers.
- Last 1-2 sentences: 12-25 characters with genuinely more complex grammar — connectives (虽然…但是, 不但…而且, 如果…就, 因为…所以), 把 or 被, resultative/directional complements, or a relative clause with 的.

VARIETY REQUIREMENTS (this is the point of the set — do not skip)
Across the set, include at least one of each of these, tagged with the matching "focus":
- "shared_character": the sentence also contains a DIFFERENT word that shares a character with the target word, so the learner sees that character doing another job. Explain the link in focus_note.
- "contrast": the sentence includes a word that is easily confused with the target — a near-synonym, a homophone, or a look-alike — used correctly alongside it, so the difference is visible. Explain the difference in focus_note.
- "collocation": the sentence shows the most common collocation, set phrase, or grammatical pattern this word normally appears in. Name the pattern in focus_note.
Tag the remaining sentences "core" (plain natural usage), or "complex" for the hardest ones at the end.

focus_note is a short learner-facing English note (under 90 characters) explaining why this sentence is in the set. It is REQUIRED for shared_character, contrast, and collocation, and optional otherwise.

Return the sentences via the create_sentence_set tool.`;

function buildUserPrompt(input: SentenceSetInput, count: number): string {
  const parts = [
    `Target word: ${input.hanzi} (${input.pinyin}) — "${input.english}"`,
    `Produce exactly ${count} sentences, ordered from easiest to hardest.`,
  ];

  const existing = (input.existing || []).filter(Boolean);
  if (existing.length > 0) {
    parts.push(
      `The learner has already seen these sentences — write different ones:\n${existing
        .map((s) => `- ${s}`)
        .join('\n')}`
    );
  }

  if (input.bio) {
    parts.push(
      `The learner describes themselves as: "${input.bio}". Where it fits naturally, make a couple of the sentences relevant to their life or interests — but never at the cost of the difficulty ramp or the variety requirements.`
    );
  }

  if (input.customPrompt) {
    parts.push(`Additional instructions from the learner: "${input.customPrompt}"`);
  }

  return parts.join('\n\n');
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

function coerceFocus(value: unknown): SentenceFocus {
  return VALID_FOCUS.includes(value as SentenceFocus) ? (value as SentenceFocus) : 'core';
}

/** Strip anything that would break TTS or the single-sentence contract. */
function cleanHanzi(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function clampSentenceCount(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return SENTENCE_SET_DEFAULT_COUNT;
  return Math.min(SENTENCE_SET_MAX_COUNT, Math.max(SENTENCE_SET_MIN_COUNT, Math.round(requested)));
}

export interface RawGeneratedSentence {
  hanzi?: string;
  pinyin?: string;
  translation?: string;
  focus?: string;
  focus_note?: string;
}

/**
 * Turn the model's tool output into storable rows: drop empty entries, coerce
 * an unknown focus to "core", and never return more than was asked for.
 * Exported for tests.
 */
export function normalizeGeneratedSentences(
  raw: RawGeneratedSentence[] | undefined,
  count: number
): GeneratedSentence[] {
  return (raw || [])
    .filter((s) => s && typeof s.hanzi === 'string' && s.hanzi.trim().length > 0)
    .map((s) => ({
      hanzi: cleanHanzi(s.hanzi as string),
      pinyin: (s.pinyin || '').trim(),
      translation: (s.translation || '').trim(),
      focus: coerceFocus(s.focus),
      focusNote: s.focus_note ? s.focus_note.trim() : null,
    }))
    .slice(0, count);
}

/**
 * Generate a graded sentence set for one note. Retries transient API errors.
 * Returns sentences already ordered easiest -> hardest.
 */
export async function generateSentenceSet(
  apiKey: string,
  input: SentenceSetInput,
  requestedCount?: number
): Promise<GeneratedSentence[]> {
  const client = new Anthropic({ apiKey });
  const count = clampSentenceCount(requestedCount);
  const userPrompt = buildUserPrompt(input, count);

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 6000,
        // Thinking is on by default on Sonnet 5 and would share the max_tokens
        // budget with the sentences themselves. This is an interactive button
        // press with a forced tool call and a tightly specified schema, so
        // turn it off: the set arrives noticeably faster and the whole budget
        // goes to the output.
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'create_sentence_set',
            description:
              'Return the graded set of example sentences, ordered from easiest to hardest.',
            input_schema: {
              type: 'object' as const,
              properties: {
                sentences: {
                  type: 'array',
                  description: `Exactly ${count} sentences, easiest first.`,
                  items: {
                    type: 'object',
                    properties: {
                      hanzi: {
                        type: 'string',
                        description: 'The Chinese sentence, containing the target word verbatim',
                      },
                      pinyin: {
                        type: 'string',
                        description: 'Pinyin with tone marks for the whole sentence',
                      },
                      translation: {
                        type: 'string',
                        description: 'Natural English translation',
                      },
                      focus: {
                        type: 'string',
                        enum: VALID_FOCUS,
                        description: 'Why this sentence is in the set',
                      },
                      focus_note: {
                        type: 'string',
                        description:
                          'Short English note (<90 chars) explaining the link, contrast, or pattern. Required for shared_character, contrast and collocation.',
                      },
                    },
                    required: ['hanzi', 'pinyin', 'translation', 'focus'],
                  },
                },
              },
              required: ['sentences'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'create_sentence_set' },
        messages: [{ role: 'user', content: userPrompt }],
      });

      const toolUse = response.content.find((c) => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('No sentence set in AI response');
      }

      const raw = toolUse.input as { sentences?: RawGeneratedSentence[] };
      const sentences = normalizeGeneratedSentences(raw.sentences, count);

      if (sentences.length === 0) {
        throw new Error('AI returned an empty sentence set');
      }

      return sentences;
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to generate sentence set');
}
