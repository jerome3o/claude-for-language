import Anthropic from '@anthropic-ai/sdk';
import { SentenceTranslation } from '../types';

const SENTENCE_TRANSLATE_SYSTEM_PROMPT = `You are a thoughtful Chinese language tutor. A learner gives you an English sentence and wants to know how to say it in Chinese — and to actually understand the translation, not just copy it.

Provide:
1. The best natural translation (the one you'd recommend they learn)
2. 1-3 alternative translations with different register, nuance, or structure — say when each is the better choice
3. A word-by-word breakdown of the recommended translation: each word/phrase, pinyin, meaning, grammatical role, notable usage
4. The key grammar patterns in the recommended translation, each explained with the general pattern spelled out
5. A short usage note: register, common contexts, pitfalls for English speakers

Rules:
- Pinyin ALWAYS uses tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ), NEVER tone numbers. Separate words with spaces, keep multi-syllable words together (e.g., "zhège").
- Use simplified characters.
- Explanations are in English, clear and practical.
- Word entries should cover the full recommended translation in order; particles get their own entries.

Respond ONLY with valid JSON, no other text.`;

const USER_PROMPT_TEMPLATE = `Translate this English sentence into Chinese and explain the translation:

"{input}"

Respond with JSON in this exact format:
{
  "originalInput": "{input}",
  "primary": {
    "hanzi": "recommended Chinese translation",
    "pinyin": "full pinyin with tone marks",
    "english": "the English sentence (natural back-translation if it differs)",
    "note": "one sentence on why this is the recommended phrasing"
  },
  "alternatives": [
    {
      "hanzi": "...",
      "pinyin": "...",
      "english": "...",
      "note": "when/why you'd use this version instead"
    }
  ],
  "words": [
    {
      "hanzi": "word or phrase from the recommended translation",
      "pinyin": "pinyin with tone marks",
      "english": "meaning in this sentence",
      "role": "grammatical role, e.g. subject / verb / aspect particle / measure word",
      "notes": "optional: usage notes, common confusions, literal meaning"
    }
  ],
  "grammar_points": [
    {
      "pattern": "the structure, e.g. 是...的 / Subj + 把 + Obj + Verb",
      "explanation": "clear explanation of how the pattern works and what it does here",
      "example": "optional short extra example: hanzi (pinyin) - english"
    }
  ],
  "usage_note": "register, context, pitfalls for English speakers"
}`;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

/**
 * Translate an English sentence into Chinese with alternatives and a full
 * explanation of the recommended translation. Retries up to 3 times on
 * transient Anthropic API errors.
 */
export async function translateSentence(
  apiKey: string,
  sentence: string
): Promise<SentenceTranslation> {
  const client = new Anthropic({ apiKey });

  const userPrompt = USER_PROMPT_TEMPLATE.replace(/\{input\}/g, sentence.trim());

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 3500,
        messages: [{ role: 'user', content: userPrompt }],
        system: SENTENCE_TRANSLATE_SYSTEM_PROMPT,
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in AI response');
      }

      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not find JSON in AI response');
      }

      const result = JSON.parse(jsonMatch[0]) as SentenceTranslation;

      if (!result.primary?.hanzi || !result.primary?.pinyin) {
        throw new Error('Invalid sentence translation structure from AI');
      }

      result.originalInput = sentence.trim();
      if (!result.primary.english) {
        result.primary.english = sentence.trim();
      }
      if (!Array.isArray(result.alternatives)) {
        result.alternatives = [];
      }
      result.alternatives = result.alternatives.filter((a) => a.hanzi && a.pinyin);
      if (!Array.isArray(result.words)) {
        result.words = [];
      }
      result.words = result.words.filter((w) => w.hanzi && w.pinyin && w.english);
      if (!Array.isArray(result.grammar_points)) {
        result.grammar_points = [];
      }

      return result;
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        break;
      }
    }
  }

  throw lastError;
}
