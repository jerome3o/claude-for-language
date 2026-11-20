import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall } from './structured-call';
import { isContrivedSentence } from '@shared/study/sentenceFocus';
import { SIMPLE_SENTENCE_MAX_HAN, simpleSentenceMaxHan, simpleSentenceProblems } from '@shared/study/sentenceSimplicity';
import { fakeSentenceSet } from './sentence-set-fake';
import {
  structureUsedBy,
  structuresPromptBlock,
  type LearnerStructure,
} from '@shared/lesson/learnerStructures';
import { sentenceStyleOf, sentenceStylePrompt, type SentenceStyle } from '@shared/study/sentenceStyle';

/**
 * Sentence sets: a graded list of example sentences for a single vocabulary
 * item, generated in one AI call.
 *
 * The set is varied rather than "five ways to say the same thing": it ramps
 * from a very simple structure to a genuinely complex one, across different
 * everyday situations, and shows the word's usual collocations. Every sentence
 * is one a native speaker would naturally say. Until Nov 2026 the prompt also
 * REQUIRED one sentence around a word sharing a character with the target and
 * one around an easily-confused / similar-sounding word — Jerome found those
 * contrived ("used to build a sentence with some related or similar sounding
 * word"). New sets never ask for them; the old rows (focus shared_character /
 * contrast) stay stored, listed last and kept out of the Sentence round
 * (shared/study/sentenceFocus.ts).
 *
 * Simple sentences (Nov 2026, Jerome: "some of the sentences are too complicated — relatively simple
 * sentences … use these sentence structures, so that doing these cards I also learn the structures"):
 * every sentence is short (≈ 6–14 characters, never over SIMPLE_SENTENCE_MAX_HAN — more for a long word),
 * one clause (two short halves at most), everyday words — preferring words the learner already has — and,
 * where natural, one of the grammar structures from his done mini lessons (shared/lesson/learnerStructures.ts),
 * tagged on the row (`structure`). A NEW sentence over the limits is dropped (`simpleSentenceProblems`,
 * shared/study/sentenceSimplicity.ts); stored sentences are never touched.
 *
 * Example sentence style (Nov 2026, Jerome: "I might be learning a relatively formal form of Chinese … a gentle
 * suggestion that if there is a relevant colloquial term, saying or usage, occasionally use it"): the note OWNER's
 * register — standard / everyday (default) / casual (shared/study/sentenceStyle.ts `sentenceStylePrompt`) — goes in
 * the USER message (per learner), never the static system prompt. Only new sentences follow it.
 *
 * Sonnet is used here (rather than Opus) because the set is generated
 * interactively while studying and speed matters more than prose quality.
 */

const MODEL = 'claude-sonnet-5';

export const SENTENCE_SET_DEFAULT_COUNT = 6;
export const SENTENCE_SET_MIN_COUNT = 3;
export const SENTENCE_SET_MAX_COUNT = 10;

/**
 * Why a sentence is in the set. `shared_character` / `contrast` are only on rows written before
 * Nov 2026 (contrived: `isContrivedSentence`); the generator offers the natural ones only.
 */
export type SentenceFocus =
  | 'core'
  | 'shared_character'
  | 'contrast'
  | 'collocation'
  | 'complex';

/** The focuses a new sentence may have (the tool's enum): natural usage only. */
export const GENERATED_SENTENCE_FOCUS: SentenceFocus[] = ['core', 'collocation', 'complex'];

export interface GeneratedSentence {
  hanzi: string;
  pinyin: string;
  translation: string;
  focus: SentenceFocus;
  focusNote: string | null;
  /** The learner's structure it uses (its name, "除了…还…"), checked against the sentence; null = none. */
  structure?: string | null;
}

