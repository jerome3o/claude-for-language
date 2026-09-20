/**
 * `students_dashboard` app: one card per student (status, pills, words that
 * need attention with the wrong answers typed, setup checklist for new
 * students), pending invites and homework decks, with quick actions that
 * call back into the app-only tools below.
 */
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { registerApp } from '../apps.js';
import {
  appResult,
  appTool,
  loadDashboard,
  mediaBase,
  studentName,
  tzOffsetSchema,
} from './shared.js';
import type { DashRecording, DashStudent, DashboardPayload, StudentDetailPayload } from './types.js';

function dashboardSummary(students: DashStudent[]): string {
  if (students.length === 0) return 'No active students yet.';
  const lines = students.map((s) => {
    const name = studentName(s.student);
    if (s.is_new) return `- ${name}: getting set up (${s.setup.done_count}/${s.setup.steps.length} steps done)`;
    const bits = [
      s.status.studied_today ? 'studied today' : s.status.last_studied_at ? `last studied ${s.status.last_studied_at.slice(0, 10)}` : 'no study yet',
      s.status.streak_days > 0 ? `${s.status.streak_days}-day streak` : null,
      s.pills.struggling_words > 0 ? `${s.pills.struggling_words} words struggling` : null,
      s.pills.recordings_to_hear > 0 ? `${s.pills.recordings_to_hear} recordings to hear` : null,
      s.pills.homework_percent !== null ? `homework ${s.pills.homework_percent}%` : null,
    ].filter(Boolean);
    const words = s.needs_attention.slice(0, 5).map((n) => n.note.hanzi).join(' ');
    return `- ${name} (relationship ${s.relationship_id}): ${bits.join(', ')}${words ? ` — needs attention: ${words}` : ''}`;
  });
  return lines.join('\n');
}

async function buildDashboardPayload(ctx: ToolContext, tzOffset: number): Promise<DashboardPayload> {
  const dash = await loadDashboard(ctx, tzOffset);
  return {
    kind: 'students_dashboard',
    media_base: mediaBase(ctx),
    generated_at: dash.generated_at,
    tz_offset_minutes: tzOffset,
    students: dash.students,
    invites: dash.invites,
    homework_decks: dash.homework_decks,
  };
}

