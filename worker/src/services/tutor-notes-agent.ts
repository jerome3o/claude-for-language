/**
 * Session-notes agent.
 *
 * A tutor pastes the raw notes from a lesson on the student's page. Instead of
 * turning them into cards in one shot, a Claude agent works through them with
 * tools on the tutor-notes-queue: it looks up which words the student already
 * has and what they struggle with, creates a deck of standard cards in the
 * tutor's account, writes a mini lesson ONLY when the notes show a structure
 * the tutor actually taught (example sentences around one pattern), writes a
 * graded reader only when the notes call for a story, and finally shares /
 * assigns everything to the student.
 *
 * Reliability model:
 * - The whole transcript is checkpointed in `tutor_note_jobs.transcript`
 *   after every model turn and after every batch of tool results, so a job
 *   resumes exactly where it stopped if the consumer is torn down or the
 *   message is redelivered.
 * - Every create tool is idempotent per job (one deck, one reader, lessons by
 *   title, cards by hanzi within the deck), so re-running a tool after a
 *   crash never duplicates content.
 * - A delivery that runs long re-enqueues the same job and returns, keeping
 *   each queue delivery well inside the consumer's wall-clock limits.
 * - Rounds are capped; the model must end with the `finish` tool, and a
 *   plain-text ending is treated as the summary.
 *
 * Pure helpers (briefing text, step lines, card input mapping) are exported
 * for unit tests; nothing here talks to the network except `callModel`.
 */

import Anthropic from '@anthropic-ai/sdk';
import { CARD_STANDARD } from '@shared/cards/standard';
import { validateLessonSpec, type CustomLessonSpec } from '@shared/lesson';
import { validateReaderSpec, normalizeReaderSpec, readerPageWarnings, type ReaderSpec } from '@shared/reader';
import { READER_STANDARD } from '@shared/reader/standard';
import type { Env } from '../types';
import * as content from './content';
import { shareDeck } from './conversations';
import { shareReader } from './shared-readers';
import { queueLessonImages, LESSON_SPEC_INPUT_SCHEMA } from './custom-lesson';
import { LESSON_STYLE_RULES, LESSON_SPEC_SCHEMA_TEXT } from './lesson-editor';
import { READER_SPEC_INPUT_SCHEMA } from './reader-editor';
import { createReaderFromSpec } from '../db/reader-editor-queries';
import * as lib from '../db/lesson-library-queries';
import * as iq from '../db/insights-queries';
import { rankStruggling, pickGoingWell } from './insights';
import * as jobs from '../db/tutor-notes-queries';
import type { TutorNotesJob, TutorNotesResult, TutorNotesStep, StudentWordMatch } from '../db/tutor-notes-queries';

export const TUTOR_NOTES_MODEL = 'claude-opus-4-6';
/** Hard cap on model turns per job. A normal job takes 6–12. */
export const MAX_ROUNDS = 30;
/** After this much wall clock in one delivery the job re-enqueues itself. */
const SOFT_DEADLINE_MS = 3.5 * 60 * 1000;
/** Notes longer than this are cut (with a marker) before they reach the model. */
export const MAX_NOTES_CHARS = 60_000;
const MAX_TOKENS = 16_000;

// ============ Prompt ============

const FLASHCARD_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    hanzi: { type: 'string', description: 'Simplified characters — ONE clean form, no slashes, parentheses, brackets, ellipses or blanks.' },
    pinyin: { type: 'string', description: 'Tone-marked pinyin (nǐ hǎo), spaces between words.' },
    english: { type: 'string', description: 'ONE clear meaning. Other senses go in fun_facts after "Also:".' },
    fun_facts: { type: 'string', description: 'The explanation, 3–6 short lines: each character / each word glossed, then usage, common mistake, contrast, register. Never trivia.' },
    sentence_clue: { type: 'string', description: 'For a word or short phrase: one short natural sentence containing the word exactly as written. Prefer the tutor\'s own example from the notes. Omit when hanzi is already a sentence.' },
    sentence_clue_pinyin: { type: 'string' },
    sentence_clue_translation: { type: 'string' },
    alternatives: { type: 'string', description: 'Other accepted typed answers, comma-separated (optional).' },
  },
  required: ['hanzi', 'pinyin', 'english', 'fun_facts'],
} as const;

