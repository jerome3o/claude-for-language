/**
 * 梗 Meme review → "Make a mini lesson from this issue" (PROTOTYPE, docs/MEME_REVIEW.md).
 *
 * Reuses the app's lesson writer (the companion / mistake lessons' path: LESSON_WRITER_MODEL,
 * forced tool, thinking off, validateLessonSpec + up to two repair rounds, the 一 / 不 tone
 * changes) and creates a NORMAL custom lesson in the CALLER's own account through
 * createCustomLessonFromSpec (the pinyin checker, lesson pictures and audio as usual). It is never
 * sent to anyone. One job row per request in `meme_review_lessons`, run on meme-review-queue
 * (`{ kind: 'lesson', jobId }`); the page polls it. Rate-limited by the cost guard (`jobs`).
 */
import Anthropic from '@anthropic-ai/sdk';
import { validateLessonSpec, type CustomLessonSpec } from '@shared/lesson';
import { YI_BU_CONVENTION } from '@shared/pinyin/toneChange';
import { memeMonthLabel, type MemeIssue, type MemeLessonJob } from '@shared/meme-review';
import type { Env } from '../../types';
import { LESSON_SPEC_INPUT_SCHEMA, createCustomLessonFromSpec } from '../custom-lesson';
import { LESSON_SPEC_SCHEMA_TEXT, LESSON_STYLE_RULES } from '../lesson-editor';
import { LESSON_WRITER_MODEL, applyYiBuToSpec, withRetry, type CreateMessage } from '../companion-lesson';
import { trackServer } from '../analytics/server-events';
import { getMemeIssue, memeUsesFake, type MemeEnv } from './job';

const TOOL = 'create_lesson_spec';
const MAX_REPAIR_ROUNDS = 2;
const MAX_TOKENS = 16000;
/** A job generating longer than this is reported failed. */
const LESSON_STALE_MINUTES = 15;

export const MEME_LESSON_SYSTEM = `You write a MINI LESSON in a Chinese-learning app from this month's "梗 Meme review" — an issue explaining current Chinese internet memes to an intermediate learner (≈ HSK 4, about 30, a bit online). The lesson helps him actually understand and use the memes he just read about. About 8–12 minutes on a phone. Return the whole lesson with the ${TOOL} tool.

Build it like this (3 sections, 12–18 exercises in all):
1. "This month's memes" — one "note" per meme (5–8, the most useful first): title = the meme; body = what it means in plain English, where it comes from in one line, who says it and whether a foreigner sounds natural / cute / cringe using it; sentences = 1–2 of the issue's example lines with pinyin + english.
2. "Get the meaning" — a "match" (meme ↔ English gist, 4–8 pairs), 2–4 "choice" exercises on meanings or on which meme fits a situation (options = memes from the issue; explanation says why), 1–2 "listen_choice" on memes that sound alike or are easy to mix up.
3. "Use them" — 2 "scramble" of the issue's example lines, 2 "translate" (English → Chinese) of short realistic chat lines that need a meme, 1 "sentence_making" with 1–2 memes (a chat-message task and an example answer).
Use only the issue's memes and simple everyday words around them. Never invent facts about a meme's origin beyond what the issue says. Keep crude memes out of exercises unless the issue marks them as harmless. Simplified characters, mainland usage. Keep the issue's meme spelling exactly (Latin letters included, e.g. City不City).
title: "梗 · <Month> memes" in English (e.g. "梗 · October 2026 memes"); icon "😂"; description: one line.
Pinyin: tone marks, spaces between words, the 一 / 不 tone changes written: ${YI_BU_CONVENTION}

${LESSON_STYLE_RULES}

${LESSON_SPEC_SCHEMA_TEXT}`;

export function memeLessonBrief(issue: MemeIssue): string {
  const lines = [`Issue: ${issue.title} — ${issue.title_en} (${memeMonthLabel(issue.month)})`];
  for (const it of issue.items) {
    lines.push(
      `\n## ${it.hanzi} | ${it.pinyin} | ${it.english}`,
      `Meaning: ${it.meaning.hanzi} — ${it.meaning.english}`,
      `Origin: ${it.origin.text}`,
      `Who says it: ${it.register.who}; ${it.register.tone}; ${it.register.where}${it.register.crude ? '; CRUDE' : ''}`,
      `Would a foreigner say it: ${it.say_it.verdict} — ${it.say_it.note}`,
      ...it.examples.map((e) => `Example: ${e.hanzi} | ${e.pinyin} | ${e.english}`),
    );
  }
  return lines.join('\n');
}

