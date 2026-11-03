/**
 * Context `exercise` — "💬 Ask Claude" on one exercise of a mini lesson (docs/STUDY_SESSION.md "Mini
 * lessons" → "Ask Claude about an exercise"; the unified-Claude-chats plan §6.5). Replaces the lesson
 * answer check's inline "💬 Ask about this" chat (`POST /api/lessons/answer-check/ask`, kept for older
 * app builds).
 *
 * load: ONE `db.batch` — the lesson (ownership: missing → 404, someone else's → 403), the learner's
 * decks and, for Chinese answers, the known-words sample; the exercise is found in the spec by its key
 * (`s<section>e<index>`, shared/study/lessonRun.ts `exerciseKey`; missing → 404).
 * The context block (uncached): the lesson's title, the exercise — its type's name and its fields, media
 * keys left out, ≤ `EXERCISE_JSON_MAX` characters — and, when he asks after answering, his answer and
 * Claude's answer check of it (the device sends them with the context; shared/lesson/answerCheck.ts).
 * Tools: read-only look-ups + create_flashcards (deck picked from the list) + bump_cards.
 */
import { plainAnswerText, type AskLanguage } from '@shared/study/askClaude';
import { exerciseTypeInfo } from '@shared/lesson/registry';
import { StructuredCallError } from '../../structured-call';
import { knownWordsStatement } from '../learner';
import { buildContextChatSystemBlocks } from '../persona';
import { ClaudeContextError, type AgentEnv, type ContextOf, type ContextProvider, type ToolName } from '../types';

/** The exercise chat's tools, in the order the model sees them. */
export const EXERCISE_TOOLS: readonly ToolName[] = ['create_flashcards', 'search_cards', 'bump_cards', 'get_note_cards', 'search_my_chats', 'read_chat'];

export const EXERCISE_CHAT_MAX_TOKENS = 4000;
/** The exercise's fields as JSON, at most this long in the context block. */
export const EXERCISE_JSON_MAX = 2500;

/** Fields that are media / bookkeeping, never useful to Claude (and never a URL in the prompt). */
const DROP_FIELDS = new Set(['image_url', 'audio_url', 'audio_key', 'image_key', 'voice_id', 'voices', 'id']);

type Answer = NonNullable<ContextOf<'exercise'>['answer']>;

interface ExerciseData {
  lessonTitle: string;
  sectionTitle: string | null;
  type: string;
  typeName: string;
  exercise: Record<string, unknown>;
  answer: Answer | null;
  decks: string;
  language: AskLanguage;
  knownWords: string[];
}

/** `s<section>e<index>` → [section, index], or null. */
export function parseExerciseKey(key: string): [number, number] | null {
  const m = /^s(\d{1,3})e(\d{1,3})$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The exercise at `key` in a lesson spec (JSON or parsed), or null. */
export function exerciseAt(spec: unknown, key: string): { exercise: Record<string, unknown>; sectionTitle: string | null; title: string | null } | null {
  let s = spec;
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      return null;
    }
  }
  const at = parseExerciseKey(key);
  const sections = (s as { sections?: unknown })?.sections;
  if (!at || !Array.isArray(sections)) return null;
  const section = sections[at[0]] as { title?: unknown; exercises?: unknown } | undefined;
  const exercise = Array.isArray(section?.exercises) ? (section!.exercises[at[1]] as Record<string, unknown> | undefined) : undefined;
  if (!exercise || typeof exercise !== 'object' || typeof exercise.type !== 'string') return null;
  const title = (s as { title?: unknown }).title;
  return { exercise, sectionTitle: typeof section!.title === 'string' ? section!.title : null, title: typeof title === 'string' ? title : null };
}

/** The exercise as compact JSON for the prompt: media fields dropped, cut to EXERCISE_JSON_MAX. */
export function exerciseJson(exercise: Record<string, unknown>): string {
  const json = JSON.stringify(exercise, (k, v) => (DROP_FIELDS.has(k) ? undefined : v));
  return json.length > EXERCISE_JSON_MAX ? `${json.slice(0, EXERCISE_JSON_MAX - 1)}…` : json;
}

