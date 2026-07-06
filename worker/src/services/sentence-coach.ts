import Anthropic from '@anthropic-ai/sdk';
import { SentenceCoachResult } from '../types';

const SENTENCE_COACH_SYSTEM_PROMPT = `You are an encouraging but rigorous Chinese language tutor. A learner gives you a sentence they wrote (usually in Chinese, occasionally in English asking how to say it in Chinese).

Your job:
1. Correct the sentence so it is grammatical AND natural (what a native speaker would actually say)
2. Critique it: explain each issue clearly and briefly, referencing the specific words involved
3. Offer 1-3 alternative natural phrasings when useful (different register, more colloquial, more formal)
4. Suggest vocabulary worth studying: words from the corrected sentence (or that fix the learner's mistakes) that the learner may want to add to their flashcard deck

Rules:
- If the input is English, treat it as "how do I say this in Chinese?" — provide the Chinese translation as the corrected sentence, mark isCorrect true, and use the critique to explain the structure.
- If the sentence is already correct and natural, say so warmly (isCorrect true, empty issues array) — do not invent problems. Still offer alternatives/vocab if genuinely useful.
- Keep the corrected sentence as close to the learner's original intent and wording as possible; do not rewrite their meaning.
- Pinyin ALWAYS uses tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ), NEVER tone numbers. Separate words with spaces, keep multi-syllable words together (e.g., "zhège").
- Vocabulary suggestions: 2-5 items, each a single word or short set phrase (not the whole sentence).
- Critique and explanations are in English, aimed at an intermediate learner.

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
  "critique": "1-3 sentence overall assessment: what they did well, what to focus on",
  "issues": [
    {
      "type": "grammar" | "word_choice" | "word_order" | "naturalness" | "typo",
      "original": "the problematic part of the learner's sentence",
      "suggestion": "what it should be",
      "explanation": "why, in one or two sentences"
    }
  ],
  "alternatives": [
    {
      "hanzi": "alternative phrasing",
      "pinyin": "pinyin with tone marks",
      "english": "English meaning",
      "note": "when/why you'd use this version"
    }
  ],
  "vocabSuggestions": [
    {
      "hanzi": "word or short phrase",
      "pinyin": "pinyin with tone marks",
      "english": "concise English meaning",
      "reason": "why this word is worth studying, given their sentence"
    }
  ]
}`;

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
 * Correct and critique a learner-written sentence, with vocab suggestions.
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
        max_tokens: 2500,
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