export const SYSTEM_PROMPT = `You are the homework assistant inside a Chinese-learning app used by a tutor and their student. The tutor has just pasted their raw notes from a lesson. Your job is to turn those notes into study material for THIS student, using tools, and then stop.

What to produce
1. ALWAYS a deck of flashcards (unless the notes contain nothing to learn — then say so with finish).
   - Cards are for the words, phrases and short sentences the tutor actually taught or corrected in this lesson. Do not pad with related vocabulary the tutor did not cover.
   - Before adding cards, call check_student_words with every candidate hanzi. Skip words the student already has in review (state review, interval_days ≥ 7) unless the notes show they got them wrong. Words the student has as "new" or "learning" may be skipped too — mention them in the finish summary instead of duplicating.
   - Make one card per word; a full example sentence may be its own card when the sentence itself was the point (a set phrase, a corrected sentence).
   - Prefer the tutor's own example sentences from the notes as sentence_clue. Fix obvious typos in the notes silently.
   - Every card follows the card standard below. The server rejects a card that breaks a HARD rule; add_cards returns those with the reason — fix and resend only the rejected ones.
   - Aim for the number of words the lesson actually contained, typically 8–25. Send them in batches of at most 15 per add_cards call.
2. A MINI LESSON only when the notes clearly show the tutor teaching a specific grammatical structure or pattern: several example sentences sharing one construction (把, 是…的, 越…越…, 了 vs 过, comparisons with 比, resultative complements, measure words, a sentence pattern…), or an explicit explanation of a grammar point. Vocabulary lists, corrections of unrelated sentences, or a single example are NOT enough — make no lesson then. When you do make one, it is about THAT structure specifically: open with a note exercise that explains it using the tutor's own examples, then practise it (scramble, choice, translate, listen_choice…), end with production (translate or speak). One lesson per structure; two at most per job.
3. A GRADED READER only when the notes ask for a story, contain a dialogue or narrative the tutor wants practised, or the tutor's notes explicitly mention reading practice. Otherwise none. A reader reuses the lesson's words and stays at the student's level.

How to work
- Start from the student briefing and the notes. Use check_student_words liberally (it is cheap) and search_student_cards / list_student_deck_words when you need to see how a word was taught before. get_student_struggles gives more detail on what the student finds hard — a word the student keeps failing deserves a fresh card with a better explanation.
- Create the deck first (create_deck), then add cards, then the lesson / reader if warranted, then call finish. finish is REQUIRED: its summary is what the tutor reads. Say what you made, what you skipped and why (already known, not in the notes, no clear structure for a lesson), and anything the tutor should check.
- Name the deck after the lesson content and date, e.g. "Restaurant ordering — 14 Sep" or the tutor's own title when they gave one. Simplified Chinese, mainland usage, tone-marked pinyin everywhere.
- Never invent facts about the student. Never write to anything but the tools given. Do not ask questions — the tutor is not in this conversation; make the best call and note it in the summary.

${CARD_STANDARD}

Mini lesson rules (only when warranted, see above)
${LESSON_STYLE_RULES}
${LESSON_SPEC_SCHEMA_TEXT}

Graded reader rules (only when warranted)
${READER_STANDARD}
Reader spec shape (JSON): { title_chinese, title_english, difficulty_level (beginner|elementary|intermediate|advanced), topic?, vocabulary_used?: [{hanzi, pinyin, english}], pages: [{ content_chinese, content_pinyin, content_english, image_prompt? }] }`;

// ============ Tools ============

type ToolSchema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

const TOOLS: Array<{ name: string; description: string; input_schema: ToolSchema }> = [
  {
    name: 'check_student_words',
    description:
      'Which of these words the student already has a card for, with the card state (new / learning / review / relearning), reps, lapses and the longest current interval in days, plus the deck it lives in. Call it with every candidate word before adding cards. Exact hanzi match.',
    input_schema: {
      type: 'object',
      properties: { hanzi: { type: 'array', items: { type: 'string' }, description: 'Up to 60 words or phrases (simplified).' } },
      required: ['hanzi'],
    },
  },
  {
    name: 'search_student_cards',
    description: 'Free-text search of the student\'s cards (hanzi, pinyin, english or example sentence contains the query). Use it for near-matches: a synonym, a different form, a phrase containing the word.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
      required: ['query'],
    },
  },
  {
    name: 'list_student_deck_words',
    description: 'Every word in one of the student\'s decks (deck ids are in the briefing), with card states. Use it to see what an earlier homework packet already covered.',
    input_schema: { type: 'object', properties: { deck_id: { type: 'string' } }, required: ['deck_id'] },
  },
  {
    name: 'get_student_struggles',
    description: 'What the student is getting wrong and what is going well over the last N days (default 30): ranked struggling words with the wrong answers they typed, and words going well.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 180 } } },
  },
  {
    name: 'create_deck',
    description: 'Create the deck for this lesson in the tutor\'s account (it is shared to the student at the end). One deck per job — calling it again returns the same deck.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Short, specific: what the lesson covered + the date.' }, description: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'add_cards',
    description:
      'Add cards to the deck (at most 15 per call). Each card is validated against the card standard; rejected cards come back with the reason so you can fix and resend just those. Words already in the deck are skipped.',
    input_schema: {
      type: 'object',
      properties: {
        deck_id: { type: 'string' },
        cards: { type: 'array', maxItems: 15, items: FLASHCARD_ITEM_SCHEMA },
      },
      required: ['deck_id', 'cards'],
    },
  },
  {
    name: 'create_mini_lesson',
    description:
      'Create a mini lesson about ONE grammatical structure the tutor taught in this session (see the rules). Saved to the tutor\'s lesson library and assigned to the student at the end. Validation problems come back as a list — fix and call again with the COMPLETE spec. A lesson with the same title as one already made in this job is returned, not duplicated.',
    input_schema: {
      type: 'object',
      properties: { spec: LESSON_SPEC_INPUT_SCHEMA as unknown as Record<string, unknown> },
      required: ['spec'],
    },
  },
  {
    name: 'create_reader',
    description:
      'Create a short graded reader (illustrated story) for this lesson, only when the notes call for one. Saved in the tutor\'s account and shared to the student at the end. Validation problems come back as a list. One reader per job.',
    input_schema: {
      type: 'object',
      properties: { spec: READER_SPEC_INPUT_SCHEMA as unknown as Record<string, unknown> },
      required: ['spec'],
    },
  },
  {
    name: 'finish',
    description: 'End the job. REQUIRED as the last call. The summary is shown to the tutor.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '3–8 plain sentences for the tutor: what was made (deck name + card count, lesson title, reader title), what was skipped and why, anything to check.' },
        skipped: { type: 'array', items: { type: 'string' }, description: 'Words from the notes deliberately left out, each with the reason in a few words ("已经 — already in review").' },
      },
      required: ['summary'],
    },
  },
];

