/**
 * Tutor tools: homework assignments (docs/HOMEWORK.md) — one-off passes with a
 * due date and / or long-term (FSRS) review, the student's load, and the
 * lesson-notes → draft → review → assign flow.
 *
 * Every tool calls the main API as the signed-in tutor (`ctx.api`), so the
 * API decides who may do what. Endpoints: worker/src/routes/homework.ts.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';
import { dueLabel, isDateString, localDate, type DraftPlan, type HomeworkAssignment, type HomeworkLoad } from '../../../shared/homework';

const RELATIONSHIP_ID = z
  .string()
  .describe('The tutor–student relationship id (`relationship_id` from list_students). Not the student\'s user id.');
const TODAY = z.string().optional().describe('The tutor\'s today as YYYY-MM-DD (decides "overdue" / "due today"). Default: today in UTC.');
const MODE = z
  .enum(['one_off', 'fsrs', 'both'])
  .describe('one_off = a single pass by the due date, NOT spaced repetition (a word list: each word once, missed ones again until right; a lesson / reader: once). fsrs = long-term spaced review (the student\'s daily queue; no due date). both = a one-off pass by the date AND long-term review.');

const rel = (id: string) => `/api/relationships/${encodeURIComponent(id)}`;

/** The fields a chat needs from an assignment. Pure — exported for tests. */
export function compactAssignment(a: HomeworkAssignment, today: string) {
  const due = dueLabel(a.due_date, today);
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    mode: a.mode,
    status: a.status,
    due_date: a.due_date,
    ...(due.text ? { due: due.text } : {}),
    progress: a.kind === 'deck' ? `${a.done_count}/${a.item_count} words` : a.done_count > 0 ? 'done' : 'not started',
    ...(a.part_count > 1 ? { part: `${a.part_index + 1} of ${a.part_count}` } : {}),
    ...(a.completed_at ? { completed_at: a.completed_at } : {}),
    target_id: a.target_id,
    source_id: a.source_id,
  };
}

export function compactLoad(load: HomeworkLoad) {
  return {
    level: load.level,
    summary: load.summary,
    one_off: {
      pending_items: load.one_off.items,
      pending_words: load.one_off.words,
      overdue_items: load.one_off.overdue_items,
      due_today_items: load.one_off.due_today_items,
      next_7_days: load.one_off.by_day.map((d) => `${d.date}: ${d.items} items, ${d.words} words`),
    },
    long_term: load.fsrs,
  };
}

interface DraftViewRow {
  student_name: string;
  job: { id: string; status: string; progress: string | null; title: string | null; assigned_at: string | null; error: string | null; result: { summary?: string; lessons?: Array<{ library_item_id: string; title: string; exercise_count: number }>; reader?: { id: string; title_english: string } ; deck?: { id: string; name: string } }; chat: Array<{ role: string; text: string }> };
  plan: DraftPlan;
  words: Array<{ hanzi: string; pinyin: string; english: string; known: { deck_name: string; state: string } | null; skipped: boolean }>;
  load: HomeworkLoad;
  load_after: HomeworkLoad;
  assignments: HomeworkAssignment[];
}

/** The draft as a chat needs it. Pure — exported for tests. */
export function compactDraft(v: DraftViewRow, today: string) {
  return {
    job_id: v.job.id,
    status: v.job.status,
    ...(v.job.progress && v.job.status !== 'done' ? { progress: v.job.progress } : {}),
    ...(v.job.error ? { error: v.job.error } : {}),
    assigned_at: v.job.assigned_at,
    title: v.job.title,
    summary: v.job.result.summary ?? null,
    words: v.words.filter((w) => !w.skipped).map((w) => `${w.hanzi} (${w.pinyin}) ${w.english}`),
    skipped_known: v.words.filter((w) => w.skipped).map((w) => `${w.hanzi}${w.known ? ` — has it in ${w.known.deck_name} (${w.known.state})` : ' — repeated'}`),
    plan: v.plan,
    load_now: compactLoad(v.load),
    load_after: v.job.assigned_at ? undefined : compactLoad(v.load_after),
    chat: v.job.chat.slice(-10),
    assignments: v.assignments.map((a) => compactAssignment(a, today)),
  };
}

function todayOr(value: string | undefined): string {
  return value && isDateString(value) ? value : localDate(new Date());
}

