/**
 * AI for the lesson editor and library:
 *
 * - generateLessonSpec: draft a whole lesson from a prompt (the library's
 *   "Describe it and let Claude draft it" path)
 * - proposeLessonRevision: the editor's side-chat — Claude is a co-editor of
 *   ONE lesson, sees the current spec and what the author changed since its
 *   last message, and answers with text and/or a full revised spec via the
 *   propose_lesson_spec tool
 *
 * Every spec that comes back from the model goes through validateLessonSpec;
 * an invalid one is handed back as an error tool result for up to two repair
 * rounds (same shape as quest generation), and only a valid spec is returned.
 */

import Anthropic from '@anthropic-ai/sdk';
import { CustomLessonSpec, validateLessonSpec } from '@shared/lesson';
import { LESSON_SPEC_INPUT_SCHEMA } from './custom-lesson';
export { mergeKeptImages } from './custom-lesson';

const MODEL = 'claude-sonnet-5';
const MAX_REPAIR_ROUNDS = 2;

const EXERCISE_RULES: string = (
  LESSON_SPEC_INPUT_SCHEMA.properties.sections.items.properties.exercises as { description: string }
).description;

const STYLE_RULES = `Language rules:
- Always use tone-marked pinyin (nǐ hǎo), never tone numbers.
- Use mainland-China (普通话, simplified characters) vocabulary and usage.
- Chinese text goes in "hanzi", pinyin in "pinyin", English in "english" — never mix scripts in one field.
- Keep exercises short and concrete; the learner studies on a phone.
- Scramble tiles must be exactly a permutation of correct_order (same multiset). Split the sentence into meaningful chunks (words/phrases), 3-8 tiles.
- Choice/listen_choice: 2-5 options, "correct" is a 0-based index into options.
- Match: 2-8 pairs, no duplicate hanzi or english.
- listen_translate audio needs "english" (the answer to check against).
- describe_image: image_prompt is a detailed English scene description with no text in the image.`;

const SPEC_SCHEMA_TEXT = `Lesson spec shape (JSON):
{ title, icon? (one emoji), description?, sections: [ { title?, exercises: [ ... ] } ] }
Exercise types and fields:
${EXERCISE_RULES}`;

// ============ Shared helpers ============

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

function repairMessage(errors: string[], toolName: string): string {
  return `The lesson spec is not valid yet. Fix every problem below and call ${toolName} again with the COMPLETE corrected spec (not a patch):\n\n${errors
    .map(e => `- ${e}`)
    .join('\n')}`;
}

// ============ Generate a lesson from a prompt ============

const GENERATE_SYSTEM = `You write short custom mini lessons for a Chinese-learning app. A lesson is sections of exercises in any order (teaching notes, word order, multiple choice, translation, matching, picture description, speaking, listening). Aim for 1-3 sections and 5-10 exercises: open with a note that teaches the point with 2-3 example sentences, then practise it in several exercise types, and end with a production exercise (translate or speak). Return the whole lesson with the create_lesson_spec tool.

${STYLE_RULES}

${SPEC_SCHEMA_TEXT}`;

export interface GenerateLessonContext {
  /** e.g. "Tutor of a beginner (HSK 1-2) student" */
  learner?: string;
  /** Words the lesson should draw on, if any */
  vocabulary?: string[];
}