// ============ Pure helpers (unit-tested) ============

export interface BriefingInput {
  studentName: string | null;
  studentBio: string | null;
  tutorName: string | null;
  decks: jobs.StudentDeckSummary[];
  struggling: Array<{ hanzi: string; english: string; again_count: number; attempts: number; wrong_answers: string[] }>;
  goingWell: Array<{ hanzi: string; english: string }>;
  lessonLog: Array<{ lesson_at: string; notes: string | null }>;
  earlierJobs: Array<{ created_at: string; title: string | null; result: TutorNotesResult }>;
  job: Pick<TutorNotesJob, 'title' | 'notes' | 'lesson_at' | 'priority' | 'auto_share'> & { source_call_id?: string | null };
}

/** The first user message: everything the agent should know before it starts, then the notes verbatim. */
export function buildBriefing(input: BriefingInput): string {
  const lines: string[] = [];
  lines.push(`# Student briefing`);
  lines.push(`Student: ${input.studentName ?? 'unknown'}${input.studentBio ? ` — ${oneLine(input.studentBio, 300)}` : ''}`);
  lines.push(`Tutor: ${input.tutorName ?? 'unknown'}`);
  const totalNotes = input.decks.reduce((s, d) => s + d.note_count, 0);
  lines.push(`Cards: ${totalNotes} words in ${input.decks.length} deck${input.decks.length === 1 ? '' : 's'}.`);
  if (input.decks.length > 0) {
    lines.push(`Decks (queue order; id · name · words · started · mastered):`);
    for (const d of input.decks.slice(0, 25)) {
      lines.push(`- ${d.id} · ${d.name}${d.from_tutor ? ' (homework from tutor)' : ''} · ${d.note_count} words · ${d.started} started · ${d.mastered} mastered`);
    }
    if (input.decks.length > 25) lines.push(`- … and ${input.decks.length - 25} more`);
  }
  if (input.struggling.length > 0) {
    lines.push(`Struggling lately (word · english · again/attempts · wrong answers typed):`);
    for (const s of input.struggling.slice(0, 15)) {
      lines.push(`- ${s.hanzi} · ${s.english} · ${s.again_count}/${s.attempts}${s.wrong_answers.length ? ` · typed: ${s.wrong_answers.slice(0, 3).join(', ')}` : ''}`);
    }
  } else {
    lines.push(`Struggling lately: no review data in the last 30 days.`);
  }
  if (input.goingWell.length > 0) {
    lines.push(`Going well: ${input.goingWell.slice(0, 10).map(g => `${g.hanzi} (${g.english})`).join(', ')}`);
  }
  if (input.lessonLog.length > 0) {
    lines.push(`Earlier logged lessons:`);
    for (const e of input.lessonLog.slice(0, 3)) {
      lines.push(`- ${e.lesson_at.slice(0, 10)}${e.notes ? `: ${oneLine(e.notes, 240)}` : ''}`);
    }
  }
  if (input.earlierJobs.length > 0) {
    lines.push(`Earlier session-notes jobs (so you do not repeat their material):`);
    for (const j of input.earlierJobs.slice(0, 3)) {
      const deck = j.result.deck ? `deck "${j.result.deck.name}" (${j.result.deck.note_count} cards)` : 'no deck';
      const lessons = j.result.lessons?.length ? `, lessons: ${j.result.lessons.map(l => l.title).join('; ')}` : '';
      lines.push(`- ${j.created_at.slice(0, 10)}${j.title ? ` "${j.title}"` : ''}: ${deck}${lessons}`);
    }
  }
  lines.push('');
  lines.push(`# This session`);
  if (input.job.title) lines.push(`Tutor's title: ${input.job.title}`);
  if (input.job.lesson_at) lines.push(`Lesson date: ${input.job.lesson_at.slice(0, 10)}`);
  lines.push(`Delivery: ${input.job.auto_share ? `the deck goes to the ${input.job.priority === 'core' ? 'top' : 'bottom'} of the student's study queue when you finish` : 'the tutor will send the deck themselves after reviewing it'}.`);
  lines.push('');
  if (input.job.source_call_id) {
    lines.push(`# Session notes (the recorded video lesson)`);
    lines.push(`These notes are the automatic transcript of a recorded video lesson (each speaker's own microphone, so the speaker labels are reliable; the words come from speech recognition and may contain errors, especially in mixed Chinese and English — silently correct obvious mishearings, never invent what was not said), plus anything written on the whiteboard, the in-call chat and, when present, the lesson report. Cards are for what the TUTOR taught or corrected; the learner's own mistakes are what the corrections and explanations should address.`);
  } else {
    lines.push(`# Session notes (verbatim from the tutor)`);
  }
  lines.push(clipNotes(input.job.notes));
  lines.push('');
  lines.push(`Work through the notes now: check the words, create the deck, add the cards, decide about a lesson and a reader, then call finish.`);
  return lines.join('\n');
}

export function clipNotes(notes: string): string {
  const trimmed = notes.trim();
  if (trimmed.length <= MAX_NOTES_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_NOTES_CHARS)}\n\n[… notes cut here: ${trimmed.length - MAX_NOTES_CHARS} more characters were not passed on]`;
}

function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Map a model-supplied card onto the content service's note input. */
export function toNoteInput(raw: Record<string, unknown>): content.NoteInput {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const opt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    hanzi: str(raw.hanzi),
    pinyin: str(raw.pinyin),
    english: str(raw.english),
    fun_facts: opt(raw.fun_facts),
    sentence_clue: opt(raw.sentence_clue),
    sentence_clue_pinyin: opt(raw.sentence_clue_pinyin),
    sentence_clue_translation: opt(raw.sentence_clue_translation),
    alternatives: opt(raw.alternatives),
  } as content.NoteInput;
}

/** The progress line for one tool call, from its input and result. */
export function stepForTool(name: string, input: Record<string, unknown>, result: Record<string, unknown>): TutorNotesStep | null {
  const at = new Date().toISOString();
  switch (name) {
    case 'check_student_words': {
      const known = Array.isArray(result.known) ? result.known.length : 0;
      const asked = Array.isArray(input.hanzi) ? input.hanzi.length : 0;
      return { at, kind: 'tool', text: `Checked ${asked} word${asked === 1 ? '' : 's'} against the student's cards · ${known} already there` };
    }
    case 'search_student_cards':
      return { at, kind: 'tool', text: `Searched the student's cards for "${String(input.query ?? '')}"` };
    case 'list_student_deck_words':
      return { at, kind: 'tool', text: `Looked at the words in "${String(result.deck_name ?? 'a deck')}"` };
    case 'get_student_struggles':
      return { at, kind: 'tool', text: `Read what the student has been getting wrong` };
    case 'create_deck':
      return { at, kind: 'tool', text: `Created the deck "${String(result.name ?? input.name ?? '')}"` };
    case 'add_cards': {
      const added = Array.isArray(result.added) ? result.added.length : 0;
      const rejected = Array.isArray(result.rejected) ? result.rejected.length : 0;
      const dup = Array.isArray(result.skipped_duplicates) ? result.skipped_duplicates.length : 0;
      const parts = [`Added ${added} card${added === 1 ? '' : 's'}`];
      if (rejected) parts.push(`${rejected} rejected by the card standard`);
      if (dup) parts.push(`${dup} already in the deck`);
      return { at, kind: rejected ? 'warn' : 'tool', text: parts.join(' · ') };
    }
    case 'create_mini_lesson':
      return result.problems
        ? { at, kind: 'warn', text: `Lesson draft had ${(result.problems as unknown[]).length} problem${(result.problems as unknown[]).length === 1 ? '' : 's'} — fixing` }
        : { at, kind: 'tool', text: `Wrote the mini lesson "${String(result.title ?? '')}"` };
    case 'create_reader':
      return result.problems
        ? { at, kind: 'warn', text: `Reader draft had ${(result.problems as unknown[]).length} problem${(result.problems as unknown[]).length === 1 ? '' : 's'} — fixing` }
        : { at, kind: 'tool', text: `Wrote the reader "${String(result.title_english ?? '')}"` };
    case 'finish':
      return null;
    default:
      return { at, kind: 'tool', text: name };
  }
}

