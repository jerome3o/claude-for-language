import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall, StructuredCallError } from './structured-call';
import type { SentenceBreakdown, SentenceChunk } from '../types';

/**
 * Chat message translation (the message menu's Translate, the background
 * auto-translate of every Chinese message, and the word-by-word view).
 *
 * Two separate structured calls, run side by side:
 * - `translateChineseText` — ONE natural English sentence. Small output, so it
 *   comes back in a second or two whatever the message length. This is what
 *   Translate waits for.
 * - `segmentChineseText` — the aligned word-by-word breakdown. Its output grows
 *   with the message (a chunk per word), so its budget scales with the length
 *   and `structuredCall` doubles it when the reply is cut off.
 *
 * Before (Oct 2026) both came from ONE free-text "respond with JSON" Haiku call
 * capped at 2000 tokens: a 135-character message from the tutor ran into the cap
 * after ~17 s, the JSON was cut off, `JSON.parse` threw and Translate failed
 * ("Couldn't translate that message") — every time, for every long message.
 */

export const TRANSLATE_MODEL = 'claude-haiku-4-5';
/** Last attempt when Haiku fails (overloaded, timed out): a different model. */
export const TRANSLATE_FALLBACK_MODEL = 'claude-sonnet-5';

/** Longest message text sent for translation (a chat message is far shorter). */
export const TRANSLATE_MAX_CHARS = 4000;

const TRANSLATE_SYSTEM = `You translate chat messages between a Chinese learner and their tutor into natural English.
The message may mix Chinese and English; translate the whole message, keeping its tone, its line breaks and any emoji.
Translate faithfully — do not explain, correct or comment. Use the tool.`;

const TRANSLATE_TOOL = {
  name: 'give_translation',
  description: 'Return the English translation of the message.',
  input_schema: {
    type: 'object' as const,
    properties: {
      translation: { type: 'string', description: 'The natural English translation of the whole message.' },
    },
    required: ['translation'],
  },
};

const SEGMENT_SYSTEM = `You are a Chinese teacher showing a learner how a chat message is built, word by word.
Split the message into chunks — words or short grammatical units, in order — so that the chunks' hanzi joined together give the whole Chinese text (punctuation may be its own chunk or attached to the word before it).
For every chunk give its pinyin with tone marks (never tone numbers; words written together, e.g. "zhège") and its meaning in this sentence.
"english" is ONE natural translation of the whole message. A chunk's "english" should be the words of that translation it corresponds to when there are some.
Add a "note" only where it really helps (a particle, a measure word, a grammar pattern) — a few words, not a sentence. Use the tool.`;

const SEGMENT_TOOL = {
  name: 'give_breakdown',
  description: 'Return the word-by-word breakdown of the message.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pinyin: { type: 'string', description: 'Pinyin of the whole message with tone marks.' },
      english: { type: 'string', description: 'One natural English translation of the whole message.' },
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hanzi: { type: 'string' },
            pinyin: { type: 'string' },
            english: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['hanzi', 'pinyin', 'english'],
        },
      },
    },
    required: ['pinyin', 'english', 'chunks'],
  },
};

