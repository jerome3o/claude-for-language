/**
 * 🎬 "Learn more → ✨ Mini lesson" (docs/CLIPS.md): ONE mini lesson per clip, written from the
 * clip's words and idea with the app's lesson writer (forced tool, thinking off,
 * validateLessonSpec + up to two repair rounds, the 一 / 不 rule — the meme-review / companion
 * pattern) and created as a NORMAL custom lesson in the learner's OWN account
 * (createCustomLessonFromSpec: the pinyin checker, pictures, audio). Never sent to anyone. The
 * state lives on the clip row (lesson_status / lesson_id / lesson_error); runs on clip-queue.
 */
import Anthropic from '@anthropic-ai/sdk';
import { validateLessonSpec, type CustomLessonSpec } from '@shared/lesson';
import { YI_BU_CONVENTION } from '@shared/pinyin/toneChange';
import { clipTopic, parseStoredClipSpec, type ClipLessonState, type ClipSpec } from '@shared/clips';
import type { Env } from '../../types';
import { LESSON_SPEC_INPUT_SCHEMA, createCustomLessonFromSpec } from '../custom-lesson';
import { LESSON_SPEC_SCHEMA_TEXT, LESSON_STYLE_RULES } from '../lesson-editor';
import { LESSON_WRITER_MODEL, applyYiBuToSpec, withRetry, type CreateMessage } from '../companion-lesson';
import { trackServer } from '../analytics/server-events';
import { getClipRow } from './store';
import { clipsUseFake, dispatchClipJob } from './job';

const TOOL = 'create_lesson_spec';
const MAX_REPAIR_ROUNDS = 2;
const MAX_TOKENS = 16000;

export const CLIP_LESSON_SYSTEM = `You write a MINI LESSON in a Chinese-learning app that follows up a short video-style clip the learner just watched and liked. The lesson drills the clip's focus words and its ONE idea (a confusable pair, a pattern, a word's meaning) so he can use them. About 8 minutes on a phone. Return the whole lesson with the ${TOOL} tool.

Build it like this (2–3 sections, 10–14 exercises):
1. A short "note" recap of the idea (with 2–3 example sentences), then a "note" per focus word only when it needs one.
2. Practice: a "match" of the focus words, a "gap_choice" when the clip contrasts words (3–5 sentences, each option right at least once), 1–2 "listen_choice", 2 "scramble" of natural sentences using the words.
3. Use it: 1–2 "translate" (English → Chinese) and one "sentence_making" with 1–2 focus words in a real-life task.
Use the clip's own example sentences where they fit, and simple everyday words around them. Never add facts the clip doesn't give.
title: "🎬 <the clip's idea in English>" (≤ 60 chars); icon "🎬"; description: one line.
Pinyin: tone marks, spaces between words, the 一 / 不 tone changes written: ${YI_BU_CONVENTION}

${LESSON_STYLE_RULES}

${LESSON_SPEC_SCHEMA_TEXT}`;