// ============ The loop ============

type Outcome = 'done' | 'failed' | 'cancelled' | 'continue' | 'skipped';

interface RunContext {
  env: Env;
  job: TutorNotesJob;
  steps: TutorNotesStep[];
  result: TutorNotesResult;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 529;
  }
  return error instanceof Anthropic.APIConnectionError;
}

async function callModel(client: Anthropic, messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    try {
      return await client.messages.create({
        model: TUTOR_NOTES_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS as Anthropic.Tool[],
        messages,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Claude request failed');
}

/**
 * Run (or resume) one job. Returns what happened so the queue consumer can
 * ack or re-enqueue. Every failure is written to the row; nothing throws
 * except for a missing API key, which the route already refuses.
 */
export async function runTutorNotesJob(env: Env, jobId: string): Promise<Outcome> {
  const startedAt = Date.now();
  const job = await jobs.getJob(env.DB, jobId);
  if (!job) return 'skipped';
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return 'skipped';

  const ctx: RunContext = { env, job, steps: [...job.steps], result: { ...job.result } };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let messages: Anthropic.MessageParam[];
  if (job.transcript && job.transcript.length > 0) {
    messages = job.transcript as Anthropic.MessageParam[];
    await pushStep(ctx, { at: now(), kind: 'info', text: 'Resumed where it left off' }, 'Resuming…');
  } else {
    const briefing = await loadBriefing(env, job);
    messages = [{ role: 'user', content: briefing }];
    await jobs.patchJob(env.DB, job.id, {
      status: 'running',
      started_at: job.started_at ?? now(),
      transcript: messages,
      progress: 'Reading the notes',
      steps: pushLocal(ctx, { at: now(), kind: 'info', text: 'Read the student briefing and the notes' }),
    });
  }
  if (job.status !== 'running') await jobs.patchJob(env.DB, job.id, { status: 'running', started_at: job.started_at ?? now() });

  let rounds = job.rounds;
  try {
    while (rounds < MAX_ROUNDS) {
      // A cancel from the tutor is honoured between rounds.
      const fresh = await jobs.getJob(env.DB, job.id);
      if (!fresh || fresh.status === 'cancelled') return 'cancelled';

      // Resume case: the last message may be an assistant turn whose tool
      // calls were never answered. Execute them instead of calling the model.
      const last = messages[messages.length - 1];
      let response: Anthropic.Message | null = null;
      let assistantContent: Anthropic.ContentBlock[];
      if (last.role === 'assistant' && Array.isArray(last.content) && last.content.some(b => (b as { type: string }).type === 'tool_use')) {
        assistantContent = last.content as Anthropic.ContentBlock[];
      } else {
        response = await callModel(client, messages);
        rounds += 1;
        assistantContent = response.content;
        messages.push({ role: 'assistant', content: assistantContent });
        // Checkpoint A: the model's turn is saved before any tool runs.
        await jobs.patchJob(env.DB, job.id, { transcript: messages, rounds });
      }

      const toolUses = assistantContent.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const texts = assistantContent.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text.trim()).filter(Boolean);

      if (toolUses.length === 0) {
        // The model stopped talking instead of calling finish: take its text as the summary.
        const summary = texts.join('\n\n') || 'The agent finished without a summary.';
        await finalize(ctx, summary, []);
        return 'done';
      }

      for (const t of texts) {
        await pushStep(ctx, { at: now(), kind: 'info', text: oneLine(t, 240) }, oneLine(t, 120));
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      let finished: { summary: string; skipped: string[] } | null = null;
      for (const use of toolUses) {
        const input = (use.input ?? {}) as Record<string, unknown>;
        if (use.name === 'finish') {
          finished = {
            summary: typeof input.summary === 'string' ? input.summary : '',
            skipped: Array.isArray(input.skipped) ? input.skipped.filter((s): s is string => typeof s === 'string') : [],
          };
          results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Finishing.' });
          continue;
        }
        const out = await executeTool(ctx, use.name, input);
        const step = stepForTool(use.name, input, out);
        if (step) await pushStep(ctx, step, step.text);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out) });
      }
      messages.push({ role: 'user', content: results });
      // Checkpoint B: tool results saved, so a redelivery continues with the model.
      await jobs.patchJob(env.DB, job.id, { transcript: messages, result: ctx.result });

      if (finished) {
        await finalize(ctx, finished.summary, finished.skipped);
        return 'done';
      }

      if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
        await jobs.patchJob(env.DB, job.id, { progress: 'Still working…' });
        await env.TUTOR_NOTES_QUEUE.send({ jobId: job.id, resume: true });
        return 'continue';
      }
    }

    // Out of rounds: keep whatever was made and tell the tutor.
    await finalize(ctx, `The assistant ran out of steps before calling finish. Everything it created so far is listed above — check the deck before sending anything else.`, []);
    return 'done';
  } catch (error) {
    const message = describeError(error);
    console.error('[tutor-notes] job failed', job.id, error);
    await jobs.patchJob(env.DB, job.id, {
      status: 'failed',
      error: message,
      progress: 'Failed',
      finished_at: now(),
      transcript: messages,
      rounds,
      steps: pushLocal(ctx, { at: now(), kind: 'error', text: `Failed: ${oneLine(message, 200)}` }),
      result: ctx.result,
    });
    return 'failed';
  }
}

