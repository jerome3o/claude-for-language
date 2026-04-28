import Anthropic from '@anthropic-ai/sdk';
import type { VocabularyItem } from '../types';

const MODEL = 'claude-opus-4-6';

export interface GrammarPoint {
  id: string;
  level: string;
  title: string;
  pattern: string;
  explanation: string;
  cgw_url: string | null;
  seed_examples: Array<{ hanzi: string; pinyin: string; english: string }>;
  order_index: number;
}

export interface ExampleSentence {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface ScrambleExercise {
  english: string;
  tiles: string[];
  correct_order: string[];
  alt_orders?: string[][];
}

export interface ContrastExercise {
  context: string;
  option_a: ExampleSentence;
  option_b: ExampleSentence;
  correct: 'a' | 'b';
  explanation: string;
}

export interface TranslateExercise {
  english: string;
  reference_hanzi: string;
  reference_pinyin: string;
}

export interface PracticeSessionContent {
  grammar_point: GrammarPoint;
  flood: ExampleSentence[];
  scrambles: ScrambleExercise[];
  contrasts: ContrastExercise[];
  translates: TranslateExercise[];
}

export interface TranslateFeedback {
  is_correct: boolean;
  uses_target_structure: boolean;
  diff_segments: Array<{ text: string; status: 'same' | 'removed' | 'added' }>;
  corrected_hanzi: string;
  corrected_pinyin: string;
  explanation: string;
}

const VOCAB_CAP = 120;

function vocabBlock(vocab: VocabularyItem[]): string {
  const sample =
    vocab.length <= VOCAB_CAP
      ? vocab
      : [...vocab].sort(() => Math.random() - 0.5).slice(0, VOCAB_CAP);
  return sample.map((v) => `${v.hanzi} (${v.pinyin}) — ${v.english}`).join('\n');
}

function grammarBlock(gp: GrammarPoint): string {
  const examples = gp.seed_examples
    .map((e) => `  ${e.hanzi} — ${e.pinyin} — ${e.english}`)
    .join('\n');
  return `Title: ${gp.title}\nPattern: ${gp.pattern}\nExplanation: ${gp.explanation}\nReference examples:\n${examples}`;
}

const GENERATION_SYSTEM_PROMPT = `You are generating Chinese grammar practice exercises for an A2-level learner.

CRITICAL CONSTRAINTS:
- Use ONLY vocabulary from the learner's known-words list. If a word isn't on the list, do not use it. Basic function words (的, 了, 是, 不, 很, pronouns, numbers, common measure words) are always allowed.
- Every sentence must be natural Mandarin a native speaker would actually say. After drafting each sentence, silently re-read it and ask "would a native say this?" — if not, rewrite it.
- Pinyin uses tone MARKS (nǐ hǎo), never tone numbers.
- Keep sentences short (4–10 characters) and concrete. No abstract or literary phrasing.`;

const SESSION_TOOL: Anthropic.Tool = {
  name: 'create_practice_session',
  description: 'Generate a complete practice session for one grammar point.',
  input_schema: {
    type: 'object' as const,
    properties: {
      flood: {
        type: 'array',
        description:
          '6 example sentences demonstrating the target pattern. Vary the vocabulary and context across examples.',
        items: {
          type: 'object',
          properties: {
            hanzi: { type: 'string' },
            pinyin: { type: 'string' },
            english: { type: 'string' },
          },
          required: ['hanzi', 'pinyin', 'english'],
        },
      },
      scrambles: {
        type: 'array',
        description:
          '3 word-order exercises. Tiles are individual words/particles the learner drags into order. correct_order is the canonical ordering of those tiles. Only include alt_orders if a genuinely different ordering is also grammatical.',
        items: {
          type: 'object',
          properties: {
            english: { type: 'string', description: 'The target meaning in English' },
            tiles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Word tiles in SCRAMBLED order (not the correct order)',
            },
            correct_order: {
              type: 'array',
              items: { type: 'string' },
              description: 'Same tiles in correct order',
            },
            alt_orders: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
            },
          },
          required: ['english', 'tiles', 'correct_order'],
        },
      },
      contrasts: {
        type: 'array',
        description:
          '3 contrastive-pair exercises. Two near-identical sentences differing in ONE grammatical feature (the target structure vs an alternative). Given the English context, exactly one option fits.',
        items: {
          type: 'object',
          properties: {
            context: {
              type: 'string',
              description:
                'A short English context that makes only one option correct, e.g. "You want to say you have had the experience at some point in your life."',
            },
            option_a: {
              type: 'object',
              properties: {
                hanzi: { type: 'string' },
                pinyin: { type: 'string' },
                english: { type: 'string' },
              },
              required: ['hanzi', 'pinyin', 'english'],
            },
            option_b: {
              type: 'object',
              properties: {
                hanzi: { type: 'string' },
                pinyin: { type: 'string' },
                english: { type: 'string' },
              },
              required: ['hanzi', 'pinyin', 'english'],
            },
            correct: { type: 'string', enum: ['a', 'b'] },
            explanation: {
              type: 'string',
              description: 'One sentence on why the correct option fits and the other does not.',
            },
          },
          required: ['context', 'option_a', 'option_b', 'correct', 'explanation'],
        },
      },
      translates: {
        type: 'array',
        description:
          '5 English prompts the learner will translate into Chinese using the target structure. Provide a reference answer for each.',
        items: {
          type: 'object',
          properties: {
            english: { type: 'string' },
            reference_hanzi: { type: 'string' },
            reference_pinyin: { type: 'string' },
          },
          required: ['english', 'reference_hanzi', 'reference_pinyin'],
        },
      },
    },
    required: ['flood', 'scrambles', 'contrasts', 'translates'],
  },
};

