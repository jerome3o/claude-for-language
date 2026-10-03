/**
 * Tutor tools: the homework hub (docs/HOMEWORK.md §8–§9).
 *
 *  - Link homework — a YouTube video, a song, an article — created in the
 *    TUTOR's account first (create_link_homework), sent only by an explicit
 *    second step (assign_link_homework). Edits can update what was sent.
 *  - The homework library: one row per thing sent to a student (deck copy,
 *    lesson, reader, link) with status and progress.
 *
 * Every call goes through the main API as the signed-in tutor (`ctx.api`).
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';
import {
  filterLibrary,
  isDateString,
  libraryDueText,
  linkSiteName,
  localDate,
  pickLinkHomework,
  shortDay,
  LIBRARY_KINDS,
  LIBRARY_STATUSES,
  type HomeworkAssignment,
  type LibraryItem,
  type LibraryKind,
  type LibraryStatus,
} from '../../../shared/homework';
import { CONFIRM_SEND, NEEDS_CONFIRM, SEND_RULE } from './homework-send.js';
import { describeCopyResults, UPDATE_STUDENT_COPIES, type CopyResult } from './student-copies.js';

const LINK_ID = z.string().describe('The link id (`id` from create_link_homework / list_link_homework).');
const TODAY = z.string().optional().describe('The tutor\'s today as YYYY-MM-DD (decides "overdue"). Default: today in UTC.');

const rel = (id: string) => `/api/relationships/${encodeURIComponent(id)}`;

function todayOr(value: string | undefined): string {
  return value && isDateString(value) ? value : localDate(new Date());
}

export interface LinkRow {
  id: string;
  title: string;
  url: string;
  instructions: string | null;
  thumbnail_url: string | null;
  created_at?: string;
  updated_at?: string;
}

/** The fields a chat needs from a link. Pure — exported for tests. */
export function compactLink(l: LinkRow) {
  return {
    id: l.id,
    title: l.title,
    url: l.url,
    site: linkSiteName(l.url),
    instructions: l.instructions ?? null,
    thumbnail_url: l.thumbnail_url ?? null,
    ...(l.updated_at || l.created_at ? { updated_at: l.updated_at ?? l.created_at } : {}),
  };
}

/** One homework-library row as a chat needs it. Pure — exported for tests. */
export function compactLibraryItem(i: LibraryItem, today: string) {
  return {
    kind: i.kind,
    title: i.title,
    student_name: i.student_name,
    relationship_id: i.relationship_id,
    sent: i.sent_at.slice(0, 10),
    due_date: i.due_date,
    ...(i.status !== 'completed' ? { due: libraryDueText(i.due_date, today) } : {}),
    status: i.status,
    percent: i.percent,
    progress: i.progress,
    student_note: i.student_note,
    source_id: i.source_id,
    target_id: i.target_id,
    due_assignment_id: i.due_assignment_id,
    ...(i.kind === 'link' && i.url ? { url: i.url } : {}),
    ...(i.behind > 0 ? { words_behind: i.behind } : {}),
  };
}

/** Filter (status / kind / text) then trim. Pure — exported for tests. */
export function shapeLibrary(items: LibraryItem[], today: string, filter: { status?: LibraryStatus; kind?: LibraryKind; query?: string }) {
  return filterLibrary(items, filter).map((i) => compactLibraryItem(i, today));
}

