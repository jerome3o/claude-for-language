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
  option_c?: ExampleSentence;
  option_d?: ExampleSentence;
  correct: 'a' | 'b' | 'c' | 'd';
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
          '3 multiple-choice exercises. Four Chinese sentences where only ONE correctly fits the given English context. The three distractors must be plausible but wrong (using the wrong grammatical structure, wrong aspect, or wrong word order). Given the English context, exactly one option fits.',
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
            option_c: {
              type: 'object',
              properties: {
                hanzi: { type: 'string' },
                pinyin: { type: 'string' },
                english: { type: 'string' },
              },
              required: ['hanzi', 'pinyin', 'english'],
            },
            option_d: {
              type: 'object',
              properties: {
                hanzi: { type: 'string' },
                pinyin: { type: 'string' },
                english: { type: 'string' },
              },
              required: ['hanzi', 'pinyin', 'english'],
            },
            correct: { type: 'string', enum: ['a', 'b', 'c', 'd'] },
            explanation: {
              type: 'string',
              description: 'One sentence on why the correct option fits and the others do not.',
            },
          },
          required: ['context', 'option_a', 'option_b', 'option_c', 'option_d', 'correct', 'explanation'],
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
  vocabulary: VocabularyItem[],
  lessonNotes?: string,
): Promise<PracticeSessionContent> {
  const client = new Anthropic({ apiKey });

  const lessonContext = lessonNotes
    ? `\n\nThe learner's tutor recently covered the material below. Prefer this vocabulary and these sentence patterns where they fit the target structure:\n${lessonNotes}\n`
    : '';

  const userPrompt = `Target grammar point:
${grammarBlock(grammarPoint)}

Learner's known vocabulary (use ONLY these plus basic function words):
${vocabBlock(vocabulary)}${lessonContext}

Generate a practice session: 6 flood examples, 3 scrambles, 3 multiple-choice exercises (each with 4 options — one correct and three plausible distractors), 5 translation prompts. Every sentence must demonstrate or test the target pattern "${grammarPoint.pattern}".`;

  const response = await client.messages.create({
    model: MODEL,
    // A full session (6 flood + 3 scramble + 3 four-option contrast + 5 translate, each with
    // hanzi/pinyin/english) is large; keep generous headroom so the tool_use JSON is never
    // truncated mid-output (a truncated tool call yields partial, unusable input).
    max_tokens: 8000,
    system: GENERATION_SYSTEM_PROMPT,
    tools: [SESSION_TOOL],
    tool_choice: { type: 'tool', name: 'create_practice_session' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  // If the model hits the token ceiling, the tool_use block is cut off and its JSON is partial,
  // leaving required arrays undefined. Fail with a clear message instead of crashing downstream.
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Practice generation was cut off before it finished. Please try again.');
  }

  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Practice generation returned no tool_use block');
  }
  const input = toolUse.input as Partial<Omit<PracticeSessionContent, 'grammar_point'>>;
  if (
    !Array.isArray(input.flood) ||
    !Array.isArray(input.scrambles) ||
    !Array.isArray(input.contrasts) ||
    !Array.isArray(input.translates)
  ) {
    throw new Error('Practice generation returned incomplete exercises. Please try again.');
  }
  // Shuffle tiles server-side so they're never in correct order regardless of AI output
  const scrambles = input.scrambles.map((s) => ({ ...s, tiles: shuffleArray(s.tiles) }));
  return {
    grammar_point: grammarPoint,
    flood: input.flood,
    scrambles,
    contrasts: input.contrasts,
    translates: input.translates,
  };
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