export function memeLessonProblems(spec: CustomLessonSpec): string[] {
  const types = spec.sections.flatMap((s) => s.exercises.map((e) => e.type));
  const problems: string[] = [];
  if (types.length < 10) problems.push(`the lesson has ${types.length} exercises; it needs 12–18`);
  if (types.filter((t) => t === 'note').length < 3) problems.push('start with a "note" per meme');
  for (const t of ['match', 'choice', 'scramble', 'translate']) if (!types.includes(t as never)) problems.push(`add at least one "${t}" exercise`);
  return problems;
}

/** Write the spec: the companion lessons' writer path (forced tool, thinking off), validated, two repair rounds. */
export async function writeMemeLessonSpec(issue: MemeIssue, create: CreateMessage): Promise<CustomLessonSpec> {
  const title = `梗 · ${memeMonthLabel(issue.month)} memes`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Write the mini lesson for this issue. Its title is exactly "${title}".\n\n${memeLessonBrief(issue)}` }];
  let lastErrors: string[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const response = await withRetry(create, {
      model: LESSON_WRITER_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      system: MEME_LESSON_SYSTEM,
      tools: [{ name: TOOL, description: 'Return the complete lesson spec.', input_schema: LESSON_SPEC_INPUT_SCHEMA as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: TOOL },
      messages,
    });
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error(response.stop_reason === 'max_tokens' ? 'The lesson came back cut off' : 'No lesson in the reply');
    const raw = toolUse.input as CustomLessonSpec;
    if (raw && typeof raw === 'object') {
      raw.title = title;
      if (!raw.icon) raw.icon = '😂';
      applyYiBuToSpec(raw);
    }
    const errors = validateLessonSpec(raw);
    const shape = errors.length === 0 ? memeLessonProblems(raw) : [];
    if (errors.length === 0 && (shape.length === 0 || round === MAX_REPAIR_ROUNDS)) return raw;
    lastErrors = errors.length ? errors : shape;
    if (round === MAX_REPAIR_ROUNDS) break;
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Not right yet. Fix every problem below and call ${TOOL} again with the COMPLETE corrected spec:\n${lastErrors.map((e) => `- ${e}`).join('\n')}` }],
      },
    );
  }
  throw new Error(`Could not write a valid lesson: ${lastErrors.slice(0, 4).join('; ')}`);
}

/** E2E / no key: a deterministic lesson from the issue (no Claude call). */
export function fakeMemeLessonSpec(issue: MemeIssue): CustomLessonSpec {
  const items = issue.items.slice(0, 6);
  const pairs = items.map((it) => ({ hanzi: it.hanzi, pinyin: it.pinyin, english: it.english }));
  const first = items[0];
  const ex = first.examples[0];
  return applyYiBuToSpec({
    title: `梗 · ${memeMonthLabel(issue.month)} memes`,
    icon: '😂',
    description: `The memes of the ${memeMonthLabel(issue.month)} meme review.`,
    sections: [
      {
        title: 'This month’s memes',
        exercises: items.map((it) => ({ type: 'note' as const, title: it.hanzi, body: `${it.hanzi} ${it.pinyin} — ${it.english}. ${it.meaning.english}`, sentences: it.examples.slice(0, 1).map((e) => ({ hanzi: e.hanzi, pinyin: e.pinyin, english: e.english })) })),
      },
      {
        title: 'Get the meaning',
        exercises: [
          { type: 'match' as const, pairs },
          { type: 'choice' as const, question: `Which meme means “${first.english}”?`, options: items.slice(0, 3).map((it) => ({ hanzi: it.hanzi, pinyin: it.pinyin, english: it.english })), correct: 0, explanation: first.meaning.english },
        ],
      },
      {
        title: 'Use them',
        exercises: [{ type: 'translate' as const, english: ex.english, reference_hanzi: ex.hanzi, reference_pinyin: ex.pinyin }],
      },
    ],
  } as CustomLessonSpec);
}

// ---------- Jobs ----------

