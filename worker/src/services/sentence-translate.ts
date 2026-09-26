import { structuredCall } from './structured-call';
import { SentenceTranslation } from '../types';

const SENTENCE_TRANSLATE_SYSTEM_PROMPT = `You are a thoughtful Chinese language tutor. A learner gives you an English sentence and wants to know how to say it in Chinese — and to actually understand the translation, not just copy it.

Provide — a FAST first reply the learner reads in ten seconds; the word-by-word breakdown, grammar and cards come from the follow-up chat:
1. The best natural translation (the one you'd recommend they learn), with one sentence on why
2. Up to 2 alternative translations with different register, nuance, or structure — say when each is the better choice
3. A short usage note (1–2 sentences): register, context, the main pitfall for English speakers

Rules:
- Pinyin ALWAYS uses tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ), NEVER tone numbers. Separate words with spaces, keep multi-syllable words together (e.g., "zhège").
- Use simplified characters.
- Explanations are in English, clear and practical. Be brief.

Answer with the translate_sentence tool.`;

const ALT_ITEM = {
  type: 'object',
  properties: {
    hanzi: { type: 'string' },
    pinyin: { type: 'string', description: 'Full pinyin with tone marks' },
    english: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['hanzi', 'pinyin', 'english'],
};

const TRANSLATE_TOOL = {
  name: 'translate_sentence',
  description: 'Return the recommended translation, up to two alternatives and a usage note.',
  input_schema: {
    type: 'object' as const,
    properties: {
      primary: { ...ALT_ITEM, description: 'Recommended translation; note = one sentence on why' },
      alternatives: { type: 'array', items: ALT_ITEM, description: "Up to 2; note = when/why you'd use it instead" },
      usage_note: { type: 'string', description: 'Register, context, the main pitfall for English speakers (1-2 sentences)' },
    },
    required: ['primary', 'alternatives'],
  },
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Shape-check and clean the tool input; throws (→ retried) when the essentials are missing. */
export function normalizeTranslation(raw: unknown, sentence: string): SentenceTranslation {
  const r = (raw ?? {}) as Record<string, any>;
  const alt = (a: any) => ({ hanzi: str(a?.hanzi), pinyin: str(a?.pinyin), english: str(a?.english), note: str(a?.note) || undefined });
  const primary = alt(r.primary);
  if (!primary.hanzi || !primary.pinyin) throw new Error('Invalid sentence translation structure from AI');
  if (!primary.english) primary.english = sentence.trim();
  return {
    originalInput: sentence.trim(),
    primary,
    alternatives: (Array.isArray(r.alternatives) ? r.alternatives : []).map(alt).filter((a: { hanzi: string; pinyin: string }) => a.hanzi && a.pinyin).slice(0, 3),
    words: [],
    grammar_points: [],
    usage_note: str(r.usage_note) || undefined,
  };
}

/**
 * Translate an English sentence into Chinese — the Sentence Coach's fast first
 * reply for English input. Reliability lives in structuredCall.
 */
export async function translateSentence(
  apiKey: string,
  sentence: string
): Promise<SentenceTranslation> {
  return structuredCall({
    apiKey,
    model: 'claude-sonnet-5',
    system: SENTENCE_TRANSLATE_SYSTEM_PROMPT,
    user: `Translate this English sentence into Chinese and explain the translation:\n\n${sentence.trim()}`,
    tool: TRANSLATE_TOOL,
    maxTokens: 2000,
    validate: (input) => normalizeTranslation(input, sentence),
  });
}