function now(): string {
  return new Date().toISOString();
}

/** A one-line, tutor-readable version of a failure (the SDK's message is a JSON dump). */
export function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { type?: string; message?: string } } | undefined;
    const detail = body?.error?.message || body?.error?.type || error.message;
    const head = error.status === 401 ? 'Claude API key rejected' : error.status === 429 ? 'Claude rate limit' : error.status === 529 ? 'Claude is overloaded' : `Claude API error ${error.status ?? ''}`.trim();
    return detail ? `${head}: ${oneLine(detail, 200)}` : head;
  }
  if (error instanceof Error) return oneLine(error.message, 300);
  return 'The assistant failed';
}

function pushLocal(ctx: RunContext, step: TutorNotesStep): TutorNotesStep[] {
  ctx.steps.push(step);
  if (ctx.steps.length > 80) ctx.steps.splice(0, ctx.steps.length - 80);
  return ctx.steps;
}

async function pushStep(ctx: RunContext, step: TutorNotesStep, progress: string): Promise<void> {
  pushLocal(ctx, step);
  await jobs.patchJob(ctx.env.DB, ctx.job.id, { steps: ctx.steps, progress, result: ctx.result });
}

// ============ Briefing ============

async function loadBriefing(env: Env, job: TutorNotesJob): Promise<string> {
  const to = now();
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [student, tutor, decks, rows, cardStates, log, earlier] = await Promise.all([
    jobs.getUserBrief(env.DB, job.student_id),
    jobs.getUserBrief(env.DB, job.tutor_id),
    jobs.listStudentDecks(env.DB, job.student_id),
    iq.fetchReviewRows(env.DB, job.student_id, from, to, 6000).catch(() => []),
    iq.fetchCardStatesForRange(env.DB, job.student_id, from, to).catch(() => []),
    iq.listLessonLog(env.DB, job.relationship_id, 5).catch(() => []),
    jobs.listRecentJobSummaries(env.DB, job.relationship_id, job.id),
  ]);
  const struggling = rankStruggling(rows, 15).map(s => ({
    hanzi: s.note.hanzi,
    english: s.note.english,
    again_count: s.again_count,
    attempts: s.attempts,
    wrong_answers: s.wrong_answers,
  }));
  const goingWell = pickGoingWell(rows, cardStates, 10).map(g => ({ hanzi: g.note.hanzi, english: g.note.english }));
  return buildBriefing({
    studentName: student?.name ?? null,
    studentBio: student?.bio ?? null,
    tutorName: tutor?.name ?? null,
    decks,
    struggling,
    goingWell,
    lessonLog: log.filter(e => e.id !== job.lesson_log_id).map(e => ({ lesson_at: e.lesson_at, notes: e.notes })),
    earlierJobs: earlier,
    job,
  });
}

