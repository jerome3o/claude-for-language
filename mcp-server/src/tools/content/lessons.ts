/**
 * Lesson library tools for tutors: the library holds master copies of custom
 * mini lessons; assigning creates a real lesson row for the student (works
 * offline) that remembers where it came from, and push-update overwrites the
 * copies in place so completion history and FSRS scheduling survive.
 */
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { jsonResult, textResult, errorResult, guard } from '../context.js';
import { LESSON_SPEC_DOC, lessonSpecProblems, formatProblems } from './specs.js';
import { CONFIRM_SEND, NEEDS_CONFIRM, NOT_SENT, SEND_DUE_DATE, SEND_MODE, SEND_RULE, SEND_TODAY, assignLessonAsHomework, describeSend, resolveStudent, sentTo, type ResolvedStudent } from '../homework-send.js';

const LIBRARY_ID = z.string().describe('The library item id (from list_lesson_library)');
const RELATIONSHIP_ID = z.string().describe('The tutor–student relationship id (from list_students or the students tools)');

/** Loose zod shape for a lesson spec: the real validation is validateLessonSpec. */
const lessonSpecShape = z.object({
  title: z.string().describe("Short lesson title, e.g. 'Ordering at a café'"),
  icon: z.string().optional().describe('One emoji for the lesson (default 🎓)'),
  description: z.string().optional().describe('One sentence on what the lesson covers'),
  sections: z.array(z.object({
    title: z.string().optional().describe('Optional section heading'),
    exercises: z.array(z.record(z.unknown())).describe('Exercise objects as documented in the tool description'),
  })).describe('Ordered sections of exercises'),
}).passthrough();

const tagsShape = z.array(z.string()).optional().describe('Free-form tags for organising the library, e.g. ["HSK1", "tones"]');

interface LibraryItem {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  spec?: unknown;
  assignment_count?: number;
  exercise_count?: number;
}

