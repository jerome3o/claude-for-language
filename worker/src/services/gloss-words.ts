import Anthropic from '@anthropic-ai/sdk';

/**
 * Fill in the missing pinyin / English of a pasted word list in one call.
 * Used by the deck page's "Paste a list" importer when the tutor pasted only
 * the characters (or characters + pinyin). Haiku, one tool call, short
 * glosses — speed over depth; the tutor edits anything they disagree with in
 * the preview before saving.
 */

const MODEL = 'claude-haiku-4-5-20251001';
export const MAX_GLOSS_WORDS = 100;

const SYSTEM_PROMPT = `You complete a vocabulary list for a Chinese learner's flashcards.

For each word you get the simplified characters and sometimes pinyin or an English meaning that the teacher already supplied. Return every word with:
- pinyin: standard Hanyu Pinyin WITH TONE MARKS (nǐ hǎo, not ni3 hao3), syllables separated by spaces within a word only where the word has more than one character (e.g. "píng guǒ"). Use the reading that fits the most common meaning of the word as a vocabulary item (银行 → yín háng, not yín xíng).
- english: a short flashcard gloss — one to four words, the most common meaning first; add a second sense after a semicolon only when the word is genuinely ambiguous. Include the part of speech only when it disambiguates ("to open", "(measure word)").

Keep anything the teacher already supplied exactly as given — do not "improve" their pinyin or English. Only fill in what is missing. Return the list via the gloss_words tool, in the same order.`;

export interface GlossInput {
  hanzi: string;
  pinyin?: string;
  english?: string;
}

export interface GlossOutput {
  hanzi: string;
  pinyin: string;
  english: string;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof Anthropic.APIError && (error.status === 429 || error.status === 503 || error.status === 529);
}

export async function glossWords(apiKey: string, words: GlossInput[]): Promise<GlossOutput[]> {
  const client = new Anthropic({ apiKey });
  const list = words
    .slice(0, MAX_GLOSS_WORDS)
    .map((w, i) => `${i + 1}. ${w.hanzi}${w.pinyin ? ` | pinyin: ${w.pinyin}` : ''}${w.english ? ` | english: ${w.english}` : ''}`)
    .join('\n');

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'gloss_words',
            description: 'Return the completed word list in the same order as given.',
            input_schema: {
              type: 'object' as const,
              properties: {
                words: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      hanzi: { type: 'string' },
                      pinyin: { type: 'string', description: 'Tone marks, not numbers' },
                      english: { type: 'string', description: 'Short flashcard gloss' },
                    },
                    required: ['hanzi', 'pinyin', 'english'],
                  },
                },
              },
              required: ['words'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'gloss_words' },
        messages: [{ role: 'user', content: `Words:\n${list}` }],
      });
      const toolUse = response.content.find(c => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No words in AI response');
      const raw = (toolUse.input as { words?: Array<{ hanzi?: string; pinyin?: string; english?: string }> }).words || [];
      // Match by hanzi, not position, so a dropped or reordered item cannot
      // shift every gloss after it onto the wrong word.
      const byHanzi = new Map<string, { pinyin: string; english: string }>();
      for (const w of raw) {
        if (w && typeof w.hanzi === 'string') {
          byHanzi.set(w.hanzi.trim(), { pinyin: (w.pinyin || '').trim(), english: (w.english || '').trim() });
        }
      }
      return words.slice(0, MAX_GLOSS_WORDS).map(w => {
        const got = byHanzi.get(w.hanzi.trim());
        return {
          hanzi: w.hanzi,
          pinyin: w.pinyin?.trim() || got?.pinyin || '',
          english: w.english?.trim() || got?.english || '',
        };
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI request failed');
}
