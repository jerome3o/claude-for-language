/**
 * AI for the graded-reader editor: the side-chat where Claude is a co-editor
 * of ONE reader. It sees the current spec and what the author changed since
 * its last message, and answers with text and/or a full revised spec via the
 * propose_reader_spec tool. Mirrors proposeLessonRevision (services/lesson-editor.ts).
 *
 * Every spec that comes back from the model goes through validateReaderSpec;
 * an invalid one is handed back as an error tool result for up to two repair
 * rounds, and only a valid spec is returned.
 */

import Anthropic from '@anthropic-ai/sdk';
import { READER_STANDARD_SHORT } from '@shared/reader/standard';
import { ReaderSpec, validateReaderSpec, READER_DIFFICULTIES } from '@shared/reader';

const MODEL = 'claude-sonnet-5';
const MAX_REPAIR_ROUNDS = 2;

/** JSON schema for the propose_reader_spec tool input. */
export const READER_SPEC_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title_chinese: { type: 'string', description: 'Story title in simplified Chinese' },
    title_english: { type: 'string', description: 'Story title in English' },
    difficulty_level: { type: 'string', enum: [...READER_DIFFICULTIES] },
    topic: { type: ['string', 'null'], description: 'Short topic label, or null' },
    vocabulary_used: {
      type: 'array',
      description: 'Key vocabulary the story uses (glossary). Keep the existing list; add words you introduce.',
      items: {
        type: 'object',
        properties: {
          hanzi: { type: 'string' },
          pinyin: { type: 'string', description: 'Tone-marked pinyin' },
          english: { type: 'string' },
        },
        required: ['hanzi', 'pinyin', 'english'],
      },
    },
    pages: {
      type: 'array',
      minItems: 1,
      description: 'Pages in reading order. Keep the "id" of every page you keep (even if you edit its text); omit id for new pages.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Existing page id — copy it exactly for pages that already exist' },
          content_chinese: { type: 'string', description: 'The page text in simplified Chinese' },
          content_pinyin: { type: 'string', description: 'Tone-marked pinyin for the whole page, words separated by spaces' },
          content_english: { type: 'string', description: 'Natural English translation of the page' },
          image_prompt: {
            type: ['string', 'null'],
            description: 'English scene description for a children\'s-book illustration of this page (no text in the image), or null for no picture',
          },
        },
        required: ['content_chinese', 'content_pinyin', 'content_english'],
      },
    },
  },
  required: ['title_chinese', 'title_english', 'difficulty_level', 'pages'],
} as const;

const COEDIT_SYSTEM = `You are a co-editor working alongside a teacher or learner on ONE graded reader (a short illustrated story for a Chinese learner) in a Chinese-learning app. The current reader spec is given below; the author edits it in a form next to this chat.

How to respond:
- Answer questions and give opinions in plain, brief prose.
- When the author asks for a change (simplify a page, add a page, use a word somewhere, fix pinyin, make it longer or shorter, change the ending…), make the change by calling propose_reader_spec with the COMPLETE revised spec — every page, not just the changed ones. The author sees your proposal as a diff and accepts or rejects it, so keep everything you weren't asked to change byte-for-byte identical, and keep each existing page's "id".
- Say in one or two sentences what you changed and why. Don't repeat the story in prose.
- Respect the author's own edits: "Changes the author made since your last message" tells you what they did; build on it, never revert it.
- If a request is ambiguous, propose your best reading rather than asking — the diff makes it cheap to reject.

Writing rules for graded readers:
- Stay at the reader's difficulty level. If the current text sticks to a small set of known words (the vocabulary list, HSK-1-ish grammar), stay inside it — introduce a new word only when asked, and add it to vocabulary_used.
- Simplified characters, mainland (普通话) vocabulary and usage.
- Tone-marked pinyin (nǐ hǎo), never tone numbers, one space between words; pinyin must match the Chinese exactly.
- ${READER_STANDARD_SHORT} When the author asks for more content, add pages rather than lengthening one.
- English should be a natural translation of the page, not word-for-word.
- Every page's image_prompt is an English scene description for a warm children's-book illustration, consistent characters across pages, no text in the picture. Update it when the page's content changes; null means no picture.

Reader spec shape (JSON):
{ title_chinese, title_english, difficulty_level (beginner|elementary|intermediate|advanced), topic?, vocabulary_used?: [{hanzi, pinyin, english}], pages: [{ id?, content_chinese, content_pinyin, content_english, image_prompt? }] }`;

export interface ReaderCoEditTurn {
  role: 'user' | 'assistant';
  content: string;
  proposalStatus?: 'pending' | 'accepted' | 'rejected' | null;
  hadProposal?: boolean;
}

