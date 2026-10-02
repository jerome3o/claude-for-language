/**
 * Tab-complete on the call's text board: Chinese the typist just wrote →
 * { pinyin, english }, which the board offers as ` - pīnyīn - meaning` after
 * the caret (shared/calls/gloss.ts decides when and how it looks).
 *
 * It must be quick and cheap, and it is fine to have no answer: Haiku, one
 * forced tool call with thinking off, a small max_tokens, a 4 s timeout and a
 * single retry (only for a reply that fails validation — e.g. an empty one).
 * Results are cached per text in this isolate (a lesson repeats words), and
 * each user is rate-limited here too, so a stuck client can't run up a bill.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { cleanGloss, glossCacheKey, isHanChar, GLOSS_MAX_SEGMENT, type Gloss } from '@shared/calls';
import { structuredCall } from '../structured-call';
import { GLOSS_MODEL } from '../gloss-words';

export const BOARD_GLOSS_TIMEOUT_MS = 6_000;
/** A 40-character sentence's pinyin + its whole translation fit with room to spare (200 cut long ones off). */
export const BOARD_GLOSS_MAX_TOKENS = 500;
/** Requests per user per minute (a pause after typing Chinese → one request; 30/min is far above real use). */
export const BOARD_GLOSS_RATE_PER_MIN = 30;
const CACHE_SIZE = 2_000;

const SYSTEM = `You gloss Chinese that a tutor or student just typed on a shared lesson whiteboard.
Return the pinyin and a short English meaning of EXACTLY the text given, via the gloss tool.
- pinyin: standard Hanyu Pinyin with TONE MARKS (nǐ hǎo, never ni3 hao3), spaces between words not syllables (wǒ xiǎng hē kāfēi, zhège, xǐshǒujiān), no characters, no punctuation except what the Chinese has (，→ , 。→ nothing). Use the reading that fits this context.
- english: for a word or phrase, one short natural meaning (at most 8 words); for a sentence, its COMPLETE natural translation — never cut it short. No alternatives, no slashes, no explanation, no trailing full stop.
Both fields are ONE line: never a line break.`;

const TOOL = {
  name: 'gloss',
  description: 'The pinyin and short English meaning of the text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pinyin: { type: 'string', description: 'Tone marks, words spaced, one line' },
      english: { type: 'string', description: 'A word / phrase: at most 8 words. A sentence: its whole translation. One line.' },
    },
    required: ['pinyin', 'english'],
  },
};

/** What the board may send: 1–GLOSS_MAX_SEGMENT (+ slack) characters with at least one Chinese character. */
export function validBoardGlossText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = glossCacheKey(text);
  const chars = Array.from(t);
  if (chars.length === 0 || chars.length > GLOSS_MAX_SEGMENT + 10 || /[\r\n]/.test(t)) return null;
  if (!chars.some(isHanChar)) return null;
  return t;
}

// ---------- caches (per isolate; a miss only costs one Haiku call)

const cache = new Map<string, Gloss>();

export function cachedGloss(text: string): Gloss | null {
  const hit = cache.get(text);
  if (!hit) return null;
  cache.delete(text);
  cache.set(text, hit); // most recently used last
  return hit;
}

export function rememberGloss(text: string, gloss: Gloss): void {
  cache.set(text, gloss);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

const hits = new Map<string, number[]>();

/** Sliding one-minute window per user; true = allowed (and counted). */
export function takeGlossToken(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= BOARD_GLOSS_RATE_PER_MIN) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5_000) hits.delete(hits.keys().next().value as string);
  return true;
}

/** Test seam. */
export function resetBoardGlossState(): void {
  cache.clear();
  hits.clear();
}

export async function glossBoardText(apiKey: string, text: string, client?: Pick<Anthropic, 'messages'>): Promise<Gloss> {
  return structuredCall<Gloss>({
    apiKey,
    model: GLOSS_MODEL,
    fallbackModel: null,
    attempts: 2,
    timeoutMs: BOARD_GLOSS_TIMEOUT_MS,
    system: SYSTEM,
    user: text,
    tool: TOOL,
    maxTokens: BOARD_GLOSS_MAX_TOKENS,
    client,
    sleep: async () => {},
    validate: (input) => {
      const g = cleanGloss(input);
      if (!g) throw new Error('Unusable gloss');
      return g;
    },
  });
}