export interface TranslateOpts {
  client?: Pick<Anthropic, 'messages'>;
  sleep?: (ms: number) => Promise<void>;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function clip(text: string): string {
  const t = text.trim();
  return t.length > TRANSLATE_MAX_CHARS ? t.slice(0, TRANSLATE_MAX_CHARS) : t;
}

/** Output budget for the translation: an English sentence is short. */
export function translationBudget(text: string): number {
  return Math.min(4000, Math.max(400, 200 + text.length * 4));
}

/** Output budget for the breakdown: ~30 tokens per character covers chunk + pinyin + gloss + note. */
export function segmentationBudget(text: string): number {
  return Math.min(8000, Math.max(1500, 600 + text.length * 30));
}

/** The tool input as the translation. Throws (so it is retried) when empty. */
export function normalizeTranslation(input: unknown): string {
  const t = str((input as { translation?: unknown } | null)?.translation);
  if (!t) throw new Error('AI returned an empty translation');
  return t;
}

/**
 * The tool input as a SentenceBreakdown. English highlight indices are found by
 * the server (first occurrence after the previous chunk's, else anywhere, else
 * 0..0 = no highlight) — the model is never asked to count characters.
 */
export function normalizeSegmentation(input: unknown, text: string): SentenceBreakdown {
  const raw = (input ?? {}) as { pinyin?: unknown; english?: unknown; chunks?: unknown };
  const english = str(raw.english);
  const rawChunks = Array.isArray(raw.chunks) ? raw.chunks : [];
  const chunks: SentenceChunk[] = [];
  let cursor = 0;
  for (const c of rawChunks as Array<Record<string, unknown>>) {
    const hanzi = str(c?.hanzi);
    if (!hanzi) continue;
    const gloss = str(c.english);
    let start = -1;
    if (gloss && english) {
      start = english.indexOf(gloss, cursor);
      if (start < 0) start = english.indexOf(gloss);
    }
    const chunk: SentenceChunk = {
      hanzi,
      pinyin: str(c.pinyin),
      english: gloss,
      englishStart: start >= 0 ? start : 0,
      englishEnd: start >= 0 ? start + gloss.length : 0,
    };
    if (start >= 0) cursor = start + gloss.length;
    const note = str(c.note);
    if (note) chunk.note = note;
    chunks.push(chunk);
  }
  if (!english) throw new Error('AI returned no translation in the breakdown');
  if (chunks.length === 0) throw new Error('AI returned no chunks');
  return {
    originalInput: text,
    inputLanguage: 'chinese',
    hanzi: text,
    pinyin: str(raw.pinyin) || chunks.map((c) => c.pinyin).filter(Boolean).join(' '),
    english,
    chunks,
  };
}

/** The message in English — fast (one short structured reply on Haiku, Sonnet as the last try). */
export async function translateChineseText(apiKey: string, content: string, opts: TranslateOpts = {}): Promise<string> {
  const text = clip(content);
  if (!text) throw new StructuredCallError('Nothing to translate', false);
  return structuredCall({
    apiKey,
    model: TRANSLATE_MODEL,
    fallbackModel: TRANSLATE_FALLBACK_MODEL,
    system: TRANSLATE_SYSTEM,
    user: `Message:\n${text}`,
    tool: TRANSLATE_TOOL,
    maxTokens: translationBudget(text),
    attempts: 2,
    timeoutMs: 15_000,
    validate: normalizeTranslation,
    client: opts.client,
    sleep: opts.sleep,
  });
}

/** The word-by-word breakdown (budget scaled to the length; doubled by structuredCall when cut off). */
export async function segmentChineseText(apiKey: string, content: string, opts: TranslateOpts = {}): Promise<SentenceBreakdown> {
  const text = clip(content);
  if (!text) throw new StructuredCallError('Nothing to break down', false);
  return structuredCall({
    apiKey,
    model: TRANSLATE_MODEL,
    fallbackModel: null,
    system: SEGMENT_SYSTEM,
    user: `Message:\n${text}`,
    tool: SEGMENT_TOOL,
    maxTokens: segmentationBudget(text),
    attempts: 2,
    timeoutMs: 40_000,
    validate: (input) => normalizeSegmentation(input, text),
    client: opts.client,
    sleep: opts.sleep,
  });
}

export interface TranslatedAndSegmented {
  translation: string;
  segmentation: SentenceBreakdown;
  /** False when the breakdown failed and `segmentation` is the chunk-less stand-in (not to be stored). */
  segmented: boolean;
}

/** A breakdown with no chunks, for older clients that need the field when only the translation worked. */
export function placeholderSegmentation(text: string, translation: string): SentenceBreakdown {
  return { originalInput: text, inputLanguage: 'chinese', hanzi: text, pinyin: '', english: translation, chunks: [] };
}

/**
 * Translation + breakdown side by side. Either half may fail: the translation
 * falls back to the breakdown's English, the breakdown to a chunk-less stand-in
 * (`segmented: false`). Throws only when there is no translation at all.
 */
export async function translateAndSegment(
  apiKey: string,
  content: string,
  opts: TranslateOpts & { knownTranslation?: string | null } = {},
): Promise<TranslatedAndSegmented> {
  const text = clip(content);
  const [translated, segmented] = await Promise.allSettled([
    opts.knownTranslation ? Promise.resolve(opts.knownTranslation) : translateChineseText(apiKey, text, opts),
    segmentChineseText(apiKey, text, opts),
  ]);
  if (segmented.status === 'rejected') {
    console.warn('[translation] word-by-word breakdown failed:', segmented.reason instanceof Error ? segmented.reason.message : segmented.reason);
  }
  const translation =
    translated.status === 'fulfilled' ? translated.value : segmented.status === 'fulfilled' ? segmented.value.english : null;
  if (!translation) throw translated.status === 'rejected' ? translated.reason : new Error('No translation');
  if (segmented.status === 'fulfilled') return { translation, segmentation: segmented.value, segmented: true };
  return { translation, segmentation: placeholderSegmentation(text, translation), segmented: false };
}
