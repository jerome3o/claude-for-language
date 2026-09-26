import Anthropic from '@anthropic-ai/sdk';
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

Respond ONLY with valid JSON, no other text.`;

const USER_PROMPT_TEMPLATE = `The learner wrote this sentence:

"{input}"

Respond with JSON in this exact format:
{
  "originalInput": "{input}",
  "inputLanguage": "chinese" or "english",
  "isCorrect": true or false,
  "corrected": {
    "hanzi": "corrected (or translated) Chinese sentence",
    "pinyin": "pinyin with tone marks",
    "english": "natural English translation"
  },
  "critique": "1-3 sentences: what changed and why (naming the words), what they did well",
  "alternatives": [
    {
      "hanzi": "alternative phrasing",
      "pinyin": "pinyin with tone marks",
      "english": "English meaning",
      "note": "when/why you'd use this version"
    }
  ]
}

Up to 2 alternatives; use [] when none is worth showing.`;

function detectLanguage(input: string): 'chinese' | 'english' {
  // Check for Chinese characters (CJK Unified Ideographs)
  const chineseRegex = /[\u4e00-\u9fff]/;
  return chineseRegex.test(input) ? 'chinese' : 'english';
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

/**
 * Correct and critique a learner-written sentence — the fast first reply of
 * the Sentence Coach (correction, short critique, up to two alternatives).
 * Cards, examples and breakdowns come from the follow-up chat's tools.
 * Retries up to 3 times on transient Anthropic API errors.
 */
export async function coachSentence(
  apiKey: string,
  sentence: string
): Promise<SentenceCoachResult> {
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
        max_tokens: 900,
        messages: [{ role: 'user', content: userPrompt }],
        system: SENTENCE_COACH_SYSTEM_PROMPT,
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in AI response');
      }

      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not find JSON in AI response');
      }

      const result = JSON.parse(jsonMatch[0]) as SentenceCoachResult;

      if (!result.corrected?.hanzi || !result.corrected?.pinyin || !result.corrected?.english) {
        throw new Error('Invalid sentence coach structure from AI');
      }

      result.originalInput = sentence.trim();
      if (!result.inputLanguage) {
        result.inputLanguage = detectLanguage(sentence);
      }
      if (typeof result.isCorrect !== 'boolean') {
        result.isCorrect = !result.issues || result.issues.length === 0;
      }
      if (!Array.isArray(result.issues)) {
        result.issues = [];
      }
      if (!Array.isArray(result.alternatives)) {
        result.alternatives = [];
      }
      if (!Array.isArray(result.vocabSuggestions)) {
        result.vocabSuggestions = [];
      }
      result.vocabSuggestions = result.vocabSuggestions.filter(
        (v) => v.hanzi && v.pinyin && v.english
      );

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
