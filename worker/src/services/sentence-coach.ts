import { structuredCall } from './structured-call';
import { SentenceCoachResult } from '../types';

const SENTENCE_COACH_SYSTEM_PROMPT = `You are an encouraging but rigorous Chinese language tutor. A learner gives you a sentence they wrote (usually in Chinese, occasionally in English asking how to say it in Chinese).

Your job — a FAST first reply the learner reads in ten seconds; everything deeper happens in the follow-up chat:
1. Correct the sentence so it is grammatical AND natural (what a native speaker would actually say)
2. Critique it in 1–3 sentences: what changed and why, naming the specific words; what they did well
3. Offer up to 2 alternative natural phrasings when genuinely useful (different register, more colloquial, more formal)

Rules:
- If the input is English, treat it as "how do I say this in Chinese?" — provide the Chinese translation as the corrected sentence, mark isCorrect true, and use the critique to explain the structure in a sentence or two.
- If the sentence is already correct and natural, say so warmly (isCorrect true) — do not invent problems.
- Keep the corrected sentence as close to the learner's original intent and wording as possible; do not rewrite their meaning.
- Pinyin ALWAYS uses tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ), NEVER tone numbers. Separate words with spaces, keep multi-syllable words together (e.g., "zhège").
- Critique and notes are in English, aimed at an intermediate learner. Be brief: no per-issue lists, no vocabulary lists, no word-by-word breakdown here.

Answer with the coach_sentence tool.`;

const COACH_TOOL = {
  name: 'coach_sentence',
  description: "Return the corrected sentence, a short critique and up to two alternatives.",
  input_schema: {
    type: 'object' as const,
    properties: {
      inputLanguage: { type: 'string', enum: ['chinese', 'english'] },
      isCorrect: { type: 'boolean', description: 'True when the sentence was already correct and natural' },
      corrected: {
        type: 'object',
        properties: {
          hanzi: { type: 'string', description: 'Corrected (or translated) Chinese sentence' },
          pinyin: { type: 'string', description: 'Tone marks, not numbers' },
          english: { type: 'string', description: 'Natural English translation' },
        },
        required: ['hanzi', 'pinyin', 'english'],
      },
      critique: { type: 'string', description: '1-3 sentences: what changed and why (naming the words), what they did well' },
      alternatives: {
        type: 'array',
        description: 'Up to 2; empty when none is worth showing',
        items: {
          type: 'object',
          properties: {
            hanzi: { type: 'string' },
            pinyin: { type: 'string' },
            english: { type: 'string' },
            note: { type: 'string', description: "When/why you'd use this version" },
          },
          required: ['hanzi', 'pinyin', 'english'],
        },
      },
    },
    required: ['isCorrect', 'corrected', 'critique', 'alternatives'],
  },
};

function detectLanguage(input: string): 'chinese' | 'english' {
  // Check for Chinese characters (CJK Unified Ideographs)
  return /[\u4e00-\u9fff]/.test(input) ? 'chinese' : 'english';
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Shape-check and clean the tool input; throws (→ retried) when the essentials are missing. */
export function normalizeCoachResult(raw: unknown, sentence: string): SentenceCoachResult {
  const r = (raw ?? {}) as Record<string, any>;
  const corrected = { hanzi: str(r.corrected?.hanzi), pinyin: str(r.corrected?.pinyin), english: str(r.corrected?.english) };
  if (!corrected.hanzi || !corrected.pinyin || !corrected.english) {
    throw new Error('Invalid sentence coach structure from AI');
  }
  const alternatives = (Array.isArray(r.alternatives) ? r.alternatives : [])
    .map((a: any) => ({ hanzi: str(a?.hanzi), pinyin: str(a?.pinyin), english: str(a?.english), note: str(a?.note) || undefined }))
    .filter((a: { hanzi: string; pinyin: string }) => a.hanzi && a.pinyin)
    .slice(0, 3);
  return {
    originalInput: sentence.trim(),
    inputLanguage: r.inputLanguage === 'english' || r.inputLanguage === 'chinese' ? r.inputLanguage : detectLanguage(sentence),
    isCorrect: typeof r.isCorrect === 'boolean' ? r.isCorrect : false,
    corrected,
    critique: str(r.critique),
    issues: [],
    alternatives,
    vocabSuggestions: [],
  };
}

/**
 * Correct and critique a learner-written sentence — the fast first reply of
 * the Sentence Coach (correction, short critique, up to two alternatives).
 * Cards, examples and breakdowns come from the follow-up chat's tools.
 * Reliability (retries, fallback model, token budget) lives in structuredCall.
 */
export async function coachSentence(
  apiKey: string,
  sentence: string
): Promise<SentenceCoachResult> {
  return structuredCall({
    apiKey,
    model: 'claude-sonnet-5',
    system: SENTENCE_COACH_SYSTEM_PROMPT,
    user: `The learner wrote this sentence:\n\n${sentence.trim()}`,
    tool: COACH_TOOL,
    maxTokens: 2000,
    validate: (input) => normalizeCoachResult(input, sentence),
  });
}