export function registerStudentsDashboardApp(ctx: ToolContext): void {
  const resourceUri = registerApp(ctx, 'students_dashboard');

  appTool(
    ctx,
    'open_students_dashboard',
    {
      title: 'Students dashboard',
      description:
        "Open the interactive Students dashboard for a tutor: one card per student with today's status, streak, words they are struggling with (and the wrong answers they typed), recordings waiting to be heard, homework progress and a setup checklist for new students, plus pending invite links and the tutor's homework decks. The tutor can expand a student, log a lesson, send a message, mark recordings as listened / needs work, and ask Claude for a summary or a review deck from the card. Open it when the tutor asks how their students are doing, wants to prepare for a lesson, or wants to act on a student's progress.",
      inputSchema: { tz_offset_minutes: tzOffsetSchema },
      resourceUri,
    },
    async ({ tz_offset_minutes }) => {
      const payload = await buildDashboardPayload(ctx, tz_offset_minutes ?? 0);
      const text =
        `Opened the Students dashboard (${payload.students.length} student${payload.students.length === 1 ? '' : 's'}, ` +
        `${payload.invites.length} pending invite${payload.invites.length === 1 ? '' : 's'}).\n${dashboardSummary(payload.students)}`;
      return appResult(text, payload as unknown as Record<string, unknown>);
    },
  );

  appTool(
    ctx,
    'app_refresh_dashboard',
    {
      title: 'Refresh dashboard',
      description: 'Reload the Students dashboard data (called by the dashboard UI).',
      inputSchema: { tz_offset_minutes: tzOffsetSchema },
      resourceUri,
      appOnly: true,
    },
    async ({ tz_offset_minutes }) => {
      const payload = await buildDashboardPayload(ctx, tz_offset_minutes ?? 0);
      return appResult(`Dashboard refreshed (${payload.students.length} students).`, payload as unknown as Record<string, unknown>);
    },
  );

  appTool(
    ctx,
    'app_student_detail',
    {
      title: 'Student detail',
      description: "One student's overview plus their recent recordings with marks (called by the dashboard UI when a card is expanded).",
      inputSchema: {
        relationship_id: z.string(),
        tz_offset_minutes: tzOffsetSchema,
      },
      resourceUri,
      appOnly: true,
    },
    async ({ relationship_id, tz_offset_minutes }) => {
      const [overview, insights] = await Promise.all([
        ctx.api.get<DashStudent>(`/api/relationships/${encodeURIComponent(relationship_id)}/overview`, {
          tz_offset: tz_offset_minutes ?? 0,
        }),
        ctx.api
          .get<{ recordings?: DashRecording[]; range?: { from: string; to: string }; since_lesson?: boolean }>(
            `/api/relationships/${encodeURIComponent(relationship_id)}/insights`,
          )
          .catch((err) => {
            console.warn('[students_dashboard] insights unavailable:', err instanceof Error ? err.message : err);
            return { recordings: [], range: undefined, since_lesson: false };
          }),
      ]);
      const payload: StudentDetailPayload = {
        overview,
        recordings: insights.recordings ?? [],
        range: insights.range ?? null,
        since_lesson: !!insights.since_lesson,
      };
      return appResult(
        `Loaded detail for ${studentName(overview.student)} (${payload.recordings.length} recordings in range).`,
        payload as unknown as Record<string, unknown>,
      );
    },
  );

  appTool(
    ctx,
    'app_log_lesson',
    {
      title: 'Log a lesson',
      description:
        "Record that a lesson with this student happened (called by the dashboard UI). Non-empty notes are also added to the student's lesson notes so they feed their daily reader.",
      inputSchema: {
        relationship_id: z.string(),
        lesson_at: z.string().optional().describe('ISO date-time of the lesson; default now'),
        notes: z.string().optional(),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ relationship_id, lesson_at, notes }) => {
      const res = await ctx.api.post<{ entry: { id: string; lesson_at: string; notes: string | null } }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/lesson-log`,
        { lesson_at: lesson_at ?? new Date().toISOString(), notes: notes ?? undefined },
      );
      return appResult(`Logged a lesson at ${res.entry.lesson_at}.`, { ok: true, entry: res.entry });
    },
  );

  appTool(
    ctx,
    'app_send_message',
    {
      title: 'Send a message',
      description: "Post a chat message to the student in the relationship's most recent conversation (called by the dashboard UI).",
      inputSchema: {
        relationship_id: z.string(),
        content: z.string().min(1).max(4000),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ relationship_id, content }) => {
      const open = await ctx.api.post<{ conversation_id: string; created: boolean }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/conversations/open`,
      );
      const message = await ctx.api.post<{ id: string; created_at: string }>(
        `/api/conversations/${encodeURIComponent(open.conversation_id)}/messages`,
        { content },
      );
      return appResult(`Message sent (conversation ${open.conversation_id}).`, {
        ok: true,
        conversation_id: open.conversation_id,
        message_id: message.id,
      });
    },
  );

  appTool(
    ctx,
    'app_mark_recording',
    {
      title: 'Mark a recording',
      description:
        "Mark a student's pronunciation recording as listened or needs work, with an optional comment the student sees once on the back of that card (called by the dashboard UI).",
      inputSchema: {
        relationship_id: z.string(),
        event_id: z.string().describe('The review event id of the recording'),
        status: z.enum(['listened', 'needs_work']),
        comment: z.string().max(2000).optional(),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ relationship_id, event_id, status, comment }) => {
      const res = await ctx.api.put<{ mark: DashRecording['mark'] }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/recordings/${encodeURIComponent(event_id)}/mark`,
        { status, comment: comment?.trim() ? comment.trim() : null },
      );
      return appResult(`Recording ${event_id} marked ${status}.`, { ok: true, mark: res.mark });
    },
  );
}
