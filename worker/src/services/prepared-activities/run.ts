/**
 * Prepared activities — the job (docs/VIDEO_CALLS.md "Prepared activities").
 *
 * Triggers, each idempotent by `idem_key`:
 * - a lesson report written (services/calls/processing.ts): `lesson:<id>:<calls>`
 *   — a report rewritten after another call joined the lesson prepares again and
 *   replaces that lesson's still-ready ones;
 * - the nightly catch-up (cron): a relationship whose newest lesson report or
 *   lesson-log notes are newer than its newest run, with few ready ones left;
 * - "Prepare activities" / "↻ Make more" (student page, call menu, MCP).
 *
 * Runs on call-processing-queue (message `prepare_activities`); under
 * E2E_TEST_MODE a manual run happens inline with a fake model. Nothing here
 * reaches the student: the rows are the tutor's until she starts one in a call.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Env, CallProcessingMessage } from '../../types';
import { trackServer } from '../analytics/server-events';
import { DEFAULT_PREPARE_COUNT, MAX_PREPARE_COUNT, prepareJobActive, type PrepareTrigger } from '@shared/call-activities';
import { loadActivityContext, newestSourceAt, relationshipPeople, type RelationshipPeople } from './context';
import { generatePreparedActivities } from './generate';
import { fakePrepareClient } from './fake';
import * as store from './store';

/** A job "running" longer than this was lost (a redelivery may take it over). */
const STALE_RUNNING_MS = 8 * 60_000;

export function canPrepare(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>): boolean {
  return !!env.ANTHROPIC_API_KEY || env.E2E_TEST_MODE === 'true';
}

function clientFor(env: Env): Pick<Anthropic, 'messages'> | undefined {
  return env.E2E_TEST_MODE === 'true' ? fakePrepareClient() : undefined;
}

/** "Lesson 3 Oct" / "Lesson notes 3 Oct" / null. */
function sourceLabel(date: string | null, kind: 'call' | 'notes' | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return kind === 'notes' ? `Lesson notes ${label}` : `Lesson ${label}`;
}

export interface QueuePrepareInput {
  people: RelationshipPeople;
  trigger: PrepareTrigger;
  idemKey: string;
  sourceLessonId?: string | null;
  count?: number;
}

/** Create the job (once per idem key) and queue it. Returns the job and whether it is new. */
export async function queuePrepare(env: Env, input: QueuePrepareInput): Promise<{ job: store.JobRow; created: boolean }> {
  const { job, created } = await store.insertJob(env.DB, {
    id: crypto.randomUUID(),
    relationshipId: input.people.relationshipId,
    tutorId: input.people.tutorId,
    studentId: input.people.studentId,
    idemKey: input.idemKey,
    trigger: input.trigger,
    sourceLessonId: input.sourceLessonId ?? null,
    count: Math.max(1, Math.min(MAX_PREPARE_COUNT, input.count ?? DEFAULT_PREPARE_COUNT)),
  });
  if (created) await env.CALL_QUEUE.send({ kind: 'prepare_activities', jobId: job.id } satisfies CallProcessingMessage);
  return { job, created };
}

/**
 * The tutor's "Prepare activities" / "Make more": one at a time per student
 * (an active job is returned instead). Under E2E_TEST_MODE it runs inline.
 */
export async function prepareNow(env: Env, people: RelationshipPeople, count?: number): Promise<{ job: store.JobRow; started: boolean }> {
  const latest = await store.latestJob(env.DB, people.relationshipId);
  if (latest && prepareJobActive(store.toJob(latest)) && Date.now() - Date.parse(`${latest.created_at.replace(' ', 'T')}Z`) < STALE_RUNNING_MS) {
    return { job: latest, started: false };
  }
  const { job } = await store.insertJob(env.DB, {
    id: crypto.randomUUID(),
    relationshipId: people.relationshipId,
    tutorId: people.tutorId,
    studentId: people.studentId,
    idemKey: `manual:${crypto.randomUUID()}`,
    trigger: 'manual',
    sourceLessonId: null,
    count: Math.max(1, Math.min(MAX_PREPARE_COUNT, count ?? DEFAULT_PREPARE_COUNT)),
  });
  if (env.E2E_TEST_MODE === 'true') {
    await runPrepareJob(env, job.id);
  } else {
    await env.CALL_QUEUE.send({ kind: 'prepare_activities', jobId: job.id } satisfies CallProcessingMessage);
  }
  return { job: (await store.getJob(env.DB, job.id)) ?? job, started: true };
}