export interface SentenceSetInput {
  hanzi: string;
  pinyin: string;
  english: string;
  /** Sentences the learner already has for this word — don't repeat them. */
  existing?: string[];
  /** Free-text bio so examples can land in the learner's actual life. */
  bio?: string | null;
  /** Extra instructions typed by the learner (they win over the length limits). */
  customPrompt?: string | null;
  /** Words the learner has started — the sentences lean on them (claude-agent/learner.ts sampleKnownWords). */
  knownWords?: string[];
  /** Grammar structures from his done mini lessons to use where natural (≤ ~10, structuresForPrompt). */
  structures?: LearnerStructure[];
  /** The owner's "Example sentence style" (`users.sentence_style`); absent = the default, everyday. */
  style?: SentenceStyle | null;
}

export const SENTENCE_SET_SYSTEM_PROMPT = `You are an expert Mandarin teacher building a graded "sentence set" for a single vocabulary item.

The learner wants to see the word used several different ways in one sitting, in the kind of sentences people really say, so they can feel how it is used: the situations it comes up in and the words it normally goes with.

HARD REQUIREMENTS
1. Every sentence must contain the target word exactly as written, unchanged.
2. Order the sentences by increasing difficulty. Sentence 1 is the easiest; the last sentence is the hardest.
3. Each entry is ONE short sentence. At most one internal Chinese comma (，); never use line breaks, never return two sentences in one entry, and never use English punctuation in the Chinese.
4. Pinyin uses tone marks (nǐ hǎo), never tone numbers. Multi-syllable words stay together (zhège, not zhè ge).
5. The English translation is natural English, not a gloss.
6. Every sentence is something a native speaker would naturally say or write in real life. Use the word in its most common meaning(s) and its usual collocations. Never build a sentence to show off another word: no sentence exists to squeeze in a look-alike, a homophone, a similar-sounding word, a near-synonym or another word sharing a character with the target. If a sentence sounds like a textbook exercise rather than something people say, replace it.

KEEP THEM SIMPLE
- Every sentence is short and easy to follow by ear: about 6-14 Chinese characters, never more than ${SIMPLE_SENTENCE_MAX_HAN} (a long target word may add its own length).
- One clause. At most one comma, only for two short halves of one familiar pattern (因为…所以…, 如果…就…). No relative clauses stacked on relative clauses, no lists, no sentences inside sentences.
- Everyday vocabulary only. Prefer words the learner already knows (listed below when known); any other word should be very common.
- Order them from easiest to slightly less easy, but even the last one stays short and simple.

VARIETY
- Spread the sentences over different everyday situations (home, work, shopping, travel, friends, plans, feelings …) rather than one scene repeated.
- At least one sentence shows the most common collocation, set phrase or grammatical pattern this word normally appears in — tag it "collocation" and name the pattern in focus_note.
- Tag the other sentences "core" (plain natural usage), or "complex" for the last, slightly harder ones.
- When the learner's grammar structures are listed, use one of them in some sentences WHERE IT FITS THE WORD NATURALLY, and put that structure's name in "structure". Never force a structure onto a word it doesn't suit; leave "structure" empty then.

focus_note is a short learner-facing English note (under 90 characters). It is REQUIRED for collocation and optional otherwise.

Return the sentences via the create_sentence_set tool.`;

/** The per-learner user message (exported for tests). */
export function buildUserPrompt(input: SentenceSetInput, count: number): string {
  const parts = [
    `Target word: ${input.hanzi} (${input.pinyin}) — "${input.english}"`,
    `Produce exactly ${count} sentences, ordered from easiest to hardest.`,
    // The learner's register (Settings → "Example sentence style"). Every rule of the system prompt still holds.
    sentenceStylePrompt(sentenceStyleOf(input.style)),
  ];

  const existing = (input.existing || []).filter(Boolean);
  if (existing.length > 0) {
    parts.push(
      `The learner has already seen these sentences — write different ones:\n${existing
        .map((s) => `- ${s}`)
        .join('\n')}`
    );
  }

  const known = (input.knownWords || []).filter(Boolean).slice(0, 80);
  if (known.length > 0) {
    parts.push(`Words the learner already knows — build the sentences mostly from these and other very common words:\n${known.join('、')}`);
  }

  const structures = structuresPromptBlock(input.structures || []);
  if (structures) {
    parts.push(
      `Grammar structures the learner is learning in their lessons. Where one fits this word naturally, use it in a sentence (still short and simple) and give its name in "structure"; never force one:\n${structures}`
    );
  }

  if (input.bio) {
    parts.push(
      `The learner describes themselves as: "${input.bio}". Where it fits naturally, make a couple of the sentences relevant to their life or interests — but never at the cost of natural sentences or the difficulty ramp.`
    );
  }

  if (input.customPrompt) {
    parts.push(`Additional instructions from the learner: "${input.customPrompt}"`);
  }

  return parts.join('\n\n');
}