export function registerLessonLibraryTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_lesson_library',
    `List the tutor's lesson library — the master copies of custom mini lessons they can assign to students (id, title, description, icon, tags, version, assignment_count, exercise_count, timestamps). Archived items are not shown. This is the tutor's own library; a student's lessons (assigned or self-made) come from list_student_lessons. Use get_library_lesson for the full spec.`,
    {},
    async () => guard(async () => {
      const res = await api.get<{ items: LibraryItem[] }>('/api/lesson-library');
      return jsonResult({ count: res.items.length, items: res.items });
    }),
  );

  server.tool(
    'get_library_lesson',
    'Get one library lesson with its FULL spec (title, icon, description, sections of exercises), tags, version and how many students it is assigned to. Fetch this before update_library_lesson so you edit the existing content rather than rewriting from memory.',
    { library_id: LIBRARY_ID },
    async ({ library_id }) => guard(async () => {
      const item = await api.get<LibraryItem>(`/api/lesson-library/${encodeURIComponent(library_id)}`);
      return jsonResult(item);
    }),
  );

  server.tool(
    'create_library_lesson',
    `Add a lesson to the tutor's library, either from a spec you author (pass "spec") or drafted by Claude server-side from a brief (pass "generate_prompt", e.g. "A2 lesson on 了 for completed actions, 6 exercises, include two listening items"). A library lesson is a master copy in the TUTOR's account: nothing reaches a student until the tutor asks you to send it (assign_lesson_to_students with confirm: true). Specs are validated locally and by the API; problems come back as a list to fix and retry.
${LESSON_SPEC_DOC}`,
    {
      spec: lessonSpecShape.optional().describe('The complete lesson spec (omit when using generate_prompt)'),
      generate_prompt: z.string().optional().describe('Brief for Claude to draft the lesson from (omit when passing spec)'),
      learner: z.string().optional().describe('Optional note about the learner for generate_prompt, e.g. "adult beginner, 3 months in, struggles with tones"'),
      tags: tagsShape,
    },
    async ({ spec, generate_prompt, learner, tags }) => guard(async () => {
      if (!spec && !generate_prompt?.trim()) return errorResult('Pass either spec or generate_prompt.');
      if (spec && generate_prompt?.trim()) return errorResult('Pass spec OR generate_prompt, not both.');
      let body: Record<string, unknown>;
      if (spec) {
        const problems = lessonSpecProblems(spec);
        if (problems.length > 0) return errorResult(formatProblems('Lesson spec', problems));
        body = { spec, tags };
      } else {
        body = { generate: { prompt: generate_prompt!.trim(), learner }, tags };
      }
      const item = await api.post<LibraryItem>('/api/lesson-library', body);
      return jsonResult({
        id: item.id,
        title: item.title,
        version: item.version,
        tags: item.tags,
        exercise_count: countExercises(item.spec),
        spec: spec ? undefined : item.spec,
        sent: false,
        message: `Added "${item.title}" to your lesson library (id=${item.id}). ${NOT_SENT} When the tutor asks, send it with assign_lesson_to_students(library_id="${item.id}", relationship_ids=[…], confirm: true).`,
      });
    }),
  );

  server.tool(
    'update_library_lesson',
    `Replace a library lesson's content with a FULL spec (and optionally its tags). The library version bumps when the content changed; students who already have a copy keep the OLD content until push_lesson_update (only when the tutor asks) (get_lesson_assignments shows who is behind). Fetch with get_library_lesson first and edit. Same exercise types and rules as create_library_lesson.`,
    {
      library_id: LIBRARY_ID,
      spec: lessonSpecShape.describe('The complete revised spec — it replaces the stored one entirely'),
      tags: tagsShape.describe('New tags (omit to keep the current ones)'),
    },
    async ({ library_id, spec, tags }) => guard(async () => {
      const problems = lessonSpecProblems(spec);
      if (problems.length > 0) return errorResult(formatProblems('Lesson spec', problems));
      const item = await api.put<LibraryItem>(`/api/lesson-library/${encodeURIComponent(library_id)}`, tags === undefined ? { spec } : { spec, tags });
      return jsonResult({
        id: item.id,
        title: item.title,
        version: item.version,
        tags: item.tags,
        assignment_count: item.assignment_count,
        message: `Updated "${item.title}" (version ${item.version}).${item.assignment_count ? ` ${item.assignment_count} student copy/copies still have the previous content — push_lesson_update to bring them up to date.` : ''}`,
      });
    }),
  );

  server.tool(
    'duplicate_library_lesson',
    'Copy a library lesson as "Copy of …" (same spec and tags, no assignments) — handy for making a variant for another student.',
    { library_id: LIBRARY_ID },
    async ({ library_id }) => guard(async () => {
      const item = await api.post<LibraryItem>(`/api/lesson-library/${encodeURIComponent(library_id)}/duplicate`);
      return jsonResult({ id: item.id, title: item.title, sent: false, message: `Duplicated as "${item.title}" (id=${item.id}). ${NOT_SENT}` });
    }),
  );

  server.tool(
    'archive_library_lesson',
    'Archive a library lesson so it no longer shows in the library. Copies already assigned to students are untouched.',
    { library_id: LIBRARY_ID },
    async ({ library_id }) => guard(async () => {
      await api.delete(`/api/lesson-library/${encodeURIComponent(library_id)}`);
      return textResult(`Archived library lesson ${library_id}.`);
    }),
  );

  server.tool(
    'assign_lesson_to_students',
    `${SEND_RULE} Give a library lesson to one or more students AS HOMEWORK (a real homework assignment per student, like the app's Send homework sheet): each gets their own copy (works offline) that remembers this library item. By default (\`mode: "both"\`) it is on their Homework list due by \`due_date\` (default: that student's next logged lesson, else in two days) AND mixed into their study sessions, scheduled with FSRS like their cards; "one_off" = the homework pass only (never in the session mix), "fsrs" = study sessions only, no date. You must be the tutor in every relationship. A student who already has a copy is reported under already_had and left as is (use assign_homework to give them a new dated assignment on it); per-relationship failures come back under errors. describe_image illustrations are generated in the background.`,
    {
      library_id: LIBRARY_ID,
      relationship_ids: z.array(z.string()).min(1).describe('Relationship ids of the students to assign to'),
      mode: SEND_MODE,
      due_date: SEND_DUE_DATE,
      today: SEND_TODAY,
      confirm: CONFIRM_SEND,
    },
    async ({ library_id, relationship_ids, mode, due_date, today, confirm }) => guard(async () => {
      if (confirm !== true) return errorResult(NEEDS_CONFIRM);
      // Every relationship must be a student the caller tutors; the rest are reported, never sent to.
      const students: ResolvedStudent[] = [];
      const refused: Array<{ relationship_id: string; error: string }> = [];
      for (const id of relationship_ids) {
        try {
          students.push(await resolveStudent(api, ctx.userId, id));
        } catch (err) {
          refused.push({ relationship_id: id, error: err instanceof Error ? err.message : String(err) });
        }
      }
      const res = await assignLessonAsHomework(api, library_id, students.map((s) => s.relationship_id), { mode, due_date, today });
      const nameOf = (id: string) => students.find((s) => s.relationship_id === id)?.name ?? id;
      const dates = [...new Set(res.assigned.map((a) => a.due_date))];
      const how = res.assigned.length === 0 ? '' : dates.length > 1 ? ' as one-off homework (each due by their own next lesson)' : ` ${describeSend(res.mode, dates[0] ?? null)}`;
      const names = res.assigned.map((a) => nameOf(a.relationship_id));
      const errors = [...refused, ...res.errors];
      return jsonResult({
        ...res,
        sent: res.assigned.length > 0,
        sent_to: res.assigned.map((a) => ({ relationship_id: a.relationship_id, name: nameOf(a.relationship_id) })),
        errors,
        message: `${names.length ? sentTo(names.join(', '), `the lesson${how}.`) : 'Nothing was sent.'}${res.already_had.length ? ` ${res.already_had.map((a) => nameOf(a.relationship_id)).join(', ')} already had it.` : ''}${errors.length ? ` ${errors.length} error(s).` : ''}`,
      });
    }),
  );

  server.tool(
    'get_lesson_assignments',
    'Who has a copy of a library lesson and how it went: per student — lesson_id (their copy), relationship_id, assigned_at, completions, last_completed_at, last_rating (0 again · 1 hard · 2 good · 3 easy), last_score {correct, total} and up_to_date (false = their copy is behind the library version; push_lesson_update fixes that).',
    { library_id: LIBRARY_ID },
    async ({ library_id }) => guard(async () => {
      const res = await api.get<{ assignments: unknown[] }>(`/api/lesson-library/${encodeURIComponent(library_id)}/assignments`);
      return jsonResult({ count: res.assignments.length, assignments: res.assignments });
    }),
  );

  server.tool(
    'push_lesson_update',
    `${SEND_RULE} Overwrite the assigned copies of a library lesson with the current library content (same lesson ids, so the students\' completion history and FSRS schedule survive; illustrations whose prompt is unchanged are kept). Copies already up to date are skipped. Name the students in relationship_ids (get_lesson_assignments lists who has a copy).`,
    {
      library_id: LIBRARY_ID,
      relationship_ids: z.array(z.string()).min(1).describe('The students whose copies to update (relationship ids, from get_lesson_assignments) — only the ones the tutor asked for'),
      confirm: CONFIRM_SEND,
    },
    async ({ library_id, relationship_ids, confirm }) => guard(async () => {
      if (confirm !== true) return errorResult(NEEDS_CONFIRM);
      if (!relationship_ids?.length) return errorResult('Name the students: relationship_ids (from get_lesson_assignments). Nothing was sent.');
      const res = await api.post<{ updated: number; skipped: number; image_jobs: number }>(
        `/api/lesson-library/${encodeURIComponent(library_id)}/push-update`,
        { relationship_ids },
      );
      return jsonResult({ ...res, sent: res.updated > 0, message: `${res.updated > 0 ? `SENT: updated ${res.updated} student copy/copies` : 'Nothing was sent'}, ${res.skipped} already current.${res.image_jobs ? ` ${res.image_jobs} illustration(s) queued.` : ''}` });
    }),
  );

  server.tool(
    'export_library_lesson',
    'Export a library lesson as text: "md" = Markdown with an answer key (print / paste into a message), "json" = re-importable spec (feed it to create_library_lesson), "csv" = Quizlet-style vocabulary rows.',
    {
      library_id: LIBRARY_ID,
      format: z.enum(['md', 'json', 'csv']).describe('Export format'),
    },
    async ({ library_id, format }) => guard(async () => {
      const body = await api.get<unknown>(`/api/lesson-library/${encodeURIComponent(library_id)}/export.${format}`);
      return textResult(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    }),
  );

  server.tool(
    'list_student_lessons',
    'The tutor\'s view of a student\'s custom mini lessons: every lesson the student has (assigned by me, by another tutor, or made by the student/agents) with status, source, completions and last rating. Use it before assigning to avoid sending what they already have, and to see whether homework lessons were done.',
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) => guard(async () => {
      const res = await api.get<{ lessons: unknown[] }>(`/api/relationships/${encodeURIComponent(relationship_id)}/student-lessons`);
      return jsonResult({ count: res.lessons.length, lessons: res.lessons });
    }),
  );
}

function countExercises(spec: unknown): number | undefined {
  const sections = (spec as { sections?: Array<{ exercises?: unknown[] }> } | undefined)?.sections;
  if (!Array.isArray(sections)) return undefined;
  return sections.reduce((n, s) => n + (Array.isArray(s.exercises) ? s.exercises.length : 0), 0);
}