// ============ Tool execution ============

function compactMatch(m: StudentWordMatch) {
  return { hanzi: m.hanzi, pinyin: m.pinyin, english: m.english, deck: m.deck_name, state: m.state, reps: m.reps, lapses: m.lapses, interval_days: m.interval_days };
}

async function executeTool(ctx: RunContext, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { env, job } = ctx;
  try {
    switch (name) {
      case 'check_student_words': {
        const hanzi = (Array.isArray(input.hanzi) ? input.hanzi : []).filter((h): h is string => typeof h === 'string').slice(0, 60);
        const found = await jobs.findStudentWords(env.DB, job.student_id, hanzi);
        const known: unknown[] = [];
        const unknown: string[] = [];
        for (const h of hanzi) {
          const matches = found.get(h.trim());
          if (matches?.length) known.push(...matches.map(compactMatch));
          else unknown.push(h);
        }
        return { known, unknown };
      }
      case 'search_student_cards': {
        const query = typeof input.query === 'string' ? input.query : '';
        if (!query.trim()) return { error: 'query is required' };
        const limit = clamp(input.limit, 1, 50, 20);
        const matches = await jobs.searchStudentWords(env.DB, job.student_id, query, limit);
        return { matches: matches.map(compactMatch) };
      }
      case 'list_student_deck_words': {
        const deckId = typeof input.deck_id === 'string' ? input.deck_id : '';
        const decks = await jobs.listStudentDecks(env.DB, job.student_id);
        const deck = decks.find(d => d.id === deckId);
        if (!deck) return { error: 'No such deck in the student\'s account', deck_ids: decks.map(d => d.id) };
        const words = await jobs.listStudentDeckWords(env.DB, job.student_id, deckId);
        return { deck_name: deck.name, words: words.map(compactMatch) };
      }
      case 'get_student_struggles': {
        const days = clamp(input.days, 1, 180, 30);
        const to = now();
        const from = new Date(Date.now() - days * 86_400_000).toISOString();
        const [rows, cardStates] = await Promise.all([
          iq.fetchReviewRows(env.DB, job.student_id, from, to, 8000),
          iq.fetchCardStatesForRange(env.DB, job.student_id, from, to),
        ]);
        return {
          days,
          reviews: rows.length,
          struggling: rankStruggling(rows, 25).map(s => ({
            hanzi: s.note.hanzi,
            pinyin: s.note.pinyin,
            english: s.note.english,
            attempts: s.attempts,
            again: s.again_count,
            hard: s.hard_count,
            forgot_after_correct: s.forgot_count,
            wrong_answers: s.wrong_answers,
          })),
          going_well: pickGoingWell(rows, cardStates, 15).map(g => ({ hanzi: g.note.hanzi, english: g.note.english, reason: g.reason })),
        };
      }
      case 'create_deck': {
        if (ctx.result.deck) return { deck_id: ctx.result.deck.id, name: ctx.result.deck.name, note: 'This job already has its deck.' };
        const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : job.title || `Session notes ${now().slice(0, 10)}`;
        const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : `From the session notes${job.lesson_at ? ` of ${job.lesson_at.slice(0, 10)}` : ''}.`;
        const deck = await content.createDeck(env.DB, job.tutor_id, { name, description });
        ctx.result.deck = { id: deck.id, name: deck.name, note_count: 0 };
        await jobs.patchJob(env.DB, job.id, { result: ctx.result });
        return { deck_id: deck.id, name: deck.name };
      }
      case 'add_cards': {
        const deckId = typeof input.deck_id === 'string' ? input.deck_id : ctx.result.deck?.id;
        if (!deckId || !ctx.result.deck || deckId !== ctx.result.deck.id) return { error: 'Use the deck_id returned by create_deck.' };
        const rawCards = (Array.isArray(input.cards) ? input.cards : []).slice(0, 15) as Record<string, unknown>[];
        const existing = await jobs.listDeckHanzi(env.DB, deckId);
        const toAdd: content.NoteInput[] = [];
        const skipped: string[] = [];
        for (const raw of rawCards) {
          const note = toNoteInput(raw);
          if (existing.has(note.hanzi)) {
            skipped.push(note.hanzi);
            continue;
          }
          existing.add(note.hanzi);
          toAdd.push(note);
        }
        const res = await content.createNotes(env, job.tutor_id, deckId, toAdd, { audio: 'queue', sentences: true });
        ctx.result.deck.note_count += res.created.length;
        await jobs.patchJob(env.DB, job.id, { result: ctx.result });
        return {
          added: res.created.map(n => n.hanzi),
          skipped_duplicates: skipped,
          rejected: res.failed.map(f => ({ hanzi: f.hanzi, error: f.error })),
          deck_total: ctx.result.deck.note_count,
        };
      }
      case 'create_mini_lesson': {
        const errors = validateLessonSpec(input.spec);
        if (errors.length > 0) return { problems: errors };
        const spec = input.spec as CustomLessonSpec;
        const lessons = ctx.result.lessons ?? [];
        const dup = lessons.find(l => l.title === spec.title);
        if (dup) return { library_item_id: dup.library_item_id, title: dup.title, note: 'A lesson with this title was already made in this job.' };
        if (lessons.length >= 2) return { error: 'At most two lessons per session. Fold this into one of the existing ones or leave it out.' };
        const item = await lib.createLibraryItem(env.DB, job.tutor_id, {
          title: spec.title,
          description: spec.description ?? null,
          icon: spec.icon ?? null,
          spec: JSON.stringify(spec),
          tags: ['session-notes'],
        });
        const exerciseCount = spec.sections.reduce((s, sec) => s + sec.exercises.length, 0);
        lessons.push({ library_item_id: item.id, title: spec.title, exercise_count: exerciseCount });
        ctx.result.lessons = lessons;
        await jobs.patchJob(env.DB, job.id, { result: ctx.result });
        return { library_item_id: item.id, title: spec.title, exercise_count: exerciseCount };
      }
      case 'create_reader': {
        if (ctx.result.reader) return { reader_id: ctx.result.reader.id, note: 'This job already has its reader.' };
        const errors = validateReaderSpec(input.spec);
        if (errors.length > 0) return { problems: errors };
        const spec = normalizeReaderSpec(input.spec as ReaderSpec);
        const warnings = readerPageWarnings(spec).map(w => w.message);
        const { reader, imageJobs } = await createReaderFromSpec(env.DB, job.tutor_id, spec);
        if (imageJobs.length > 0 && env.GEMINI_API_KEY && env.IMAGE_QUEUE) {
          try {
            await env.IMAGE_QUEUE.sendBatch(imageJobs.map(j => ({ body: { readerId: reader.id, pageId: j.pageId, imagePrompt: j.imagePrompt, totalPages: imageJobs.length } })));
          } catch (err) {
            console.error('[tutor-notes] Failed to queue reader images:', err);
          }
        }
        ctx.result.reader = { id: reader.id, title_english: spec.title_english, title_chinese: spec.title_chinese, page_count: spec.pages.length };
        await jobs.patchJob(env.DB, job.id, { result: ctx.result });
        return { reader_id: reader.id, title_english: spec.title_english, page_count: spec.pages.length, warnings };
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[tutor-notes] tool failed', name, message);
    return { error: message };
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ============ Finalize: share to the student ============

async function finalize(ctx: RunContext, summary: string, skipped: string[]): Promise<void> {
  const { env, job } = ctx;
  ctx.result.summary = summary.trim();
  ctx.result.skipped = skipped;

  if (job.auto_share) {
    if (ctx.result.deck && ctx.result.deck.note_count > 0 && !ctx.result.deck.target_deck_id) {
      try {
        const share = await shareDeck(env.DB, job.relationship_id, job.tutor_id, ctx.result.deck.id, job.priority);
        ctx.result.deck.target_deck_id = share.target_deck_id;
        ctx.result.deck.shared_at = now();
        pushLocal(ctx, { at: now(), kind: 'done', text: `Sent "${ctx.result.deck.name}" to the student (${job.priority === 'core' ? 'top' : 'bottom'} of their queue)` });
      } catch (err) {
        pushLocal(ctx, { at: now(), kind: 'warn', text: `Could not send the deck automatically: ${oneLine(err instanceof Error ? err.message : String(err), 160)}` });
      }
    }
    for (const lesson of ctx.result.lessons ?? []) {
      if (lesson.lesson_id) continue;
      try {
        const item = await lib.getLibraryItem(env.DB, lesson.library_item_id, job.tutor_id);
        if (!item) continue;
        const existing = await lib.findAssignedCopy(env.DB, item.id, job.student_id);
        if (existing) {
          lesson.lesson_id = existing.id;
          continue;
        }
        const spec = JSON.parse(item.spec) as CustomLessonSpec;
        const copy = await lib.createAssignedLesson(env.DB, job.student_id, {
          title: spec.title,
          description: spec.description ?? null,
          icon: spec.icon ?? null,
          spec: item.spec,
          library_item_id: item.id,
          assigned_by: job.tutor_id,
          assigned_relationship_id: job.relationship_id,
        });
        await queueLessonImages(env, copy.id, spec);
        lesson.lesson_id = copy.id;
        pushLocal(ctx, { at: now(), kind: 'done', text: `Assigned the lesson "${lesson.title}"` });
      } catch (err) {
        pushLocal(ctx, { at: now(), kind: 'warn', text: `Could not assign "${lesson.title}": ${oneLine(err instanceof Error ? err.message : String(err), 160)}` });
      }
    }
    if (ctx.result.reader && !ctx.result.reader.target_reader_id) {
      try {
        const { reader } = await shareReader(env.DB, job.relationship_id, job.tutor_id, ctx.result.reader.id);
        ctx.result.reader.target_reader_id = reader.id;
        pushLocal(ctx, { at: now(), kind: 'done', text: `Sent the reader "${ctx.result.reader.title_english}"` });
      } catch (err) {
        pushLocal(ctx, { at: now(), kind: 'warn', text: `Could not send the reader: ${oneLine(err instanceof Error ? err.message : String(err), 160)}` });
      }
    }
  }

  if (ctx.result.deck && ctx.result.deck.note_count === 0) {
    // An empty deck is noise in both libraries — remove it.
    try {
      await content.deleteDeck(env, job.tutor_id, ctx.result.deck.id);
      pushLocal(ctx, { at: now(), kind: 'warn', text: 'No cards were added, so the empty deck was removed' });
      delete ctx.result.deck;
    } catch {
      /* leave it */
    }
  }

  pushLocal(ctx, { at: now(), kind: 'done', text: 'Done' });
  await jobs.patchJob(env.DB, job.id, {
    status: 'done',
    progress: 'Done',
    finished_at: now(),
    steps: ctx.steps,
    result: ctx.result,
    error: null,
  });
}
