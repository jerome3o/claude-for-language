/**
 * ＋ Add tab → "🎯 Mini lesson" (docs/ADD_TAB.md): the learner says what a lesson should practise and
 * Claude writes it — the library's lesson writer (`generateLessonSpec`, services/lesson-editor.ts) —
 * into his OWN Mini Lessons (`createCustomLessonFromSpec`: validated, pinyin-checked, illustrations
 * queued). One `lesson_requests` row per request (migration 0153), run on coach-reply-queue
 * (`{ kind: 'lesson_request', jobId }`; inline in E2E), so the page can say "✓ Making your mini
 * lesson…" and then "Open ›". Nothing is sent to anyone.
 */
import type { Env } from '../types';
import { SAMPLE_LESSONS } from '@shared/lesson/samples';
import type { CustomLessonSpec } from '@shared/lesson';
import { createCustomLessonFromSpec } from './custom-lesson';
import { generateLessonSpec } from './lesson-editor';

export const LESSON_REQUEST_PROMPT_MAX = 600;
/** A request still "generating" after this long is marked failed (the delivery died). */
const STALE_MINUTES = 15;

export interface LessonRequestQueueMessage {
  kind: 'lesson_request';
  jobId: string;
}

export interface LessonRequest {
  id: string;
  prompt: string;
  status: 'generating' | 'ready' | 'failed';
  lesson_id: string | null;
  error: string | null;
  created_at: string;
}

interface Row extends LessonRequest {
  user_id: string;
}

function shape(row: Row): LessonRequest {
  return { id: row.id, prompt: row.prompt, status: row.status, lesson_id: row.lesson_id, error: row.error, created_at: row.created_at };
}

export async function getLessonRequest(db: D1Database, userId: string, id: string): Promise<LessonRequest | null> {
  await db
    .prepare(`UPDATE lesson_requests SET status = 'failed', error = 'Writing the lesson stopped — try again.', updated_at = datetime('now') WHERE id = ? AND status = 'generating' AND updated_at < datetime('now', '-${STALE_MINUTES} minutes')`)
    .bind(id)
    .run();
  const row = await db.prepare('SELECT * FROM lesson_requests WHERE id = ? AND user_id = ?').bind(id, userId).first<Row>();
  return row ? shape(row) : null;
}

/** A lesson the E2E run can make without a model: the first catalogue sample, retitled. */
export function fakeRequestedLesson(prompt: string): CustomLessonSpec {
  const spec = JSON.parse(JSON.stringify(SAMPLE_LESSONS[0].spec)) as CustomLessonSpec;
  spec.title = `Mini lesson: ${prompt.slice(0, 40)}`;
  return spec;
}

export async function startLessonRequest(
  env: Env,
  userId: string,
  prompt: string,
  opts: { waitUntil?: (p: Promise<unknown>) => void } = {},
): Promise<LessonRequest> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO lesson_requests (id, user_id, prompt, status) VALUES (?, ?, ?, 'generating')`).bind(id, userId, prompt).run();
  if (env.COACH_REPLY_QUEUE && env.E2E_TEST_MODE !== 'true') {
    await env.COACH_REPLY_QUEUE.send({ kind: 'lesson_request', jobId: id });
  } else {
    const run = runLessonRequest(env, id).then((o) => console.log('[lesson-request] (inline)', id, o));
    if (opts.waitUntil) opts.waitUntil(run);
    else await run;
  }
  return (await getLessonRequest(env.DB, userId, id))!;
}

export async function runLessonRequest(
  env: Env,
  jobId: string,
  deps: { write?: (prompt: string) => Promise<CustomLessonSpec> } = {},
): Promise<'ready' | 'failed' | 'skipped'> {
  const row = await env.DB.prepare('SELECT * FROM lesson_requests WHERE id = ?').bind(jobId).first<Row>();
  if (!row || row.status !== 'generating') return 'skipped';
  const fail = async (message: string) => {
    await env.DB.prepare(`UPDATE lesson_requests SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).bind(message, jobId).run();
    return 'failed' as const;
  };
  try {
    const write =
      deps.write ??
      (env.E2E_TEST_MODE === 'true'
        ? async (p: string) => fakeRequestedLesson(p)
        : (p: string) => generateLessonSpec(env.ANTHROPIC_API_KEY, p, { learner: 'A learner of Mandarin Chinese making a lesson for themselves' }));
    const spec = await write(row.prompt);
    const created = await createCustomLessonFromSpec(env, row.user_id, spec, 'api');
    if (!created.ok) return fail(`The lesson didn’t pass the checks: ${created.errors.slice(0, 2).join('; ')}`);
    await env.DB.prepare(`UPDATE lesson_requests SET status = 'ready', lesson_id = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`).bind(created.lesson.id, jobId).run();
    return 'ready';
  } catch (error) {
    console.error('[lesson-request] failed:', jobId, error instanceof Error ? error.message : error);
    return fail('Claude couldn’t write the lesson right now — try again.');
  }
}
