/**
 * "🎯 Mini lesson on this mistake" (Sentence Coach; shared/coach/mistakeLesson.ts).
 *
 * After ✏️ Check my sentence found a mistake, Claude writes a short mini lesson about exactly that
 * mistake: one note with the rule and contrasting examples (wrong → right, why), then ~8–12
 * exercises of several types chosen for the KIND of mistake (word order → scramble; a wrong word /
 * measure word / particle → choice with his own mistake among the distractors; a sound-alike
 * character → listen_choice; then translate / write_typed / dictation / sentence_making to produce
 * it) — all on VARIANTS of his sentence (other subjects, objects, times, places) so he learns the
 * rule rather than one sentence.
 *
 * Written in the background as a coach reply (coach-reply-queue, services/coach-replies.ts): the
 * pending assistant message has content_type `mistake_lesson`; `writeMistakeLesson` returns the
 * content JSON stored on it. Forced tool, thinking off, validated with validateLessonSpec + the
 * shape checks below, up to two repair rounds, the 一 / 不 tone changes and the pinyin checker
 * (services/pinyin-check.ts) applied before it is stored — the same checks a saved lesson gets.
 */
import Anthropic from '@anthropic-ai/sdk';
import { validateLessonSpec, type CustomLessonSpec } from '@shared/lesson';
import { YI_BU_CONVENTION } from '@shared/pinyin/toneChange';
import { mistakeLessonExerciseCount, type MistakeLessonContent } from '@shared/coach';
import type { Env, SentenceCoachResult } from '../types';
import { LESSON_SPEC_INPUT_SCHEMA } from './custom-lesson';
import { LESSON_SPEC_SCHEMA_TEXT, LESSON_STYLE_RULES } from './lesson-editor';
import { LESSON_WRITER_MODEL, applyYiBuToSpec, withRetry, type CreateMessage } from './companion-lesson';
import { fixSpecPinyin, logPinyinFixes, pinyinSources } from './pinyin-check';
import { StructuredCallError } from './structured-call';
import { trackServer } from './analytics/server-events';

const MAX_REPAIR_ROUNDS = 2;
const TOOL = 'create_lesson_spec';
/** A ~10-exercise lesson is ~3–5k output tokens; room for a long one, never a cut-off. */
const MAX_TOKENS = 12000;

/** Exercise types that don't belong in a lesson about one sentence's mistake. */
const OFF_TOPIC_TYPES = new Set(['conversation', 'describe_image', 'oral_expression']);
/** Exercises where he PRODUCES the structure himself. */
const PRODUCTION_TYPES = new Set(['translate', 'write_typed', 'dictation', 'sentence_making', 'write_handwriting', 'listen_translate']);

export const MISTAKE_LESSON_SYSTEM = `You write a short MINI LESSON in a Chinese-learning app that teaches a learner the exact mistake(s) they just made in a sentence they wrote. You get what they wrote, the corrected sentence and the coach's critique. Return the whole lesson with the ${TOOL} tool.

First work out (silently) what EXACTLY went wrong: word order (time / place / 把 / adverb position…), a wrong word or collocation, a measure word, a particle (了 / 的 / 得 / 地 / 过 / 着 / 吗 / 呢), a missing or extra word, a character written for a sound-alike (a homophone or near-homophone), or something unnatural that a native would say differently. Teach THAT and nothing else. Two different mistakes: teach both, the bigger one first. Ignore changes of punctuation only.

Build it like this (2–3 sections, 9–12 exercises in all, about 5–8 minutes on a phone):
1. "Your mistake" — ONE "note" first. title = the rule in a few words ("Time comes before the verb"). body, 3–5 short lines: "You wrote: <his sentence> ✗" / "A native says: <corrected> ✓", then WHY in plain English, then the pattern with a real example (never placeholders like "sb" / "X"). sentences = 3–4 examples with pinyin + english: the corrected sentence first, then 2–3 VARIANTS using the same rule in other situations.
2. "Practise it" — recognise, then build. Pick the types that train THIS kind of mistake:
   - word order → 2–3 "scramble" of variants; the word he put in the wrong place is its own tile;
   - a wrong word / measure word / particle / collocation → 2–3 "choice" whose options include HIS OWN mistake (applied to a variant) plus 1–2 other plausible wrong ones; "explanation" says why the right one is right;
   - a sound-alike character → 1–2 "listen_choice" (the confused words as options, question in English) and a "choice" asking which character fits the sentence;
   - always one "choice" "Which sentence is correct?" — a variant written right vs. written with his mistake (and one more plausible wrong version).
3. "Use it" — he produces the structure himself:
   - 2 "translate" (English → Chinese) of variants that need the rule;
   - 1 "write_typed" (cues english + pinyin) or "dictation" (input "type") of the corrected sentence or a variant;
   - 1 "sentence_making": the key word(s) of the rule (1–3), a task that makes him use the structure, and an example answer.
Use at least 4 different exercise types. No "conversation", "describe_image" or "oral_expression".

VARIANTS: change the subject, object, time, place or verb so the rule is the same but the sentence isn't his one sentence again. Stay at HIS level: reuse his words and words as easy as his; sentences about as long as his (rarely more than ~15 characters).
Wrong Chinese only ever appears in the note (marked ✗) and as wrong options of a choice — never as a reference answer, an audio line or a scramble.
title = the rule ("Time before the verb", "Measure word 本 for books"); icon "🎯"; description = one line saying what the lesson fixes.
Pinyin: tone marks, spaces between words (not syllables), the reading this word uses, and the 一 / 不 tone changes written: ${YI_BU_CONVENTION}
English: natural, one clear meaning. Simplified characters, mainland usage.

${LESSON_STYLE_RULES}

${LESSON_SPEC_SCHEMA_TEXT}`;