export async function generatePracticeSession(
  apiKey: string,
  grammarPoint: GrammarPoint,
  vocabulary: VocabularyItem[]
): Promise<PracticeSessionContent> {
  const client = new Anthropic({ apiKey });

  const userPrompt = `Target grammar point:
${grammarBlock(grammarPoint)}

Learner's known vocabulary (use ONLY these plus basic function words):
${vocabBlock(vocabulary)}

Generate a practice session: 6 flood examples, 3 scrambles, 3 contrastive pairs, 5 translation prompts. Every sentence must demonstrate or test the target pattern "${grammarPoint.pattern}".`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: GENERATION_SYSTEM_PROMPT,
    tools: [SESSION_TOOL],
    tool_choice: { type: 'tool', name: 'create_practice_session' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Practice generation returned no tool_use block');
  }
  const input = toolUse.input as Omit<PracticeSessionContent, 'grammar_point'>;
  return { grammar_point: grammarPoint, ...input };
}

const FEEDBACK_TOOL: Anthropic.Tool = {
  name: 'give_feedback',
  description: 'Return minimal-correction feedback on a learner translation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      is_correct: {
        type: 'boolean',
        description:
          'True if the learner sentence is grammatical, conveys the target meaning, AND uses the target structure. Minor word-choice differences from the reference are still correct.',
      },
      uses_target_structure: {
        type: 'boolean',
        description: 'True if the target grammar pattern is present in the learner sentence.',
      },
      corrected_hanzi: {
        type: 'string',
        description:
          'The learner sentence with ONLY grammatical errors fixed. Preserve their vocabulary choices. Do NOT rewrite for style. If already correct, return it unchanged.',
      },
      corrected_pinyin: { type: 'string' },
      diff_segments: {
        type: 'array',
        description:
          'Character-level diff from learner sentence to corrected_hanzi. Concatenating segments with status same|added must equal corrected_hanzi; same|removed must equal the learner sentence.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            status: { type: 'string', enum: ['same', 'removed', 'added'] },
          },
          required: ['text', 'status'],
        },
      },
      explanation: {
        type: 'string',
        description:
          'One or two sentences. If wrong: what the structural error was. If correct: brief affirmation, optionally note an alternative phrasing.',
      },
    },
    required: [
      'is_correct',
      'uses_target_structure',
      'corrected_hanzi',
      'corrected_pinyin',
      'diff_segments',
      'explanation',
    ],
  },
};

const FEEDBACK_SYSTEM_PROMPT = `You are checking an A2 Chinese learner's translation against a target grammar structure.

RULES:
- Correct ONLY grammatical errors. Do not improve word choice, do not rewrite for style, preserve the learner's vocabulary.
- A sentence that is grammatical, means the right thing, and uses the target structure is CORRECT even if it differs from the reference answer.
- If the learner's sentence is grammatical but does NOT use the target structure, mark uses_target_structure=false and explain they should try again with the pattern.
- The diff must be minimal: the smallest set of removals/insertions to get from the learner's sentence to your corrected version.`;

async function runFeedback(apiKey: string, userPrompt: string): Promise<TranslateFeedback> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: FEEDBACK_SYSTEM_PROMPT,
    tools: [FEEDBACK_TOOL],
    tool_choice: { type: 'tool', name: 'give_feedback' },
    messages: [{ role: 'user', content: userPrompt }],
  });
  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!toolUse) throw new Error('Feedback check returned no tool_use block');
  return toolUse.input as TranslateFeedback;
}

export async function checkTranslation(
  apiKey: string,
  grammarPoint: GrammarPoint,
  exercise: TranslateExercise,
  userAnswer: string
): Promise<TranslateFeedback> {
  return runFeedback(
    apiKey,
    `Target grammar point:
${grammarBlock(grammarPoint)}

English prompt: ${exercise.english}
Reference answer: ${exercise.reference_hanzi} (${exercise.reference_pinyin})

Learner's answer: ${userAnswer}

Give minimal-correction feedback.`,
  );
}

export async function checkProduction(
  apiKey: string,
  grammarPoint: GrammarPoint,
  userAnswer: string
): Promise<TranslateFeedback> {
  return runFeedback(
    apiKey,
    `Target grammar point:
${grammarBlock(grammarPoint)}

The learner was asked to produce ANY sentence using this pattern (no specific meaning required).

Learner's answer (transcribed from speech): ${userAnswer}

Judge whether the sentence is grammatical Chinese AND uses the target structure. Give minimal-correction feedback. If the structure is missing, set uses_target_structure=false and explain which part of the pattern is absent.`,
  );
}

// Validate a learner's scramble ordering. Exact match against correct_order or any alt_orders.
export function checkScramble(exercise: ScrambleExercise, userOrder: string[]): boolean {
  const eq = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  if (eq(userOrder, exercise.correct_order)) return true;
  return (exercise.alt_orders ?? []).some((alt) => eq(userOrder, alt));
}