function coerceFocus(value: unknown): SentenceFocus {
  if (GENERATED_SENTENCE_FOCUS.includes(value as SentenceFocus)) return value as SentenceFocus;
  // Off the enum but saying it was built around a look-alike: keep that, so it stays out of the round.
  if (typeof value === 'string' && isContrivedSentence(value)) return value as SentenceFocus;
  return 'core';
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
  structure?: string;
}

/**
 * The model's `sentences` as an array, whatever shape it arrived in. Now and
 * then the forced tool call comes back with the array serialised as a JSON
 * STRING (`"sentences": "[{\"hanzi\": ...}]"`), occasionally wrapped once more
 * in an object or keyed by index. Treating that as an array threw
 * "(raw || []).filter is not a function" and failed the whole set — the
 * "Could not generate sentences" a learner saw on a card. Exported for tests.
 */
export function coerceSentenceArray(raw: unknown, depth = 0): RawGeneratedSentence[] {
  if (Array.isArray(raw)) return raw as RawGeneratedSentence[];
  if (depth > 3 || raw == null) return [];
  if (typeof raw === 'string') {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    if (!text.startsWith('[') && !text.startsWith('{')) return [];
    try {
      return coerceSentenceArray(JSON.parse(text), depth + 1);
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('sentences' in obj) return coerceSentenceArray(obj.sentences, depth + 1);
    // A single sentence object, or one keyed "0", "1", ...
    if (typeof obj.hanzi === 'string') return [obj as RawGeneratedSentence];
    const values = Object.values(obj);
    if (values.length > 0 && values.every((v) => v && typeof v === 'object')) {
      return values as RawGeneratedSentence[];
    }
  }
  return [];
}

/**
 * Turn the model's tool output into storable rows: drop empty entries, coerce
 * an unknown focus to "core", and never return more than was asked for.
 * Accepts the array in any shape `coerceSentenceArray` understands.
 * Exported for tests.
 */
export function normalizeGeneratedSentences(
  raw: unknown,
  count: number
): GeneratedSentence[] {
  return coerceSentenceArray(raw)
    .filter((s) => s && typeof s === 'object' && typeof s.hanzi === 'string' && s.hanzi.trim().length > 0)
    .map((s) => ({
      hanzi: cleanHanzi(s.hanzi as string),
      pinyin: typeof s.pinyin === 'string' ? s.pinyin.trim() : '',
      translation: typeof s.translation === 'string' ? s.translation.trim() : '',
      focus: coerceFocus(s.focus),
      focusNote: typeof s.focus_note === 'string' && s.focus_note.trim() ? s.focus_note.trim() : null,
      structure: typeof s.structure === 'string' && s.structure.trim() ? s.structure.trim() : null,
    }))
    .slice(0, count);
}

/** Letters only (no spaces / punctuation), for "contains the word". */
function bare(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * The new sentences worth keeping: the word in it (as written), simple enough (`simpleSentenceProblems` —
 * skipped when the learner typed his own instructions), and a `structure` only when it is one of the listed
 * ones AND the sentence really has its fixed words (else the one the sentence does use, else null).
 * Exported for tests.
 */
export function keepSimpleSentences(
  sentences: GeneratedSentence[],
  input: Pick<SentenceSetInput, 'hanzi' | 'customPrompt' | 'structures'>
): GeneratedSentence[] {
  const word = bare(input.hanzi);
  const structures = input.structures || [];
  return sentences
    .filter((s) => !word || bare(s.hanzi).includes(word))
    .filter((s) => !!input.customPrompt || simpleSentenceProblems(s.hanzi, input.hanzi).length === 0)
    .map((s) => {
      const listed = s.structure ? structures.find((x) => x.name === s.structure) : undefined;
      const used = listed && structureUsedBy(s.hanzi, [listed]) ? listed.name : structureUsedBy(s.hanzi, structures);
      return { ...s, structure: used ?? null };
    });
}

/**
 * Generate a graded sentence set for one note, through `structuredCall`
 * (forced tool, thinking off, stop_reason checked, a bad shape retried like
 * any error, the last attempt on the fallback model, a timeout).
 * Returns sentences already ordered easiest -> hardest. Throws a
 * StructuredCallError (`retryable`) when every attempt failed.
 */
export async function generateSentenceSet(
  apiKey: string,
  input: SentenceSetInput,
  requestedCount?: number,
  options: {
    client?: Pick<Anthropic, 'messages'>;
    sleep?: (ms: number) => Promise<void>;
    /** E2E_TEST_MODE: the deterministic stand-in (sentence-set-fake.ts), no model call. */
    fake?: boolean;
  } = {}
): Promise<GeneratedSentence[]> {
  const count = clampSentenceCount(requestedCount);
  if (options.fake) return keepSimpleSentences(fakeSentenceSet(input, count), input);
  const userPrompt = buildUserPrompt(input, count);

  const tool = {
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
                enum: GENERATED_SENTENCE_FOCUS,
                description: 'Why this sentence is in the set',
              },
              focus_note: {
                type: 'string',
                description:
                  'Short English note (<90 chars) naming the pattern, or the colloquial word / saying the sentence uses. Required for collocation.',
              },
              structure: {
                type: 'string',
                description:
                  "The name of the learner's listed grammar structure this sentence uses, exactly as listed; empty when none.",
              },
            },
            required: ['hanzi', 'pinyin', 'translation', 'focus'],
          },
        },
      },
      required: ['sentences'],
    },
  };

  return structuredCall({
    apiKey,
    model: MODEL,
    system: SENTENCE_SET_SYSTEM_PROMPT,
    user: userPrompt,
    tool,
    maxTokens: 6000,
    // A set is ~1-2k output tokens; give a slow reply room before giving up.
    timeoutMs: 90_000,
    validate: (raw) => {
      const all = normalizeGeneratedSentences(raw, count);
      if (all.length === 0) {
        throw new Error('AI returned an empty sentence set');
      }
      const sentences = keepSimpleSentences(all, input);
      if (sentences.length === 0) {
        // Every one too long / without the word: ask again (structuredCall retries).
        throw new Error(`AI returned no simple sentences (max ${simpleSentenceMaxHan(input.hanzi)} characters, one clause)`);
      }
      if (sentences.length < all.length) {
        console.log('[sentence-set] dropped', all.length - sentences.length, 'of', all.length, 'sentences (too long / no word)');
      }
      return sentences;
    },
    client: options.client,
    sleep: options.sleep,
  });
}

/**
 * How long to wait before trying again for a sentence that still has no clip,
 * by attempt number (1 = the first retry). MiniMax reports rate limits as
 * empty successes, and bulk generation hits them in bursts, so a few widely
 * spaced retries recover nearly every row; past that the row is left for the
 * hourly sweep and the coverage page's backfill. Returns null when the
 * attempts are used up.
 */
export const SENTENCE_AUDIO_RETRY_DELAYS_S = [60, 300, 900] as const;

export function sentenceAudioRetryDelay(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 1) return SENTENCE_AUDIO_RETRY_DELAYS_S[0];
  const index = Math.floor(attempt) - 1;
  return index < SENTENCE_AUDIO_RETRY_DELAYS_S.length ? SENTENCE_AUDIO_RETRY_DELAYS_S[index] : null;
}