/** What the learner wrote and what the coach said, for the model. */
export interface MistakeLessonInput {
  /** The sentence as he wrote it. */
  original: string;
  coach: Pick<SentenceCoachResult, 'corrected' | 'critique' | 'issues' | 'alternatives'> & { isCorrect?: boolean };
}

export function mistakeLessonBrief(input: MistakeLessonInput): string {
  const { coach } = input;
  const lines = [
    `What the learner wrote: ${input.original.trim()}`,
    `Corrected: ${coach.corrected.hanzi} | ${coach.corrected.pinyin} | ${coach.corrected.english}`,
    `The coach's critique: ${coach.critique || '(none)'}`,
  ];
  const issues = (coach.issues ?? []).filter((i) => i.suggestion || i.explanation);
  if (issues.length) {
    lines.push('The mistakes the coach found:', ...issues.map((i) => `- ${i.original ? `${i.original} → ` : ''}${i.suggestion}${i.explanation ? `: ${i.explanation}` : ''}`));
  }
  const alts = (coach.alternatives ?? []).slice(0, 2);
  if (alts.length) lines.push('Other natural ways to say it:', ...alts.map((a) => `- ${a.hanzi} | ${a.pinyin} | ${a.english}`));
  return lines.join('\n');
}

/** Shape checks on top of validateLessonSpec, sent back as a repair round. */
export function mistakeLessonProblems(spec: CustomLessonSpec): string[] {
  const exercises = spec.sections.flatMap((s) => s.exercises);
  const types = exercises.map((e) => e.type);
  const scored = types.filter((t) => t !== 'note');
  const problems: string[] = [];
  if (types[0] !== 'note') problems.push('start with ONE "note" that explains the mistake: what he wrote ✗, what a native says ✓, why, and 3–4 example sentences');
  if (scored.length < 7) problems.push(`the lesson has ${scored.length} exercises after the note; it needs 8–11 (9–12 in all)`);
  if (scored.length > 15) problems.push(`the lesson has ${scored.length} exercises; keep it to 8–11 after the note`);
  if (new Set(scored).size < 4) problems.push('use at least 4 different exercise types (e.g. scramble / choice / translate / write_typed / sentence_making)');
  const off = [...new Set(types.filter((t) => OFF_TOPIC_TYPES.has(t)))];
  if (off.length) problems.push(`leave out ${off.map((t) => `"${t}"`).join(', ')}: this lesson is about one sentence's mistake`);
  if (!types.some((t) => PRODUCTION_TYPES.has(t))) problems.push('add exercises where he produces the structure himself: "translate" (English → Chinese) and "write_typed" / "dictation" / "sentence_making"');
  if (!types.some((t) => t === 'choice' || t === 'scramble' || t === 'listen_choice')) problems.push('add a recognition exercise ("choice" with his own mistake as a wrong option, or "scramble")');
  return problems;
}

/**
 * Write the lesson spec: forced tool, thinking off, validated + the shape checks, up to two repair
 * rounds. A spec that still fails is a refusal (StructuredCallError, not retried by the queue —
 * asking again would cost the same and likely fail the same way).
 */