/** The clip, as the lesson writer reads it. */
export function clipLessonBrief(spec: ClipSpec): string {
  const lines = [`Clip: ${spec.title} — ${spec.hook}`, `Topic: ${clipTopic(spec)}`, 'Focus words:', ...spec.words.map((w) => `- ${w.hanzi} | ${w.pinyin} | ${w.english}`), 'What the clip shows:'];
  for (const s of spec.scenes) {
    switch (s.layout) {
      case 'title': lines.push(`- Title: ${[s.title.headline_zh, s.title.headline_en, s.title.sub].filter(Boolean).join(' / ')}`); break;
      case 'big_word': lines.push(`- Word: ${s.big_word.hanzi} | ${s.big_word.pinyin} | ${s.big_word.english}`); break;
      case 'sentence': lines.push(`- Sentence: ${s.sentence.hanzi} | ${s.sentence.pinyin} | ${s.sentence.english}`); break;
      case 'compare': lines.push(`- Compare: ${s.compare.left.hanzi} (${s.compare.left.english}${s.compare.left.example ? `; e.g. ${s.compare.left.example}` : ''}) vs ${s.compare.right.hanzi} (${s.compare.right.english}${s.compare.right.example ? `; e.g. ${s.compare.right.example}` : ''})${s.compare.rule_en ? ` — rule: ${s.compare.rule_en}` : ''}`); break;
      case 'quiz': lines.push(`- Quiz: ${[s.quiz.prompt_zh, s.quiz.prompt_en].filter(Boolean).join(' / ')} → ${s.quiz.options[s.quiz.answer_index]}${s.quiz.explain ? ` (${s.quiz.explain})` : ''}`); break;
      case 'story': lines.push(...s.story.lines.map((l) => `- ${l.speaker ? `${l.speaker}: ` : ''}${l.hanzi} | ${l.pinyin} | ${l.english}`)); break;
      case 'list': lines.push(`- ${s.list.title ?? 'List'}: ${s.list.items.map((i) => `${i.hanzi} (${i.english})`).join('; ')}`); break;
      case 'fact': lines.push(`- Fact: ${s.fact.text_en}`); break;
      case 'listen': lines.push(`- Listening: ${s.listen.hanzi} | ${s.listen.pinyin} | ${s.listen.english}`); break;
      case 'order': lines.push(`- Word order: ${s.order.tiles.join(' ')} | ${s.order.pinyin} | ${s.order.english}`); break;
      case 'reveal': lines.push(`- Say it: ${s.reveal.prompt_en} → ${s.reveal.hanzi} | ${s.reveal.pinyin}`); break;
      case 'speak': lines.push(`- Speak: ${s.speak.hanzi} | ${s.speak.pinyin} | ${s.speak.english}`); break;
    }
  }
  return lines.join('\n');
}

export function clipLessonProblems(spec: CustomLessonSpec): string[] {
  const types = spec.sections.flatMap((s) => s.exercises.map((e) => e.type));
  const problems: string[] = [];
  if (types.length < 8) problems.push(`the lesson has ${types.length} exercises; it needs 10–14`);
  for (const t of ['note', 'match', 'scramble', 'translate']) if (!types.includes(t as never)) problems.push(`add at least one "${t}" exercise`);
  return problems;
}

export async function writeClipLessonSpec(spec: ClipSpec, create: CreateMessage): Promise<CustomLessonSpec> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Write the mini lesson that follows up this clip.\n\n${clipLessonBrief(spec)}` }];
  let lastErrors: string[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const response = await withRetry(create, {
      model: LESSON_WRITER_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      system: CLIP_LESSON_SYSTEM,
      tools: [{ name: TOOL, description: 'Return the complete lesson spec.', input_schema: LESSON_SPEC_INPUT_SCHEMA as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: TOOL },
      messages,
    });
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error(response.stop_reason === 'max_tokens' ? 'The lesson came back cut off' : 'No lesson in the reply');
    const raw = toolUse.input as CustomLessonSpec;
    if (raw && typeof raw === 'object') {
      if (!raw.icon) raw.icon = '🎬';
      applyYiBuToSpec(raw);
    }
    const errors = validateLessonSpec(raw);
    const shape = errors.length === 0 ? clipLessonProblems(raw) : [];
    if (errors.length === 0 && (shape.length === 0 || round === MAX_REPAIR_ROUNDS)) return raw;
    lastErrors = errors.length ? errors : shape;
    if (round === MAX_REPAIR_ROUNDS) break;
    messages.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Not right yet. Fix every problem below and call ${TOOL} again with the COMPLETE corrected spec:\n${lastErrors.map((e) => `- ${e}`).join('\n')}` }] },
    );
  }
  throw new Error(`Could not write a valid lesson: ${lastErrors.slice(0, 4).join('; ')}`);
}

