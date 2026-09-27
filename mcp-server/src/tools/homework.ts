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
import { dueLabel, isDateString, localDate, type HomeworkAssignment, type HomeworkLoad } from '../../../shared/homework';

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
}