export async function generateLessonSpec(
  apiKey: string,
  prompt: string,
  context: GenerateLessonContext = {},
): Promise<CustomLessonSpec> {
  const client = new Anthropic({ apiKey });
  const contextLines: string[] = [];
  if (context.learner) contextLines.push(`Learner: ${context.learner}`);
  if (context.vocabulary?.length) contextLines.push(`Vocabulary to use where natural: ${context.vocabulary.join(', ')}`);

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Write a mini lesson.\n\nRequest: ${prompt}${contextLines.length ? `\n\n${contextLines.join('\n')}` : ''}`,
    },
  ];

  let lastErrors: string[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const response = await callWithRetry(client, {
      model: MODEL,
      max_tokens: 16000,
      // Forced tool use rules out extended thinking; the schema is the answer.
      thinking: { type: 'disabled' },
      system: GENERATE_SYSTEM,
      tools: [
        {
          name: 'create_lesson_spec',
          description: 'Return the complete lesson spec.',
          input_schema: LESSON_SPEC_INPUT_SCHEMA as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'create_lesson_spec' },
      messages,
    });

    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('No lesson in AI response');

    const errors = validateLessonSpec(toolUse.input);
    if (errors.length === 0) return toolUse.input as CustomLessonSpec;
    lastErrors = errors;
    if (round === MAX_REPAIR_ROUNDS) break;

    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: repairMessage(errors, 'create_lesson_spec') }],
      },
    );
  }
  throw new Error(`Could not produce a valid lesson: ${lastErrors.slice(0, 4).join('; ')}`);
}

// ============ Co-editor chat ============

const COEDIT_SYSTEM = `You are a co-editor working alongside a teacher or learner on ONE custom mini lesson in a Chinese-learning app. The current lesson spec is given below; the author edits it in a form next to this chat.

How to respond:
- Answer questions and give opinions in plain, brief prose.
- When the author asks for a change (add / remove / rewrite / reorder exercises, make it easier or harder, add pinyin, fix a mistake…), make the change by calling propose_lesson_spec with the COMPLETE revised spec — every section and exercise, not just the changed parts. The author sees your proposal as a diff and accepts or rejects it, so keep everything you weren't asked to change byte-for-byte identical.
- Say in one or two sentences what you changed and why. Don't repeat the whole lesson in prose.
- Respect the author's own edits: "Changes the author made since your last message" tells you what they did; build on it, never revert it.
- If a request is ambiguous, propose your best reading rather than asking — the diff makes it cheap to reject.

${STYLE_RULES}

${SPEC_SCHEMA_TEXT}`;

export interface CoEditTurn {
  role: 'user' | 'assistant';
  content: string;
  /** For assistant turns: what happened to the proposal, if there was one. */
  proposalStatus?: 'pending' | 'accepted' | 'rejected' | null;
  hadProposal?: boolean;
}

export interface ProposeRevisionInput {
  spec: CustomLessonSpec;
  /** Human-readable lines from formatLessonDiff; empty when nothing changed. */
  authorChanges: string[];
  history: CoEditTurn[];
  message: string;
}

export interface ProposeRevisionResult {
  text: string;
  proposal: CustomLessonSpec | null;
}

function historyToMessages(history: CoEditTurn[]): Anthropic.MessageParam[] {
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

export async function proposeLessonRevision(
  apiKey: string,
  input: ProposeRevisionInput,
): Promise<ProposeRevisionResult> {
  const client = new Anthropic({ apiKey });

  const contextBlock = [
    '<current_lesson_spec>',
    JSON.stringify(input.spec, null, 1),
    '</current_lesson_spec>',
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
          name: 'propose_lesson_spec',
          description: 'Propose the COMPLETE revised lesson spec. The author reviews it as a diff and accepts or rejects it.',
          input_schema: {
            type: 'object',
            properties: { spec: LESSON_SPEC_INPUT_SCHEMA },
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
    const errors = validateLessonSpec(rawSpec);
    if (errors.length === 0) {
      return { text: text || 'Here is a proposed revision.', proposal: rawSpec as CustomLessonSpec };
    }
    lastErrors = errors;
    if (round === MAX_REPAIR_ROUNDS) break;

    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: repairMessage(errors, 'propose_lesson_spec') }],
      },
    );
  }

  return {
    text: `${text ? `${text}\n\n` : ''}I couldn't produce a valid revision (${lastErrors.slice(0, 3).join('; ')}). Try asking again or narrowing the change.`,
    proposal: null,
  };
}