export function registerHomeworkHubTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  // ============ Link homework ============

  server.tool(
    'create_link_homework',
    'Save a LINK as homework material in the tutor\'s OWN account — a YouTube video, a song, a TV-drama clip, an article — with a title and optional instructions ("Watch to 3:20 and note every 了"). Nothing is hosted: the student opens the link. Creating it sends NOTHING to any student; send it with assign_link_homework (one or more students, optional due date). A YouTube link gets its thumbnail automatically.',
    {
      title: z.string().describe('What the student sees, e.g. "周杰伦《晴天》— listen and sing along".'),
      url: z.string().describe('The web link (https://…; "youtu.be/…" is fine).'),
      instructions: z.string().optional().describe('What to do with it (≤ 2000 characters).'),
    },
    async ({ title, url, instructions }) =>
      guard(async () => {
        const { value, problems } = pickLinkHomework({ title, url, instructions });
        if (problems.length > 0) return errorResult(`Link not saved:\n- ${problems.join('\n- ')}`);
        const r = await api.post<{ link: LinkRow }>('/api/homework-links', { title: value.title, url: value.url, instructions: value.instructions ?? null });
        return jsonResult({
          link: compactLink(r.link),
          message: `Saved "${r.link.title}" in your links (id=${r.link.id}). Nothing has been sent — use assign_link_homework to send it to a student.`,
        });
      })
  );

  server.tool(
    'assign_link_homework',
    `${SEND_RULE} Send a saved link (create_link_homework) to one or more students as one-off homework: it appears on their Home "From <tutor>" card and Homework list with an Open link button and Mark as done (with an optional note back, shown in get_homework_library). due_date optional (null / omitted = no due date). Each student gets their own snapshot, so later edits only reach them via update_link_homework with update_student_copies.`,
    {
      link_id: LINK_ID,
      confirm: CONFIRM_SEND,
      relationship_ids: z.array(z.string()).optional().describe('Relationship ids (`relationship_id` from list_students) of the students to send to.'),
      relationship_id: z.string().optional().describe('One student\'s relationship id (instead of relationship_ids).'),
      due_date: z.string().nullable().optional().describe('YYYY-MM-DD the student should have done it by; null / omitted = no due date.'),
      today: TODAY,
    },
    async ({ link_id, relationship_ids, relationship_id, due_date, today, confirm }) =>
      guard(async () => {
        if (confirm !== true) return errorResult(NEEDS_CONFIRM);
        const ids = [...new Set([...(relationship_ids ?? []), ...(relationship_id ? [relationship_id] : [])])];
        if (ids.length === 0) return errorResult('Pass relationship_ids (or relationship_id) — who to send the link to.');
        if (due_date != null && !isDateString(due_date)) return errorResult(`due_date must be YYYY-MM-DD (got "${due_date}")`);
        const day = todayOr(today);
        const sent: Array<{ relationship_id: string; assignment_id: string; title: string; due_date: string | null }> = [];
        const errors: Array<{ relationship_id: string; error: string }> = [];
        for (const relId of ids) {
          try {
            const r = await api.post<{ assignments: HomeworkAssignment[]; errors?: Array<{ source_id: string; error: string }> }>(`${rel(relId)}/homework`, {
              items: [{ kind: 'link', source_id: link_id, mode: 'one_off', due_date: due_date ?? null }],
              today: day,
            });
            const a = r.assignments[0];
            if (!a) errors.push({ relationship_id: relId, error: r.errors?.[0]?.error ?? 'Nothing could be assigned' });
            else sent.push({ relationship_id: relId, assignment_id: a.id, title: a.title, due_date: a.due_date });
          } catch (err) {
            errors.push({ relationship_id: relId, error: err instanceof Error ? err.message : String(err) });
          }
        }
        const due = due_date ? ` due ${shortDay(due_date)}` : ' (no due date)';
        return jsonResult({
          sent,
          errors,
          message: `${sent.length ? 'SENT' : 'Nothing was sent'}: ${sent.length} student(s)${sent.length ? due : ''}${errors.length ? `; ${errors.length} failed` : ''}.`,
        });
      })
  );

  server.tool(
    'list_link_homework',
    'The tutor\'s saved links (create_link_homework): id, title, url, site, instructions. To see who was sent which link and whether they did it, use get_homework_library with kind "link".',
    {},
    async () =>
      guard(async () => {
        const r = await api.get<{ links: LinkRow[] }>('/api/homework-links');
        const links = (r.links ?? []).map(compactLink);
        return jsonResult({ count: links.length, links });
      })
  );

  server.tool(
    'update_link_homework',
    'Edit a saved link (only the fields given change). With update_student_copies: true (only when the tutor asked) the students it was already sent to see the new title / link / instructions too; their done status and notes stay.',
    {
      link_id: LINK_ID,
      title: z.string().optional(),
      url: z.string().optional(),
      instructions: z.string().nullable().optional().describe('New instructions; null or "" clears them.'),
      update_student_copies: UPDATE_STUDENT_COPIES,
    },
    async ({ link_id, title, url, instructions, update_student_copies }) =>
      guard(async () => {
        const input = { title, url, instructions };
        const { value, problems } = pickLinkHomework(input, true);
        if (problems.length > 0) return errorResult(`Link not saved:\n- ${problems.join('\n- ')}`);
        const patch: Record<string, unknown> = {};
        if (title !== undefined) patch.title = value.title;
        if (url !== undefined) patch.url = value.url;
        if (instructions !== undefined) patch.instructions = value.instructions ?? null;
        if (Object.keys(patch).length === 0) return errorResult('No updates provided');
        const updateCopies = update_student_copies === true;
        const r = await api.put<{ link: LinkRow; updated?: number; results?: CopyResult[]; copies?: { updated?: number; results?: CopyResult[] } }>(
          `/api/homework-links/${encodeURIComponent(link_id)}`,
          { ...patch, update_student_copies: updateCopies }
        );
        const results = r.results ?? r.copies?.results ?? [];
        const copies = describeCopyResults(results);
        return jsonResult({
          link: compactLink(r.link),
          ...(results.length ? { student_copies: results } : {}),
          message: `Updated "${r.link.title}".${copies ? ` ${copies}` : updateCopies ? '' : ' Students it was already sent to keep the old version.'}`,
        });
      })
  );

  // ============ The homework library ============

  server.tool(
    'get_homework_library',
    'The FULL history of homework the tutor has sent — one row per thing (word deck copy, lesson, reader, link) with student, sent date, due date, status (completed / in_progress / overdue / not_started), percent, progress ("5 / 12 words") and the student\'s note back on links. One student (relationship_id) or every student (omit it). Filter by status / kind / text. A row\'s due_assignment_id goes to update_homework_assignment (move the due date); words_behind > 0 means the student\'s deck copy lacks newer words (update_student_deck_copy).',
    {
      relationship_id: z.string().optional().describe('One student (`relationship_id` from list_students); omit for all students.'),
      status: z.enum(LIBRARY_STATUSES as [LibraryStatus, ...LibraryStatus[]]).optional().describe('Only rows with this status.'),
      kind: z.enum(LIBRARY_KINDS as [LibraryKind, ...LibraryKind[]]).optional().describe('Only this kind: deck (words), lesson, reader, link.'),
      query: z.string().optional().describe('Text in the title or student name.'),
      today: TODAY,
    },
    async ({ relationship_id, status, kind, query, today }) =>
      guard(async () => {
        const day = todayOr(today);
        const path = relationship_id ? `${rel(relationship_id)}/homework-library` : '/api/tutor/homework-library';
        const r = await api.get<{ items: LibraryItem[]; counts?: Record<LibraryStatus, number>; students?: Array<{ relationship_id: string; student_name: string }>; today?: string }>(path, { today: day });
        const items = shapeLibrary(r.items ?? [], r.today ?? day, { status, kind, query });
        return jsonResult({
          today: r.today ?? day,
          counts: r.counts,
          ...(r.students ? { students: r.students } : {}),
          count: items.length,
          items,
        });
      })
  );
}