/** Queue job: gather, generate, store. Safe to deliver twice. */
export async function runPrepareJob(env: Env, jobId: string, deps: { client?: Pick<Anthropic, 'messages'>; sleep?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const job = await store.getJob(env.DB, jobId);
  if (!job || job.status === 'done' || job.status === 'failed') return;
  if (job.status === 'running' && job.started_at && Date.now() - Date.parse(`${job.started_at.replace(' ', 'T')}Z`) < STALE_RUNNING_MS) return;
  const started = Date.now();
  await store.patchJob(env.DB, jobId, { status: 'running', started_at: store.sqlNow() });
  try {
    if (!canPrepare(env) && !deps.client) throw new Error('No Claude API key is configured');
    const people = await relationshipPeople(env.DB, job.relationship_id);
    if (!people) throw new Error('The relationship is no longer active');
    const ctx = await loadActivityContext(env.DB, people);
    const result = await generatePreparedActivities({
      apiKey: env.ANTHROPIC_API_KEY ?? '',
      ctx,
      count: job.count,
      idFor: (i) => `${job.id}-${i + 1}`,
      client: deps.client ?? clientFor(env),
      sleep: deps.sleep,
    });
    if (result.refused.length) console.warn('[prepared-activities] refused after repair:', JSON.stringify(result.refused).slice(0, 2000));
    if (result.activities.length === 0) throw new Error('Claude wrote no activity that passed the checks');
    const label = ctx.lastLesson
      ? sourceLabel(ctx.lastLesson.date, 'call')
      : ctx.newerNotes[0]
        ? sourceLabel(ctx.newerNotes[0].date, 'notes')
        : null;
    // A run from a lesson report follows THAT lesson; others note the newest source they read.
    const fresh = { ...job, source_lesson_id: job.source_lesson_id ?? ctx.lastLesson?.id ?? null };
    await store.insertActivities(env.DB, fresh, label, result.activities);
    await store.tidyReady(env.DB, job);
    await store.patchJob(env.DB, jobId, {
      status: 'done',
      error: null,
      created_count: result.activities.length,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cost_usd: Math.round(result.cost_usd * 10_000) / 10_000,
      finished_at: store.sqlNow(),
    });
    await trackServer(
      'server.prepared_activities',
      { trigger: job.trigger, count: result.activities.length, refused: result.refused.length, rounds: result.rounds, input_tokens: result.input_tokens, output_tokens: result.output_tokens, ms: Date.now() - started },
      { env, userId: job.tutor_id },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[prepared-activities] job failed:', jobId, message);
    await store.patchJob(env.DB, jobId, { status: 'failed', error: message.slice(0, 300), finished_at: store.sqlNow() });
  }
}

/** After a lesson report is written: prepare for the next lesson with that student. Never throws. */
export async function prepareAfterLesson(env: Env, lessonId: string): Promise<void> {
  try {
    if (!canPrepare(env)) return;
    const lesson = await env.DB
      .prepare(`SELECT id, relationship_id, summary_json, report_call_ids FROM call_lessons WHERE id = ?`)
      .bind(lessonId)
      .first<{ id: string; relationship_id: string | null; summary_json: string | null; report_call_ids: string | null }>();
    if (!lesson?.relationship_id || !lesson.summary_json) return;
    const report = JSON.parse(lesson.summary_json) as { vocabulary?: unknown[]; corrections?: unknown[]; topics?: unknown[] };
    // A call that was only a test / troubleshooting leaves nothing to practise.
    if ((report.vocabulary?.length ?? 0) + (report.corrections?.length ?? 0) < 3) return;
    const people = await relationshipPeople(env.DB, lesson.relationship_id);
    if (!people) return;
    await queuePrepare(env, { people, trigger: 'lesson', idemKey: `lesson:${lessonId}:${lesson.report_call_ids ?? ''}`, sourceLessonId: lessonId });
  } catch (err) {
    console.error('[prepared-activities] after-lesson queue failed:', lessonId, err);
  }
}

/**
 * Nightly catch-up: relationships whose newest lesson report / lesson-log notes
 * (last 21 days) are newer than their newest run and that have fewer than 3
 * ready activities. At most `limit` a night.
 */
export async function prepareNightly(env: Env, now = new Date(), limit = 25): Promise<number> {
  if (!canPrepare(env) || env.E2E_TEST_MODE === 'true') return 0;
  const since = store.sqlNow(now.getTime() - 21 * 86_400_000);
  const rels = await env.DB
    .prepare(
      `SELECT DISTINCT relationship_id AS id FROM (
         SELECT relationship_id FROM call_lessons WHERE relationship_id IS NOT NULL AND summary_json IS NOT NULL AND datetime(started_at / 1000, 'unixepoch') >= ?1
         UNION ALL
         SELECT relationship_id FROM tutor_lesson_log WHERE created_at >= ?1 AND notes IS NOT NULL AND notes <> ''
       ) LIMIT 200`,
    )
    .bind(since)
    .all<{ id: string }>();
  let queued = 0;
  const date = now.toISOString().slice(0, 10);
  for (const { id } of rels.results ?? []) {
    if (queued >= limit) break;
    const [newest, latest, ready] = await Promise.all([
      newestSourceAt(env.DB, id),
      store.latestJob(env.DB, id),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM prepared_activities WHERE relationship_id = ? AND status = 'ready'`).bind(id).first<{ n: number }>(),
    ]);
    if (!newest) continue;
    if (latest && latest.created_at >= newest) continue;
    if ((ready?.n ?? 0) >= 3) continue;
    const people = await relationshipPeople(env.DB, id);
    if (!people) continue;
    const { created } = await queuePrepare(env, { people, trigger: 'nightly', idemKey: `nightly:${id}:${date}` });
    if (created) queued++;
  }
  return queued;
}