export function registerHomeworkTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'get_student_homework',
    'A student\'s homework plan: the LOAD GAUGE (one-off items pending / overdue / due per day this week, words still to come in long-term review and ~days at their daily budget, level light / moderate / heavy) and every assignment with its mode, due label and progress. Check it before assigning more — cut back when the level is heavy or items are overdue.',
    { relationship_id: RELATIONSHIP_ID, today: TODAY, include_done: z.boolean().optional().describe('Also list finished and cancelled assignments (default false).') },
    async ({ relationship_id, today, include_done }) =>
      guard(async () => {
        const day = todayOr(today);
        const r = await api.get<{ assignments: HomeworkAssignment[]; load: HomeworkLoad }>(`${rel(relationship_id)}/homework`, { today: day });
        const list = include_done ? r.assignments : r.assignments.filter((a) => a.status === 'active');
        return jsonResult({ load: compactLoad(r.load), assignments: list.map((a) => compactAssignment(a, day)) });
      })
  );

  server.tool(
    'assign_homework',
    'Assign decks / word lists, library lessons (any exercise type) and readers to a student, each as one_off (with a due date), fsrs (long-term) or both. A deck is copied to the student leaving out words they already have (skip_known, default true; `skipped` lists them), and a one-off deck can be spread over `split_days` consecutive days (one assignment per day). A one-off-only deck never enters their daily new-card budget. Returns the assignments created and per-item errors.',
    {
      relationship_id: RELATIONSHIP_ID,
      items: z
        .array(
          z.object({
            kind: z.enum(['deck', 'lesson', 'reader']).describe('deck = one of the tutor\'s decks (list_decks); lesson = a lesson LIBRARY item (list_lesson_library); reader = one of the tutor\'s readers (list_readers).'),
            source_id: z.string().describe('The tutor\'s deck id / library item id / reader id.'),
            mode: MODE,
            due_date: z.string().optional().describe('YYYY-MM-DD (the first day when split). Default: in two days. Ignored for fsrs.'),
            split_days: z.number().int().min(1).max(14).optional().describe('Deck only: spread the one-off pass over this many days.'),
            priority: z.enum(['core', 'non_urgent']).optional().describe('Deck only, fsrs / both: top (core, default) or bottom of their queue.'),
            skip_known: z.boolean().optional().describe('Deck only: leave out words the student already has (default true).'),
            include_known: z.array(z.string()).optional().describe('Deck only: hanzi to send even though the student has them.'),
          })
        )
        .min(1)
        .max(20),
      today: TODAY,
    },
    async ({ relationship_id, items, today }) =>
      guard(async () => {
        const day = todayOr(today);
        const r = await api.post<{ assignments: HomeworkAssignment[]; skipped: Array<{ source_id: string; hanzi: string[] }>; errors: Array<{ source_id: string; error: string }> }>(
          `${rel(relationship_id)}/homework`,
          { items, today: day }
        );
        return jsonResult({ assignments: r.assignments.map((a) => compactAssignment(a, day)), skipped: r.skipped, errors: r.errors });
      })
  );

  server.tool(
    'update_homework_assignment',
    'Move an assignment\'s due date or cancel it (it disappears from the student\'s homework; a one-off-only lesson or reader still never joins their long-term rotation). `status: "active"` restores a cancelled one.',
    {
      relationship_id: RELATIONSHIP_ID,
      assignment_id: z.string().describe('`id` from get_student_homework.'),
      due_date: z.string().optional().describe('New due date, YYYY-MM-DD.'),
      status: z.enum(['cancelled', 'active']).optional(),
    },
    async ({ relationship_id, assignment_id, due_date, status }) =>
      guard(async () => {
        const r = await api.patch<{ assignment: HomeworkAssignment }>(`${rel(relationship_id)}/homework/${encodeURIComponent(assignment_id)}`, {
          ...(due_date !== undefined ? { due_date } : {}),
          ...(status !== undefined ? { status } : {}),
        });
        return jsonResult(compactAssignment(r.assignment, localDate(new Date())));
      })
  );

  // ============ Lesson notes → drafts ============

  server.tool(
    'list_student_lesson_notes',
    'The tutor\'s lesson-notes entries for a student (date, title) with where each one\'s homework stands: no draft, drafting, draft ready for review (`job_id` for get_homework_draft), assigned, failed.',
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const r = await api.get<{ entries: Array<{ id: string; lesson_at: string; title: string | null; notes: string | null; job: { id: string; status: string; review: boolean; assigned_at: string | null; progress: string | null } | null }> }>(`${rel(relationship_id)}/lesson-notes`);
        return jsonResult({
          entries: r.entries.map((e) => ({
            lesson_notes_id: e.id,
            date: e.lesson_at.slice(0, 10),
            title: e.title,
            notes_preview: (e.notes ?? '').slice(0, 160),
            homework: !e.job ? 'none' : e.job.status === 'queued' || e.job.status === 'running' ? 'drafting' : e.job.status !== 'done' ? e.job.status : !e.job.review ? 'sent automatically' : e.job.assigned_at ? 'assigned' : 'draft ready',
            job_id: e.job?.id ?? null,
          })),
        });
      })
  );

  server.tool(
    'add_student_lesson_notes',
    'Add the tutor\'s notes from a lesson to the student\'s lesson-notes list (logged as a lesson). With draft_homework (default true) the in-app assistant then DRAFTS homework from them in the background — a deck of the words taught (words the student already has are skipped), a mini lesson only for a taught structure, a reader only when asked — plus a plan (one-off / long-term, due dates, split over days). NOTHING is sent until the draft is assigned: poll get_homework_draft, adjust with update_homework_draft_plan or revise_homework_draft, then assign_homework_draft.',
    {
      relationship_id: RELATIONSHIP_ID,
      notes: z.string().min(1).max(120_000).describe('The raw lesson notes, verbatim.'),
      title: z.string().max(120).optional(),
      lesson_at: z.string().optional().describe('YYYY-MM-DD or ISO; default now.'),
      draft_homework: z.boolean().optional().describe('Draft homework from the notes (default true; needs ≥ 20 characters).'),
    },
    async ({ relationship_id, notes, title, lesson_at, draft_homework }) =>
      guard(async () => {
        const r = await api.post<{ entry: { id: string } | null; job: { id: string; status: string } | null }>(`${rel(relationship_id)}/lesson-notes`, { notes, title, lesson_at, draft: draft_homework ?? true });
        return jsonResult({ lesson_notes_id: r.entry?.id ?? null, job_id: r.job?.id ?? null, ...(r.job ? { hint: 'Poll get_homework_draft until status is done (a minute or three); nothing is sent until assign_homework_draft.' } : {}) });
      })
  );

  server.tool(
    'get_homework_draft',
    'A homework draft for review: status / progress while the assistant works, its summary, the words it will send (and the ones skipped because the student already has them), lessons / reader, the plan (per item mode one_off / fsrs / both, due dates, split_days), the student\'s load NOW and AFTER this draft, the chat with the assistant, and — once assigned — the assignments.',
    { relationship_id: RELATIONSHIP_ID, job_id: z.string(), today: TODAY },
    async ({ relationship_id, job_id, today }) =>
      guard(async () => {
        const day = todayOr(today);
        const v = await api.get<DraftViewRow>(`${rel(relationship_id)}/homework-drafts/${encodeURIComponent(job_id)}`, { today: day });
        return jsonResult(compactDraft(v, day));
      })
  );

  server.tool(
    'update_homework_draft_plan',
    'Change how a draft will be assigned before assigning it. Item keys: "deck" (the words), "lesson:<library_item_id>", "reader". Only what you pass changes. include_known lists hanzi the student already has that should be sent anyway.',
    {
      relationship_id: RELATIONSHIP_ID,
      job_id: z.string(),
      split_days: z.number().int().min(1).max(14).optional(),
      priority: z.enum(['core', 'non_urgent']).optional(),
      include_known: z.array(z.string()).optional(),
      items: z.array(z.object({ key: z.string(), include: z.boolean().optional(), mode: MODE.optional(), due_date: z.string().optional().describe('YYYY-MM-DD') })).optional(),
      today: TODAY,
    },
    async ({ relationship_id, job_id, split_days, priority, include_known, items, today }) =>
      guard(async () => {
        const day = todayOr(today);
        const path = `${rel(relationship_id)}/homework-drafts/${encodeURIComponent(job_id)}`;
        const current = await api.get<DraftViewRow>(path, { today: day });
        const plan: DraftPlan = {
          ...current.plan,
          ...(split_days !== undefined ? { split_days } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(include_known !== undefined ? { include_known } : {}),
          items: current.plan.items.map((i) => {
            const p = items?.find((x) => x.key === i.key);
            return p ? { ...i, ...(p.include !== undefined ? { include: p.include } : {}), ...(p.mode ? { mode: p.mode } : {}), ...(p.due_date ? { due_date: p.due_date } : {}) } : i;
          }),
        };
        const v = await api.put<DraftViewRow>(`${path}/plan`, { plan, today: day });
        return jsonResult(compactDraft(v, day));
      })
  );

  server.tool(
    'revise_homework_draft',
    'Ask the in-app assistant to change a draft in plain words ("drop the food words", "split into two days", "add a listening lesson"). It continues the same job with its tools; poll get_homework_draft until status is done again, then read its reply in `chat`.',
    { relationship_id: RELATIONSHIP_ID, job_id: z.string(), message: z.string().min(1).max(4000) },
    async ({ relationship_id, job_id, message }) =>
      guard(async () => {
        const r = await api.post<{ job: { id: string; status: string } }>(`${rel(relationship_id)}/homework-drafts/${encodeURIComponent(job_id)}/messages`, { message });
        return jsonResult({ job_id: r.job.id, status: r.job.status, hint: 'Poll get_homework_draft until status is done.' });
      })
  );

  server.tool(
    'assign_homework_draft',
    'Assign a reviewed draft to the student following its plan (words the student already has are left out; a split creates one assignment per day). Once only.',
    { relationship_id: RELATIONSHIP_ID, job_id: z.string(), today: TODAY },
    async ({ relationship_id, job_id, today }) =>
      guard(async () => {
        const day = todayOr(today);
        const r = await api.post<{ assignments: HomeworkAssignment[]; skipped: Array<{ hanzi: string[] }>; errors: Array<{ source_id: string; error: string }> }>(`${rel(relationship_id)}/homework-drafts/${encodeURIComponent(job_id)}/assign`, { today: day });
        return jsonResult({ assignments: r.assignments.map((a) => compactAssignment(a, day)), skipped_known: r.skipped.flatMap((s) => s.hanzi), errors: r.errors });
      })
  );
}