/** E2E / no key: a deterministic lesson from the clip's words (no call). */
export function fakeClipLessonSpec(spec: ClipSpec): CustomLessonSpec {
  const words = spec.words.length >= 2 ? spec.words : [...spec.words, { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' }];
  return applyYiBuToSpec({
    title: `🎬 ${spec.title}`.slice(0, 60),
    icon: '🎬',
    description: `Follow-up practice for “${spec.title}”.`,
    sections: [
      { title: 'The idea', exercises: [{ type: 'note' as const, title: spec.title, body: spec.hook, sentences: words.map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.english })) }] },
      { title: 'Practice', exercises: [{ type: 'match' as const, pairs: words.map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.english })) }] },
    ],
  } as CustomLessonSpec);
}

/** Start (or return) the clip's one lesson. */
export async function requestClipLesson(
  env: Env,
  userId: string,
  clipId: string,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<{ lesson: ClipLessonState; started: boolean } | { error: string; status: 404 | 409 }> {
  const row = await getClipRow(env.DB, userId, clipId);
  if (!row) return { error: 'Not found', status: 404 };
  if (row.status !== 'ready' || !parseStoredClipSpec(row.spec)) return { error: 'This clip isn’t ready yet.', status: 409 };
  if (row.lesson_status === 'generating') return { lesson: { status: 'generating', lesson_id: null, error: null }, started: false };
  if (row.lesson_status === 'ready' && row.lesson_id) {
    const still = await env.DB.prepare('SELECT id FROM custom_lessons WHERE id = ? AND user_id = ?').bind(row.lesson_id, userId).first();
    if (still) return { lesson: { status: 'ready', lesson_id: row.lesson_id, error: null }, started: false };
  }
  await env.DB.prepare(`UPDATE clips SET lesson_status = 'generating', lesson_id = NULL, lesson_error = NULL, lesson_updated_at = datetime('now') WHERE id = ?`).bind(clipId).run();
  await dispatchClipJob(env, { kind: 'lesson', clipId }, waitUntil);
  const after = await getClipRow(env.DB, userId, clipId);
  return { lesson: { status: (after?.lesson_status ?? 'generating') as ClipLessonState['status'], lesson_id: after?.lesson_id ?? null, error: after?.lesson_error ?? null }, started: true };
}

export async function runClipLessonJob(env: Env, clipId: string, deps: { create?: CreateMessage } = {}): Promise<'ready' | 'failed' | 'skipped'> {
  const row = await env.DB.prepare('SELECT user_id, spec, lesson_status FROM clips WHERE id = ?').bind(clipId).first<{ user_id: string; spec: string | null; lesson_status: string | null }>();
  if (!row || row.lesson_status !== 'generating') return 'skipped';
  const fail = async (message: string) => {
    await env.DB.prepare(`UPDATE clips SET lesson_status = 'failed', lesson_error = ?, lesson_updated_at = datetime('now') WHERE id = ?`).bind(message, clipId).run();
    return 'failed' as const;
  };
  const spec = parseStoredClipSpec(row.spec);
  if (!spec) return fail('The clip is gone.');
  try {
    let lesson: CustomLessonSpec;
    if (deps.create) lesson = await writeClipLessonSpec(spec, deps.create);
    else if (clipsUseFake(env)) lesson = fakeClipLessonSpec(spec);
    else {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 5 * 60 * 1000 });
      lesson = await writeClipLessonSpec(spec, (p) => client.messages.create(p));
    }
    const created = await createCustomLessonFromSpec(env, row.user_id, lesson, 'api');
    if (!created.ok) return fail(`The lesson didn’t pass the checks: ${created.errors.slice(0, 2).join('; ')}`);
    await env.DB.prepare(`UPDATE clips SET lesson_status = 'ready', lesson_id = ?, lesson_error = NULL, lesson_updated_at = datetime('now') WHERE id = ?`).bind(created.lesson.id, clipId).run();
    void trackServer('server.content_created', { kind: 'lesson', count: 1, via: 'clip' }, { env, userId: row.user_id });
    return 'ready';
  } catch (error) {
    console.error('[clips] lesson failed:', clipId, error instanceof Error ? error.message : error);
    return fail('Claude couldn’t write the lesson right now — try again.');
  }
}
