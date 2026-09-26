import Anthropic from '@anthropic-ai/sdk';
import { CARD_STANDARD, cardTextProblems } from '@shared/cards/standard';

/**
 * Write the explanation (fun_facts) and the card's example sentence for a
 * pasted word list, to the card standard. Used by the deck page's "Paste a
 * list" importer after pinyin / English are in place, so a tutor who pastes
 * bare words gets the same quality of card the MCP tools produce. Sonnet: the
 * explanation is the part worth thinking about. Anything the teacher already
 * supplied is kept as given; only blanks are filled.
 */

const MODEL = 'claude-sonnet-5';
export const MAX_ENRICH_WORDS = 30;

const SYSTEM_PROMPT = `You complete flashcards for a Chinese learner. For each word you get the simplified characters, pinyin and English, and sometimes an explanation (fun_facts) or an example sentence the teacher already wrote.

${CARD_STANDARD}

For every word return:
- fun_facts: the explanation exactly as the standard describes (plain text, 3–6 short lines, each line a separate line; no markdown, no bullets, no trivia).
- sentence_clue: one short natural sentence that contains the word EXACTLY as written, at the learner's level (HSK 1–3 vocabulary around it), with sentence_clue_pinyin (tone marks, spaces between words) and sentence_clue_translation (plain English).

Keep anything the teacher already supplied EXACTLY as given — return it unchanged rather than improving it. Only fill in what is missing. Return the list via the enrich_words tool, in the same order.`;

export interface EnrichInput {
  hanzi: string;
  pinyin?: string;
  english?: string;
  fun_facts?: string;
  sentence_clue?: string;
}

export interface EnrichOutput {
  hanzi: string;
  fun_facts: string;
  sentence_clue: string;
  sentence_clue_pinyin: string;
  sentence_clue_translation: string;
}

interface RawEnrichment {
  hanzi?: unknown;
  fun_facts?: unknown;
  sentence_clue?: unknown;
  sentence_clue_pinyin?: unknown;
  sentence_clue_translation?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Pure: merge what Claude returned onto the inputs. Matched by hanzi (not
 * position, so a dropped item cannot shift the rest); the teacher's own
 * text always wins; a sentence that breaks a HARD rule of the card standard
 * (a slash, brackets, an ellipsis, tone numbers) or does not contain the word
 * is dropped rather than saved. Exported for tests.
 */
export function mergeEnrichment(inputs: EnrichInput[], raw: RawEnrichment[]): EnrichOutput[] {
  const byHanzi = new Map<string, RawEnrichment>();
  for (const r of raw) {
    const h = str(r?.hanzi);
    if (h && !byHanzi.has(h)) byHanzi.set(h, r);
  }
  return inputs.map((w) => {
    const got = byHanzi.get(w.hanzi.trim());
    const fun_facts = str(w.fun_facts) || str(got?.fun_facts);
    let sentence_clue = str(w.sentence_clue);
    let sentence_clue_pinyin = '';
    let sentence_clue_translation = '';
    if (!sentence_clue) {
      const candidate = str(got?.sentence_clue);
      const ok =
        candidate &&
        candidate.includes(w.hanzi.trim()) &&
        cardTextProblems({ sentence_clue: candidate }).length === 0;
      if (ok) {
        sentence_clue = candidate;
        sentence_clue_pinyin = str(got?.sentence_clue_pinyin);
        sentence_clue_translation = str(got?.sentence_clue_translation);
      }
    }
    return { hanzi: w.hanzi, fun_facts, sentence_clue, sentence_clue_pinyin, sentence_clue_translation };
  });
}

function isRetryableError(error: unknown): boolean {
  return error instanceof Anthropic.APIError && (error.status === 429 || error.status === 503 || error.status === 529);
}

export async function enrichWords(apiKey: string, words: EnrichInput[]): Promise<EnrichOutput[]> {
  const client = new Anthropic({ apiKey });
  const inputs = words.slice(0, MAX_ENRICH_WORDS);
  const list = inputs
    .map((w, i) => {
      const bits = [`${i + 1}. ${w.hanzi}`];
      if (w.pinyin) bits.push(`pinyin: ${w.pinyin}`);
      if (w.english) bits.push(`english: ${w.english}`);
      if (w.fun_facts) bits.push(`fun_facts (keep): ${w.fun_facts.replace(/\n/g, ' / ')}`);
      if (w.sentence_clue) bits.push(`sentence_clue (keep): ${w.sentence_clue}`);
      return bits.join(' | ');
    })
    .join('\n');

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        // Sonnet 5 thinks by default; forced tool use needs it off (thinking shares max_tokens).
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'enrich_words',
            description: 'Return the completed cards in the same order as given.',
            input_schema: {
              type: 'object' as const,
              properties: {
                words: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      hanzi: { type: 'string' },
                      fun_facts: { type: 'string', description: 'The explanation, 3–6 short lines separated by newlines' },
                      sentence_clue: { type: 'string', description: 'One short sentence containing the word exactly' },
                      sentence_clue_pinyin: { type: 'string', description: 'Tone marks, spaces between words' },
                      sentence_clue_translation: { type: 'string' },
                    },
                    required: ['hanzi', 'fun_facts', 'sentence_clue', 'sentence_clue_pinyin', 'sentence_clue_translation'],
                  },
                },
              },
              required: ['words'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'enrich_words' },
        messages: [{ role: 'user', content: `Words:\n${list}` }],
      });
      const toolUse = response.content.find((c) => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No words in AI response');
      const raw = (toolUse.input as { words?: RawEnrichment[] }).words || [];
      return mergeEnrichment(inputs, Array.isArray(raw) ? raw : []);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI request failed');
}
