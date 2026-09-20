/**
 * Helpers shared by the four tutor apps: registering an app tool with the
 * ext-apps metadata, loading the tutor's students, turning a 400 with
 * `problems` into an inline result the UI can show, and media URLs.
 */
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ApiError } from '../../api.js';
import { apiBaseUrl } from '../../types.js';
import { appServer } from '../apps.js';
import { guard, type ToolContext } from '../context.js';
import type { DashStudent, DashboardPayload, StudentPick } from './types.js';

type Shape = z.ZodRawShape;
type Args<S extends Shape> = z.objectOutputType<S, z.ZodTypeAny>;

export interface AppToolConfig<S extends Shape> {
  title: string;
  description: string;
  inputSchema: S;
  /** The `ui://` resource this tool belongs to (from `registerApp`). */
  resourceUri: string;
  /** App-only tools are called by the UI and hidden from the model. */
  appOnly?: boolean;
}

/**
 * Register one tool of an app. Errors thrown by the handler (API errors
 * included) become `isError` results instead of protocol failures.
 */
export function appTool<S extends Shape>(
  ctx: ToolContext,
  name: string,
  config: AppToolConfig<S>,
  handler: (args: Args<S>) => Promise<CallToolResult>,
): void {
  const cb = (args: Args<S>) => guard(() => handler(args));
  registerAppTool(
    appServer(ctx.server),
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      _meta: {
        ui: {
          resourceUri: config.resourceUri,
          ...(config.appOnly ? { visibility: ['app'] } : {}),
        },
      },
    },
    cb as unknown as Parameters<typeof registerAppTool<never, S>>[3],
  );
}

/** A result for the UI: `structuredContent` plus a short line for the model. */
export function appResult(text: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

/** Prefix for R2 keys served by the API's public `/api/audio/*` route. */
export function mediaBase(ctx: ToolContext): string {
  return `${apiBaseUrl(ctx.env)}/api/audio/`;
}

/**
 * Run an API write and, when the server rejected the payload with a
 * `problems` list (400 from the validators), return them instead of
 * throwing so the app can show them inline next to the fields.
 */
export async function withProblems<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; problems: string[] }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof ApiError && err.status === 400 && err.body && typeof err.body === 'object') {
      const body = err.body as { problems?: unknown; error?: unknown };
      if (Array.isArray(body.problems)) {
        return { ok: false, problems: body.problems.map((p) => String(p)) };
      }
      if (typeof body.error === 'string') return { ok: false, problems: [body.error] };
    }
    throw err;
  }
}

export interface DashboardResponse {
  students: DashStudent[];
  invites: DashboardPayload['invites'];
  homework_decks: DashboardPayload['homework_decks'];
  generated_at: string;
}

/** The tutor dashboard as the API returns it. */
export function loadDashboard(ctx: ToolContext, tzOffsetMinutes: number): Promise<DashboardResponse> {
  return ctx.api.get<DashboardResponse>('/api/tutor/dashboard', { tz_offset: tzOffsetMinutes });
}

export function studentName(s: DashStudent['student']): string {
  return s.name?.trim() || s.email || 'Student';
}

export function toStudentPick(s: DashStudent): StudentPick {
  return {
    relationship_id: s.relationship_id,
    student_id: s.student.id,
    name: studentName(s.student),
    email: s.student.email,
    picture_url: s.student.picture_url,
  };
}

/**
 * The tutor's active students (from the dashboard). An account with no
 * students — or a student-only account — gets an empty list rather than an
 * error, so the review apps still open for content that is not being sent
 * to anyone yet.
 */
export async function loadStudents(ctx: ToolContext): Promise<DashStudent[]> {
  try {
    const dash = await loadDashboard(ctx, 0);
    return dash.students;
  } catch (err) {
    console.warn('[tutor apps] dashboard unavailable, no students listed:', err instanceof Error ? err.message : err);
    return [];
  }
}

export const tzOffsetSchema = z
  .number()
  .int()
  .min(-840)
  .max(840)
  .optional()
  .describe("The tutor's timezone offset in minutes as Date.getTimezoneOffset() returns it (e.g. -600 for UTC+10). Days such as 'studied today' are bucketed in that zone. Default 0 (UTC).");
