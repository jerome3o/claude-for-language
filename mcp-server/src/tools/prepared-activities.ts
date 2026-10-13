/**
 * Prepared in-call activities (worker routes/prepared-activities.ts; docs/VIDEO_CALLS.md
 * "Prepared activities"): activities written for one student from their previous
 * lessons, waiting in the tutor's call menu. Tutor only. Nothing here reaches the
 * student — they are the tutor's material until she starts one in a call.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';
import { activityPreview, preparedHeadline, type PrepareJob, type PreparedActivity } from '../../../shared/call-activities';
import { coverageHeadline, type StudentCoverage } from '../../../shared/students/coverage';

export function trimPrepared(a: PreparedActivity) {
  return {
    id: a.id,
    kind: a.spec.kind,
    title: a.spec.title,
    ...(a.spec.title_zh ? { title_zh: a.spec.title_zh } : {}),
    why: a.why,
    status: a.status,
    from: a.source_label,
    level: a.spec.level,
    summary: a.spec.summary,
    content: activityPreview(a.spec, 10),
    ...(a.used_at ? { used_at: a.used_at } : {}),
  };
}

function trimJob(j: PrepareJob | null) {
  if (!j) return null;
  return { id: j.id, status: j.status, trigger: j.trigger, created: j.created_count, ...(j.error ? { error: j.error } : {}), started: j.created_at, ...(j.cost_usd != null ? { cost_usd: j.cost_usd } : {}) };
}

export function registerPreparedActivityTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_prepared_activities',
    "The in-call activities prepared for one student's NEXT video lesson (written from their previous lessons: new words, corrections, struggles, homework — dictation, sentence building, quizzes, role-plays…), with why each one, what's in it and whether it was used; plus a summary of what the student has covered. Tutor only (relationship_id from list_students). These are the tutor's material — they appear in her call's ⋯ → Activities and are never sent to the student.",
    {
      relationship_id: z.string(),
      include_used: z.boolean().optional().describe('Also list the ones already played in a call (default true).'),
    },
    async ({ relationship_id, include_used }) =>
      guard(async () => {
        const rel = encodeURIComponent(relationship_id);
        const [r, cov] = await Promise.all([
          api.get<{ activities: PreparedActivity[]; job: PrepareJob | null; can_prepare: boolean }>(`/api/relationships/${rel}/prepared-activities`),
          api.get<{ coverage: StudentCoverage }>(`/api/relationships/${rel}/coverage`).catch(() => null),
        ]);
        const list = include_used === false ? r.activities.filter((a) => a.status === 'ready') : r.activities;
        const ready = r.activities.filter((a) => a.status === 'ready').length;
        return jsonResult({
          headline: preparedHeadline(ready),
          activities: list.map(trimPrepared),
          last_run: trimJob(r.job),
          ...(cov ? { covered: { headline: coverageHeadline(cov.coverage), lessons: cov.coverage.lessons, recent_words: cov.coverage.recent_words.map((w) => w.hanzi) } } : {}),
          note: 'Prepared in the tutor’s account only — the student sees an activity once the tutor starts it in a call.',
        });
      }),
  );

  server.tool(
    'prepare_activities',
    "Write a fresh set of in-call activities for one student's next video lesson from their previous lessons (the last lesson report, its corrections and new words, the board, words they struggle with or mix up, recent homework, the tutor's private profile). Takes about a minute; this waits up to ~90 s, then returns the status (poll list_prepared_activities). Creates nothing student-facing and sends nothing. Tutor only.",
    {
      relationship_id: z.string(),
      count: z.number().int().min(1).max(6).optional().describe('How many (default 5).'),
      wait: z.boolean().optional().describe('Wait for the result (default true).'),
    },
    async ({ relationship_id, count, wait }) =>
      guard(async () => {
        const rel = encodeURIComponent(relationship_id);
        const started = await api.post<{ job: PrepareJob; started: boolean }>(`/api/relationships/${rel}/prepared-activities`, count ? { count } : {});
        let job = started.job;
        const deadline = Date.now() + 90_000;
        while (wait !== false && (job.status === 'queued' || job.status === 'running') && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          job = (await api.get<{ job: PrepareJob | null }>(`/api/relationships/${rel}/prepared-activities`)).job ?? job;
        }
        if (job.status !== 'done') {
          return jsonResult({ status: job.status, ...(job.error ? { error: job.error } : {}), already_running: !started.started, message: job.status === 'failed' ? 'Preparing failed.' : 'Still preparing — check list_prepared_activities in a minute.' });
        }
        const r = await api.get<{ activities: PreparedActivity[] }>(`/api/relationships/${rel}/prepared-activities`);
        const fresh = r.activities.filter((a) => a.job_id === job.id);
        return jsonResult({ status: 'done', created: fresh.map(trimPrepared), cost_usd: job.cost_usd, note: 'Saved for the tutor’s next call (⋯ → 🎲 Activities). Nothing was sent to the student.' });
      }),
  );
}