interface JobRow {
  id: string;
  user_id: string;
  month: string;
  status: string;
  lesson_id: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function toJob(row: JobRow): MemeLessonJob {
  return { id: row.id, month: row.month, status: row.status as MemeLessonJob['status'], lesson_id: row.lesson_id, error: row.error, created_at: row.created_at };
}

async function sweep(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`UPDATE meme_review_lessons SET status = 'failed', error = 'Writing the lesson stopped — try again.', updated_at = datetime('now') WHERE user_id = ? AND status = 'generating' AND updated_at < datetime('now', '-${LESSON_STALE_MINUTES} minutes')`)
    .bind(userId)
    .run();
}

/** The caller's latest lesson job for this month (the page: "Open your lesson" / "Writing…"). */
export async function latestMemeLessonJob(db: D1Database, userId: string, month: string): Promise<MemeLessonJob | null> {
  await sweep(db, userId);
  const row = await db.prepare('SELECT * FROM meme_review_lessons WHERE user_id = ? AND month = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(userId, month).first<JobRow>();
  return row ? toJob(row) : null;
}

export async function getMemeLessonJob(db: D1Database, userId: string, jobId: string): Promise<MemeLessonJob | null> {
  await sweep(db, userId);
  const row = await db.prepare('SELECT * FROM meme_review_lessons WHERE id = ? AND user_id = ?').bind(jobId, userId).first<JobRow>();
  return row ? toJob(row) : null;
}

type LessonEnv = MemeEnv & Env;

/** Start one (a job still generating is returned instead of a second). */
export async function requestMemeLesson(
  env: LessonEnv,
  userId: string,
  month: string,
  opts: { waitUntil?: (p: Promise<unknown>) => void } = {},
): Promise<{ job: MemeLessonJob | null; error?: string; status?: 404 | 409 }> {
  const record = await getMemeIssue(env.DB, month);
  if (record.status !== 'ready' || !record.issue) return { job: null, error: 'This issue isn’t ready yet.', status: 409 };
  const latest = await latestMemeLessonJob(env.DB, userId, month);
  if (latest?.status === 'generating') return { job: latest };
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO meme_review_lessons (id, user_id, month, status) VALUES (?, ?, ?, 'generating')`).bind(id, userId, month).run();
  if (env.MEME_REVIEW_QUEUE && env.E2E_TEST_MODE !== 'true') {
    await env.MEME_REVIEW_QUEUE.send({ kind: 'lesson', jobId: id });
  } else {
    const run = runMemeLessonJob(env, id).then((o) => console.log('[meme-review] lesson (inline)', id, o));
    if (opts.waitUntil) opts.waitUntil(run);
    else await run;
  }
  return { job: await getMemeLessonJob(env.DB, userId, id) };
}

export async function runMemeLessonJob(env: LessonEnv, jobId: string, deps: { create?: CreateMessage } = {}): Promise<'ready' | 'failed' | 'skipped'> {
  const row = await env.DB.prepare('SELECT * FROM meme_review_lessons WHERE id = ?').bind(jobId).first<JobRow>();
  if (!row || row.status !== 'generating') return 'skipped';
  const fail = async (message: string) => {
    await env.DB.prepare(`UPDATE meme_review_lessons SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).bind(message, jobId).run();
    return 'failed' as const;
  };
  const record = await getMemeIssue(env.DB, row.month);
  if (!record.issue) return fail('The issue is gone.');
  try {
    let spec: CustomLessonSpec;
    if (deps.create) spec = await writeMemeLessonSpec(record.issue, deps.create);
    else if (memeUsesFake(env)) spec = fakeMemeLessonSpec(record.issue);
    else {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 5 * 60 * 1000 });
      spec = await writeMemeLessonSpec(record.issue, (p) => client.messages.create(p));
    }
    const created = await createCustomLessonFromSpec(env, row.user_id, spec, 'api');
    if (!created.ok) return fail(`The lesson didn’t pass the checks: ${created.errors.slice(0, 2).join('; ')}`);
    await env.DB.prepare(`UPDATE meme_review_lessons SET status = 'ready', lesson_id = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`).bind(created.lesson.id, jobId).run();
    void trackServer('meme_review.lesson_ready', {}, { env, userId: row.user_id });
    return 'ready';
  } catch (error) {
    console.error('[meme-review] lesson failed:', jobId, error instanceof Error ? error.message : error);
    return fail('Claude couldn’t write the lesson right now — try again.');
  }
}
