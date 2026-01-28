import Anthropic from '@anthropic-ai/sdk';
import { SentenceBreakdown, SentenceChunk } from '../types';

const SENTENCE_ANALYSIS_SYSTEM_PROMPT = `You are an expert Chinese language teacher helping students understand how Chinese sentences are structured.

Your task is to analyze a sentence and break it down into aligned chunks that show the correspondence between:
1. Chinese characters (hanzi)
2. Pinyin with tone marks
3. English translation

CRITICAL RULES for creating chunks:
1. Chunks should be meaningful units - typically words or short phrases that form a grammatical unit
2. Each chunk's hanzi, pinyin, and english should correspond to each other
3. The english in each chunk should be the MEANING of that specific Chinese chunk (not necessarily word-for-word, but the semantic equivalent)
4. Grammar particles (了, 的, 吗, etc.) can be their own chunks with explanatory english
5. Keep chunks small enough to be useful for learning, but not so small they lose meaning
6. The concatenation of all chunk hanzi should equal the full hanzi
7. The concatenation of all chunk pinyin should equal the full pinyin (with spaces)

IMPORTANT - English indices:
- The "english" field in the main response should be a NATURAL English sentence
- Each chunk must include "englishStart" and "englishEnd" indices (0-based, end exclusive) pointing to the corresponding part of the full English sentence
- These indices allow highlighting within the natural English sentence
- The indices may be OUT OF ORDER because Chinese and English grammar differ (e.g., Chinese puts time before verb, English might put it after)
- The substring english.slice(englishStart, englishEnd) should match the chunk's english field

Pinyin rules:
- ALWAYS use tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ), NEVER tone numbers
- Separate words with spaces, but keep multi-syllable words together (e.g., "zhège" not "zhè ge")

For the "note" field in chunks, add brief grammar/usage notes when helpful (e.g., "measure word for flat objects", "past tense marker", "question particle").

Respond ONLY with valid JSON, no other text.`;

const USER_PROMPT_TEMPLATE = `Analyze this sentence and break it down into aligned chunks:

Input: "{input}"

Respond with JSON in this exact format:
{
  "originalInput": "{input}",
  "inputLanguage": "chinese" or "english",
  "hanzi": "full Chinese sentence",
  "pinyin": "full pinyin with tone marks",
  "english": "full natural English translation",
  "chunks": [
    {
      "hanzi": "Chinese for this chunk",
      "pinyin": "pinyin for this chunk",
      "english": "the exact substring from the full English that corresponds to this chunk",
      "englishStart": 0,
      "englishEnd": 5,
      "note": "optional grammar/usage note"
    }
  ],
  "grammarNotes": "optional overall grammar notes about the sentence structure"
}

Example for "我想买这个" with english "I want to buy this":
{
  "originalInput": "我想买这个",
  "inputLanguage": "chinese",
  "hanzi": "我想买这个",
  "pinyin": "wǒ xiǎng mǎi zhège",
  "english": "I want to buy this",
  "chunks": [
    { "hanzi": "我", "pinyin": "wǒ", "english": "I", "englishStart": 0, "englishEnd": 1 },
    { "hanzi": "想", "pinyin": "xiǎng", "english": "want to", "englishStart": 2, "englishEnd": 9, "note": "expresses desire/intention" },
    { "hanzi": "买", "pinyin": "mǎi", "english": "buy", "englishStart": 10, "englishEnd": 13 },
    { "hanzi": "这个", "pinyin": "zhège", "english": "this", "englishStart": 14, "englishEnd": 18, "note": "demonstrative pronoun + measure word" }
  ]
}

Note how englishStart/englishEnd point to exact positions in "I want to buy this" (length 18).`;

/**
 * Detect if the input is Chinese or English
 */
function detectLanguage(input: string): 'chinese' | 'english' {
  // Check for Chinese characters (CJK Unified Ideographs)
  const chineseRegex = /[\u4e00-\u9fff]/;
  return chineseRegex.test(input) ? 'chinese' : 'english';
}

/**
 * Analyze a sentence and break it down into aligned chunks
 */
export async function analyzeSentence(
  apiKey: string,
  sentence: string
): Promise<SentenceBreakdown> {
  const client = new Anthropic({ apiKey });

  const userPrompt = USER_PROMPT_TEMPLATE.replace(/\{input\}/g, sentence.trim());

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: SENTENCE_ANALYSIS_SYSTEM_PROMPT,
  });

  // Extract text from response
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  // Extract JSON from response
  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in AI response');
  }

  const result = JSON.parse(jsonMatch[0]) as SentenceBreakdown;

  // Validate the structure
  if (!result.hanzi || !result.pinyin || !result.english || !Array.isArray(result.chunks)) {
    throw new Error('Invalid sentence breakdown structure from AI');
  }

  // Validate chunks and ensure indices exist
  for (const chunk of result.chunks) {
    if (!chunk.hanzi || !chunk.pinyin || !chunk.english) {
      throw new Error('Invalid chunk structure from AI: each chunk must have hanzi, pinyin, and english');
    }
    // Ensure English indices are present (default to 0,0 if missing for backwards compatibility)
    if (typeof chunk.englishStart !== 'number') {
      chunk.englishStart = 0;
    }
    if (typeof chunk.englishEnd !== 'number') {
      chunk.englishEnd = chunk.english.length;
    }
  }

  // Ensure inputLanguage is set correctly
  if (!result.inputLanguage) {
    result.inputLanguage = detectLanguage(sentence);
  }

  return result;
}