export interface ProposeReaderRevisionInput {
  spec: ReaderSpec;
  /** Human-readable lines from formatReaderDiff; empty when nothing changed. */
  authorChanges: string[];
  history: ReaderCoEditTurn[];
  message: string;
}

export interface ProposeReaderRevisionResult {
  text: string;
  proposal: ReaderSpec | null;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

async function callWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
    try {
      return await client.messages.create(params);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Claude request failed');
}

function historyToMessages(history: ReaderCoEditTurn[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const turn of history) {
    let content = turn.content;
    if (turn.role === 'assistant' && turn.hadProposal) {
      const status = turn.proposalStatus === 'accepted'
        ? 'The author ACCEPTED that proposal.'
        : turn.proposalStatus === 'rejected'
          ? 'The author REJECTED that proposal.'
          : 'That proposal is still pending.';
      content = `${content}\n\n[You proposed a revised spec. ${status}]`;
    }
    if (!content.trim()) continue;
    out.push({ role: turn.role, content });
  }
  return out;
}

/** The spec sent to the model: server-filled image keys are noise. */
function specForModel(spec: ReaderSpec): ReaderSpec {
  return {
    ...spec,
    pages: spec.pages.map(({ image_url: _drop, ...rest }) => rest),
  };
}

export async function proposeReaderRevision(
  apiKey: string,
  input: ProposeReaderRevisionInput,
): Promise<ProposeReaderRevisionResult> {
  const client = new Anthropic({ apiKey });

  const contextBlock = [
    '<current_reader_spec>',
    JSON.stringify(specForModel(input.spec), null, 1),
    '</current_reader_spec>',
    '',
    '<changes_the_author_made_since_your_last_message>',
    input.authorChanges.length ? input.authorChanges.map(l => `- ${l}`).join('\n') : '(none)',
    '</changes_the_author_made_since_your_last_message>',
    '',
    input.message,
  ].join('\n');

  // Earlier turns are plain text (no stale specs); the current spec rides
  // with the newest message so the model always edits what's on screen.
  const messages: Anthropic.MessageParam[] = [
    ...historyToMessages(input.history),
    { role: 'user', content: contextBlock },
  ];

  let text = '';
  let lastErrors: string[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const response = await callWithRetry(client, {
      model: MODEL,
      max_tokens: 16000,
      system: COEDIT_SYSTEM,
      tools: [
        {
          name: 'propose_reader_spec',
          description: 'Propose the COMPLETE revised reader spec. The author reviews it as a diff and accepts or rejects it.',
          input_schema: {
            type: 'object',
            properties: { spec: READER_SPEC_INPUT_SCHEMA },
            required: ['spec'],
          } as Anthropic.Tool.InputSchema,
        },
      ],
      messages,
    });

    const textParts = response.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map(c => c.text.trim()).filter(Boolean);
    if (textParts.length) text = textParts.join('\n\n');

    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return { text: text || 'Done.', proposal: null };
    }

    const rawSpec = (toolUse.input as { spec?: unknown }).spec;
    const errors = validateReaderSpec(rawSpec);
    if (errors.length === 0) {
      return { text: text || 'Here is a proposed revision.', proposal: rawSpec as ReaderSpec };
    }
    lastErrors = errors;
    if (round === MAX_REPAIR_ROUNDS) break;

    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `The reader spec is not valid yet. Fix every problem below and call propose_reader_spec again with the COMPLETE corrected spec (not a patch):\n\n${errors.map(e => `- ${e}`).join('\n')}`,
        }],
      },
    );
  }

  return {
    text: `${text ? `${text}\n\n` : ''}I couldn't produce a valid revision (${lastErrors.slice(0, 3).join('; ')}). Try asking again or narrowing the change.`,
    proposal: null,
  };
}

/**
 * A proposal never carries image keys; carry the current spec's keys over for
 * pages whose id and illustration prompt are unchanged, so the diff card and
 * the editor thumbnails don't flicker. The server re-derives this on Save.
 */
export function mergeKeptReaderImages(current: ReaderSpec, proposal: ReaderSpec): ReaderSpec {
  const byId = new Map(current.pages.filter(p => p.id).map(p => [p.id as string, p]));
  return {
    ...proposal,
    pages: proposal.pages.map(page => {
      const existing = page.id ? byId.get(page.id) : undefined;
      if (existing && existing.image_url && (existing.image_prompt ?? '') === (page.image_prompt ?? '')) {
        return { ...page, image_url: existing.image_url };
      }
      const { image_url: _drop, ...rest } = page;
      return rest;
    }),
  };
}
