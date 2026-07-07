import Anthropic from '@anthropic-ai/sdk';
import { SentenceExplanation } from '../types';

const SENTENCE_EXPLAIN_SYSTEM_PROMPT = `You are a patient, thorough Chinese language tutor. A learner gives you a Chinese sentence (occasionally English — treat that as "how would this be said in Chinese, and explain it").

Explain the sentence deeply so an intermediate learner truly understands it:
1. What it means and how the sentence works as a whole
2. Word by word: each word/phrase, its pinyin, meaning IN THIS SENTENCE, its grammatical role, and anything notable about its usage
3. The key grammar patterns/structures at play, each explained clearly with the general pattern spelled out
4. Nuance: register (formal/colloquial), tone, cultural context, common situations where you'd hear it
5. A couple of similar example sentences that reuse the same core structures

Rules:
- Pinyin ALWAYS uses tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ), NEVER tone numbers. Separate words with spaces, keep multi-syllable words together (e.g., "zhège").
- Explanations are in English, thorough but plainly written.
- Word entries should cover the full sentence in order; particles get their own entries.

Respond ONLY with valid JSON, no other text.`;

const USER_PROMPT_TEMPLATE = `Explain this sentence thoroughly:

"{input}"

Respond with JSON in this exact format:
{
  "originalInput": "{input}",
  "hanzi": "the Chinese sentence",
  "pinyin": "full pinyin with tone marks",
  "english": "natural English translation",
  "overview": "2-4 sentences: what it means and how the sentence is put together",
  "words": [
    {
      "hanzi": "word or phrase",
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
  "nuance": "register, tone, cultural notes, when you'd actually say this",
  "similar_examples": [
    { "hanzi": "...", "pinyin": "...", "english": "..." }
  ]
}`;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

/**
 * Thoroughly explain a Chinese sentence (meaning, word-by-word, grammar,
 * nuance). Retries up to 3 times on transient Anthropic API errors.
 */
export async function explainSentence(
  apiKey: string,
  sentence: string
): Promise<SentenceExplanation> {
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
        system: SENTENCE_EXPLAIN_SYSTEM_PROMPT,
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in AI response');
      }

      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not find JSON in AI response');
      }

      const result = JSON.parse(jsonMatch[0]) as SentenceExplanation;

      if (!result.hanzi || !result.pinyin || !result.english || !result.overview) {
        throw new Error('Invalid sentence explanation structure from AI');
      }

      result.originalInput = sentence.trim();
      if (!Array.isArray(result.words)) {
        result.words = [];
      }
      result.words = result.words.filter((w) => w.hanzi && w.pinyin && w.english);
      if (!Array.isArray(result.grammar_points)) {
        result.grammar_points = [];
      }
      if (!Array.isArray(result.similar_examples)) {
        result.similar_examples = [];
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