export async function generateMistakeLessonSpec(
  input: MistakeLessonInput,
  create: CreateMessage,
): Promise<{ spec: CustomLessonSpec; rounds: number }> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Write the mini lesson on this mistake.\n\n${mistakeLessonBrief(input)}` },
  ];
  let lastErrors: string[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const response = await withRetry(create, {
      model: LESSON_WRITER_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      system: MISTAKE_LESSON_SYSTEM,
      tools: [{ name: TOOL, description: 'Return the complete lesson spec.', input_schema: LESSON_SPEC_INPUT_SCHEMA as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: TOOL },
      messages,
    });
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      if (response.stop_reason === 'max_tokens') throw new StructuredCallError('The lesson came back cut off (too long)', false);
      throw new StructuredCallError('No lesson in the reply', false);
    }
    const raw = toolUse.input as CustomLessonSpec;
    if (raw && typeof raw === 'object') {
      if (!raw.icon) raw.icon = '🎯';
      applyYiBuToSpec(raw);
    }
    const errors = validateLessonSpec(raw);
    const shape = errors.length === 0 ? mistakeLessonProblems(raw) : [];
    // Shape problems only cost a repair round while there are rounds left; the last valid spec is kept.
    if (errors.length === 0 && (shape.length === 0 || round === MAX_REPAIR_ROUNDS)) return { spec: raw, rounds: round + 1 };
    lastErrors = errors.length ? errors : shape;
    if (round === MAX_REPAIR_ROUNDS) break;
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Not right yet. Fix every problem below and call ${TOOL} again with the COMPLETE corrected spec:\n${lastErrors.map((e) => `- ${e}`).join('\n')}`,
        }],
      },
    );
  }
  throw new StructuredCallError(`Could not write a valid lesson: ${lastErrors.slice(0, 3).join('; ')}`, false);
}

/** E2E_TEST_MODE: a deterministic lesson from the correction (no Claude call). */
export function fakeMistakeLessonSpec(input: MistakeLessonInput): CustomLessonSpec {
  const fixed = input.coach.corrected;
  const wrote = input.original.trim();
  return applyYiBuToSpec({
    title: '(E2E) One 了 is enough',
    icon: '🎯',
    description: `Fixes “${wrote}”.`,
    sections: [
      {
        title: 'Your mistake',
        exercises: [{
          type: 'note',
          title: 'One 了 is enough',
          body: `You wrote: ${wrote} ✗\nA native says: ${fixed.hanzi} ✓\n(E2E) The rule would be explained here.`,
          sentences: [
            { hanzi: fixed.hanzi, pinyin: fixed.pinyin, english: fixed.english },
            { hanzi: '我昨天去银行了。', pinyin: 'wǒ zuótiān qù yínháng le.', english: 'I went to the bank yesterday.' },
          ],
        }],
      },
      {
        title: 'Practise it',
        exercises: [
          { type: 'choice', question: 'Which sentence is correct?', options: [{ hanzi: '我昨天去银行了。', pinyin: 'wǒ zuótiān qù yínháng le.', english: 'I went to the bank yesterday.' }, { hanzi: '我昨天去了银行了。' }], correct: 0, explanation: '(E2E) One 了, at the end.' },
          { type: 'choice', question: 'Which one fits? 他昨天买书＿', options: [{ hanzi: '他昨天买书了。' }, { hanzi: '他昨天买了书了。' }], correct: 0 },
        ],
      },
      {
        title: 'Use it',
        exercises: [
          { type: 'translate', english: 'She went to the shop yesterday.', reference_hanzi: '她昨天去商店了。', reference_pinyin: 'tā zuótiān qù shāngdiàn le.' },
        ],
      },
    ],
  });
}

/**
 * The job (from runCoachReply): the lesson as the message's content JSON. Throws on failure —
 * a StructuredCallError(…, false) for a refusal / an invalid lesson, anything else is retried.
 */
export async function writeMistakeLesson(
  env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'> & Partial<Env>,
  input: MistakeLessonInput,
  opts: { create?: CreateMessage; userId?: string } = {},
): Promise<MistakeLessonContent> {
  let spec: CustomLessonSpec;
  let rounds = 0;
  if (!opts.create && !env.ANTHROPIC_API_KEY) {
    if (env.E2E_TEST_MODE !== 'true') throw new StructuredCallError('The coach is not configured', false);
    spec = fakeMistakeLessonSpec(input);
  } else {
    const client = opts.create ? null : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const create: CreateMessage = opts.create ?? ((params) => client!.messages.create(params));
    ({ spec, rounds } = await generateMistakeLessonSpec(input, create));
  }
  // A syllable its character can't have is corrected before anyone hears it (the save path checks again).
  const fixes = await fixSpecPinyin(spec, pinyinSources(env));
  logPinyinFixes('mistake lesson', fixes);
  const exercises = mistakeLessonExerciseCount(spec);
  const types = new Set(spec.sections.flatMap((s) => s.exercises.map((e) => e.type))).size;
  void trackServer('coach.mistake_lesson_written', { exercises, types, rounds }, { env: env as Env, userId: opts.userId ?? null });
  return { spec, lesson_id: null, saved_at: null, completed: false };
}
