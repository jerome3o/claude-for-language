/**
 * `review_lesson` app: a mini lesson section by section with every exercise
 * rendered by type and editable, saved through the lesson library
 * (`PUT /api/lesson-library/:id`) or a student's copy (`PUT /api/lessons/:id`),
 * assigned to students and pushed to the copies that are behind.
 */
import { z } from 'zod';
import { validateLessonSpec } from '../../../../shared/lesson/validate';
import type { ToolContext } from '../context.js';
import { registerApp } from '../apps.js';
import { appResult, appTool, loadStudents, mediaBase, toStudentPick, withProblems } from './shared.js';
import type { AssignResult, CustomLessonSpec, LessonAssignment, LessonPayload, LessonSaveResult } from './types.js';

interface LibraryItemResponse {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  spec: CustomLessonSpec;
  assignment_count?: number;
}

interface StudentLessonResponse {
  id: string;
  user_id: string;
  title: string;
  status: string;
  updated_at: string;
  library_item_id: string | null;
  assigned_relationship_id: string | null;
  spec: CustomLessonSpec;
  is_owner: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  note: 'note',
  scramble: 'word order',
  choice: 'multiple choice',
  translate: 'translate',
  match: 'match pairs',
  describe_image: 'describe picture',
  speak: 'speak',
  listen_choice: 'listen & pick',
  listen_translate: 'listen & translate',
};

export function lessonSummary(spec: CustomLessonSpec): string {
  const sections = spec.sections.map((s, i) => {
    const kinds = s.exercises.map((e) => TYPE_LABELS[e.type] ?? e.type).join(', ');
    return `${i + 1}. ${s.title ?? 'Untitled section'} — ${s.exercises.length} exercise${s.exercises.length === 1 ? '' : 's'} (${kinds})`;
  });
  return `${spec.icon ?? '🎓'} ${spec.title}${spec.description ? ` — ${spec.description}` : ''}\n${sections.join('\n')}`;
}

async function loadAssignments(ctx: ToolContext, libraryItemId: string): Promise<LessonAssignment[]> {
  try {
    const res = await ctx.api.get<{ assignments: LessonAssignment[] }>(
      `/api/lesson-library/${encodeURIComponent(libraryItemId)}/assignments`,
    );
    return res.assignments ?? [];
  } catch (err) {
    console.warn('[review_lesson] assignments unavailable:', err instanceof Error ? err.message : err);
    return [];
  }
}