/** The lesson + exercise when they are the caller's (404 / 403 otherwise), + the decks and known words. */
export async function loadExerciseContext(env: AgentEnv, ctx: ContextOf<'exercise'>, userId: string, language: AskLanguage): Promise<ExerciseData> {
  const db = env.DB;
  const statements: D1PreparedStatement[] = [
    db.prepare('SELECT id, user_id, title, spec FROM custom_lessons WHERE id = ?').bind(ctx.lesson_id),
    db.prepare('SELECT id, name FROM decks WHERE user_id = ? ORDER BY name').bind(userId),
  ];
  if (language === 'zh') statements.push(knownWordsStatement(db, userId));
  const results = await db.batch<Record<string, unknown>>(statements);
  const lesson = results[0].results?.[0] as { user_id: string; title: string; spec: string } | undefined;
  if (!lesson) throw new ClaudeContextError('Lesson not found', 404);
  if (lesson.user_id !== userId) throw new ClaudeContextError('Access denied', 403);
  const found = exerciseAt(lesson.spec, ctx.exercise_key);
  if (!found) throw new ClaudeContextError('Exercise not found', 404);
  const type = String(found.exercise.type);
  const decks = (results[1].results ?? []) as Array<{ id: string; name: string }>;
  return {
    lessonTitle: lesson.title || found.title || 'Mini lesson',
    sectionTitle: found.sectionTitle,
    type,
    typeName: exerciseTypeInfo(type)?.name ?? type,
    exercise: found.exercise,
    answer: ctx.answer ?? null,
    decks: decks.length ? decks.map((d) => `${d.name} (id: ${d.id})`).join(', ') : 'none',
    language,
    knownWords: language === 'zh' ? ((results[2]?.results ?? []) as Array<{ hanzi: string }>).map((r) => r.hanzi).filter(Boolean) : [],
  };
}

/** The context block: the lesson, the exercise, his answer and its check. */
export function exerciseBlock(d: ExerciseData): string {
  const lines = [
    `The learner is doing the mini lesson "${d.lessonTitle}"${d.sectionTitle ? ` (section: ${d.sectionTitle})` : ''}.`,
    `The exercise they asked about — ${d.typeName} (type ${d.type}), its fields including the answer key:`,
    exerciseJson(d.exercise),
  ];
  const a = d.answer;
  if (a) {
    lines.push('', `Their answer: ${a.text}`);
    if (a.verdict) lines.push(`The app's check of it: ${a.verdict}${a.headline ? ` — ${a.headline}` : ''}`);
    if (a.corrected) lines.push(`Minimal fix: ${a.corrected}`);
    for (const t of a.tips ?? []) lines.push(`- Tip: ${t}`);
  } else {
    lines.push('', 'They have not answered it yet (or asked before answering).');
  }
  lines.push('', `The learner's decks (for create_flashcards): ${d.decks}`);
  return lines.join('\n');
}

export const exerciseContext: ContextProvider<'exercise', ExerciseData> = {
  kind: 'exercise',
  surface: 'exercise',
  policy: 'chat',
  maxTokens: EXERCISE_CHAT_MAX_TOKENS,
  maxRounds: 4,
  load: (env, ctx, input) => loadExerciseContext(env, ctx, input.userId, input.language ?? 'en'),
  persona: (d) => buildContextChatSystemBlocks('exercise', { language: d.language, knownWords: d.knownWords })[0],
  learner: (d) => buildContextChatSystemBlocks('exercise', { language: d.language, knownWords: d.knownWords })[1],
  systemBlock: (d) => exerciseBlock(d),
  tools: () => EXERCISE_TOOLS,
  toolContext: (_d, input) => ({ deckId: '', bumpSource: input.bumpSource ?? 'ask_claude' }),
  deferredAck: (tool) => (tool === 'create_flashcards' ? 'The cards will be saved when your reply is finished.' : `Tool ${tool} will be applied after your reply`),
  finish(text, input) {
    const answer = (input.language ?? 'en') === 'zh' ? plainAnswerText(text).trim() : text.trim();
    if (!answer) throw new StructuredCallError('Claude gave an empty answer', true);
    return answer;
  },
};