export function registerLessonApp(ctx: ToolContext): void {
  const resourceUri = registerApp(ctx, 'review_lesson');

  appTool(
    ctx,
    'review_lesson',
    {
      title: 'Review a lesson',
      description:
        'Open a mini lesson in the interactive reviewer: every section and exercise rendered by type (note text and sentences, word-order tiles, multiple choice with the answer marked, translate, match pairs, describe picture, speak, listen & pick, listen & translate), editable in place with add / remove / reorder, plus Save, Assign to students, Push update to copies that are behind, and an "Ask Claude to revise" box. After drafting or editing a lesson in the tutor\'s library (or when the tutor asks to see, check, tweak, assign or update one), open it here so the tutor can review and send it. Pass library_item_id for a library item (preferred) or lesson_id for a student\'s copy.',
      inputSchema: {
        library_item_id: z.string().optional().describe("A lesson library item id (the tutor's master copy)"),
        lesson_id: z.string().optional().describe("A student's lesson id (their own copy) when there is no library item"),
      },
      resourceUri,
    },
    async ({ library_item_id, lesson_id }) => {
      if (!library_item_id && !lesson_id) {
        return { content: [{ type: 'text', text: 'Pass library_item_id or lesson_id.' }], isError: true };
      }
      const students = (await loadStudents(ctx)).map(toStudentPick);
      let payload: LessonPayload;
      if (library_item_id) {
        const [item, assignments] = await Promise.all([
          ctx.api.get<LibraryItemResponse>(`/api/lesson-library/${encodeURIComponent(library_item_id)}`),
          loadAssignments(ctx, library_item_id),
        ]);
        payload = {
          kind: 'review_lesson',
          target: 'library',
          item: {
            id: item.id,
            title: item.title,
            version: item.version ?? null,
            tags: item.tags ?? [],
            updated_at: item.updated_at ?? null,
            is_owner: null,
            library_item_id: null,
          },
          spec: item.spec,
          media_base: mediaBase(ctx),
          assignments,
          students,
        };
      } else {
        const lesson = await ctx.api.get<StudentLessonResponse>(`/api/lessons/${encodeURIComponent(lesson_id!)}`);
        payload = {
          kind: 'review_lesson',
          target: 'lesson',
          item: {
            id: lesson.id,
            title: lesson.title,
            version: null,
            tags: [],
            updated_at: lesson.updated_at ?? null,
            is_owner: !!lesson.is_owner,
            library_item_id: lesson.library_item_id ?? null,
          },
          spec: lesson.spec,
          media_base: mediaBase(ctx),
          assignments: [],
          students,
        };
      }
      return appResult(
        `Opened ${payload.target === 'library' ? 'library lesson' : 'lesson'} ${payload.item.id} for review.\n${lessonSummary(payload.spec)}`,
        payload as unknown as Record<string, unknown>,
      );
    },
  );

  const saveResult = (title: string, r: LessonSaveResult, id: string) =>
    appResult(
      r.ok ? `${title} ${id} saved.\n${r.spec ? lessonSummary(r.spec) : ''}` : `${title} not saved: ${(r.problems ?? []).join('; ')}`,
      r as unknown as Record<string, unknown>,
    );

  appTool(
    ctx,
    'app_save_library_lesson',
    {
      title: 'Save library lesson',
      description: "Replace a library item's lesson spec (called by the lesson UI). The version bumps when the content changed.",
      inputSchema: {
        library_item_id: z.string(),
        spec: z.record(z.unknown()).describe('The full lesson spec'),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ library_item_id, spec }) => {
      const problems = validateLessonSpec(spec);
      if (problems.length > 0) return saveResult('Lesson', { ok: false, problems }, library_item_id);
      const saved = await withProblems(() =>
        ctx.api.put<LibraryItemResponse>(`/api/lesson-library/${encodeURIComponent(library_item_id)}`, { spec }),
      );
      if (!saved.ok) return saveResult('Lesson', { ok: false, problems: saved.problems }, library_item_id);
      return saveResult('Lesson', { ok: true, spec: saved.value.spec, version: saved.value.version ?? null }, library_item_id);
    },
  );

  appTool(
    ctx,
    'app_save_lesson',
    {
      title: 'Save lesson',
      description: "Replace a student's lesson spec in place (called by the lesson UI). Same id, so completion history and schedule are kept.",
      inputSchema: {
        lesson_id: z.string(),
        spec: z.record(z.unknown()).describe('The full lesson spec'),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ lesson_id, spec }) => {
      const problems = validateLessonSpec(spec);
      if (problems.length > 0) return saveResult('Lesson', { ok: false, problems }, lesson_id);
      const saved = await withProblems(() =>
        ctx.api.put<StudentLessonResponse>(`/api/lessons/${encodeURIComponent(lesson_id)}`, { spec }),
      );
      if (!saved.ok) return saveResult('Lesson', { ok: false, problems: saved.problems }, lesson_id);
      return saveResult('Lesson', { ok: true, spec: saved.value.spec, version: null }, lesson_id);
    },
  );

  appTool(
    ctx,
    'app_assign_lesson',
    {
      title: 'Assign lesson',
      description: 'Assign a library lesson to students (called by the lesson UI). Creates a copy for each student who does not have it yet.',
      inputSchema: {
        library_item_id: z.string(),
        relationship_ids: z.array(z.string()).min(1),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ library_item_id, relationship_ids }) => {
      const res = await ctx.api.post<Omit<AssignResult, 'assignments'>>(
        `/api/lesson-library/${encodeURIComponent(library_item_id)}/assign`,
        { relationship_ids },
      );
      const result: AssignResult = {
        assigned: res.assigned ?? [],
        already_had: res.already_had ?? [],
        errors: res.errors ?? [],
        assignments: await loadAssignments(ctx, library_item_id),
      };
      return appResult(
        `Assigned to ${result.assigned.length} student(s); ${result.already_had.length} already had it; ${result.errors.length} error(s).`,
        result as unknown as Record<string, unknown>,
      );
    },
  );

  appTool(
    ctx,
    'app_push_lesson_update',
    {
      title: 'Push lesson update',
      description: "Overwrite students' copies of a library lesson that are behind the library version (called by the lesson UI).",
      inputSchema: {
        library_item_id: z.string(),
        relationship_ids: z.array(z.string()).optional().describe('Limit to these students; default all copies that are behind'),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ library_item_id, relationship_ids }) => {
      const res = await ctx.api.post<{ updated: number; skipped: number }>(
        `/api/lesson-library/${encodeURIComponent(library_item_id)}/push-update`,
        relationship_ids ? { relationship_ids } : {},
      );
      const assignments = await loadAssignments(ctx, library_item_id);
      return appResult(`Pushed the update to ${res.updated} cop${res.updated === 1 ? 'y' : 'ies'} (${res.skipped} already up to date).`, {
        ok: true,
        updated: res.updated,
        skipped: res.skipped,
        assignments,
      });
    },
  );
}
