/**
 * Graded reader tools: list / get / create from a spec / replace / generate
 * with Claude / retry / delete / export, the reader queue ("Up next": list,
 * move, reorder), and tutor → student sharing.
 * Everything goes through the main API as the signed-in user (ctx.api), so
 * ownership checks, validation, illustration queues and R2 cleanup are the
 * API's — this module only shapes the calls and the replies.
 */
import { z } from 'zod';
import { readerPageWarnings } from '../../../../shared/reader/standard';
import type { PinyinFix } from '../../../../shared/pinyin/fixes';
import type { ToolContext } from '../context.js';
import { jsonResult, textResult, errorResult, guard } from '../context.js';
import {
  READER_SPEC_DOC,
  readerSpecProblems,
  formatProblems,
  filterReaders,
  pinyinReply,
  pinyinSuffix,
  type ReaderListRow,
} from './specs.js';
import { folderParams, resolveFolder, filedNote, listFolders, folderNames } from '../folders.js';
import { CONFIRM_SEND, NEEDS_CONFIRM, NOT_SENT, SEND_DUE_DATE, SEND_MODE, SEND_RULE, SEND_TODAY, STUDENT_NAME, assignmentSummary, describeSend, resolveStudent, sendAsHomework, sentTo } from '../homework-send.js';
import { UPDATE_STUDENT_COPIES, copiesForReply, updateStudentCopies } from '../student-copies.js';

const READER_ID = z.string().describe('The reader id (from list_readers / generate_reader)');
const RELATIONSHIP_ID = z.string().describe('The tutor–student relationship id (from list_students or the students tools)');
const QUEUE_PLACEMENT = z.enum(['top', 'bottom']).optional().describe(
  "Where the new story goes in the signed-in user's reader queue (\"Up next\" — the study session offers its first unread story, one a day): 'top' (default — offered next) or 'bottom' (after every story already waiting).",
);

/** A row of GET /api/readers/queue. */
interface QueueRow {
  id: string;
  title_chinese: string;
  title_english: string;
  difficulty_level: string;
  topic: string | null;
  folder_id: string | null;
  page_count: number;
  created_at: string;
  queue_position: number;
}

/** The queue as the model sees it: position, titles, level, folder name. */
export function shapeReaderQueue(rows: QueueRow[], folders: Map<string, string>) {
  return rows.map(r => ({
    queue_position: r.queue_position,
    id: r.id,
    title_chinese: r.title_chinese,
    title_english: r.title_english,
    difficulty_level: r.difficulty_level,
    topic: r.topic ?? null,
    page_count: r.page_count,
    folder_id: r.folder_id && folders.has(r.folder_id) ? r.folder_id : null,
    folder: r.folder_id ? folders.get(r.folder_id) ?? null : null,
    created_at: r.created_at,
  }));
}

/** One line per story: "1. 小猫找家 · Kitten". */
export function readerQueueLines(rows: Array<{ queue_position: number; title_chinese: string; title_english: string }>): string {
  return rows.map(r => `${r.queue_position}. ${r.title_chinese} · ${r.title_english}`).join('\n');
}

const QUEUE_EXPLAINED = 'The reader queue ("Up next") is the order the signed-in user\'s UNREAD, ready graded readers are offered in: the study session offers the FIRST one, one story a day; a story is read once and then leaves the queue. Until someone reorders it the queue is newest first, and a new story lands on top unless created with queue_position \'bottom\'. Readers that are still generating, failed or already read are not in it. The queue is account-wide (folders only organise the list).';

/** Loose zod shape for a reader spec: the real validation is validateReaderSpec. */
const readerSpecShape = z.object({
  title_chinese: z.string(),
  title_english: z.string(),
  difficulty_level: z.enum(['beginner', 'elementary', 'intermediate', 'advanced']),
  topic: z.string().nullable().optional(),
  vocabulary_used: z.array(z.object({ hanzi: z.string(), pinyin: z.string().optional().default(''), english: z.string().optional().default('') })).optional(),
  pages: z.array(z.object({
    id: z.string().optional(),
    content_chinese: z.string(),
    content_pinyin: z.string().optional().default(''),
    content_english: z.string(),
    image_prompt: z.string().nullable().optional(),
  }).passthrough()),
}).passthrough();

interface SpecResponse {
  id: string;
  status: string;
  is_published?: number;
  created_at: string;
  spec: unknown;
  image_jobs?: number;
  /** Pinyin the API corrected on save (a syllable its character can't have). */
  pinyin_fixes?: PinyinFix[];
}

export function registerReaderTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_readers',
    `List the signed-in user's graded readers (short Chinese stories read page by page, with pinyin/English reveal and illustrations). Returns id, titles, difficulty, topic, status (ready | generating | failed), page_count, created_at and creator_role ('tutor' for readers written/imported by hand or shared by a tutor, 'student' for generated ones). Use it to find a reader id before get_reader, update_reader, share_reader_with_student or export_reader. Each row has its folder (folder_id + folder name; null = Unfiled — see list_folders / move_to_folder) and its queue_position (1-based place in the reader queue — the study session offers #1 next, one a day; null = read / not ready; see list_reader_queue). Readers are per-user: a tutor sees their own readers here, not the students' — use list_student_readers for what a student has received.`,
    {
      status: z.enum(['ready', 'generating', 'failed', 'all']).optional().describe('Filter by status (default: all)'),
      folder_id: z.string().optional().describe("Only this folder's readers (from list_folders), or 'unfiled'"),
    },
    async ({ status, folder_id }) => guard(async () => {
      const rows = await api.get<ReaderListRow[]>('/api/readers', { include_pages: 'true' });
      const names = folderNames(await listFolders(api, 'reader').catch(() => []));
      const readers = filterReaders(rows, status)
        .map(r => ({ ...r, folder_id: r.folder_id && names.has(r.folder_id) ? r.folder_id : null, folder: r.folder_id ? names.get(r.folder_id) ?? null : null }))
        .filter(r => !folder_id || (folder_id === 'unfiled' ? !r.folder_id : r.folder_id === folder_id));
      return jsonResult({ count: readers.length, readers });
    }),
  );

  server.tool(
    'get_reader',
    `Get one graded reader as a full ReaderSpec — titles, difficulty, topic, vocabulary_used and every page with its id, Chinese, pinyin, English, image_prompt and image_url (an R2 key; null while an illustration is still generating or when the page has none). Also returns status: while it is "generating" (after generate_reader) the pages are not there yet — poll this tool every ~15 s until status is "ready" or "failed" (failed readers carry error_message; use retry_reader). Fetch this before update_reader so you edit the real content and keep the page ids.`,
    { reader_id: READER_ID },
    async ({ reader_id }) => guard(async () => {
      const res = await api.get<SpecResponse & { error_message?: string | null }>(`/api/readers/${encodeURIComponent(reader_id)}/spec`);
      if (res.status !== 'ready') {
        // The spec route has no error_message; the plain reader route does.
        const plain = await api.get<{ error_message?: string | null }>(`/api/readers/${encodeURIComponent(reader_id)}`);
        return jsonResult({ ...res, error_message: plain.error_message ?? null, hint: res.status === 'generating' ? 'Still generating — call get_reader again in ~15 seconds.' : 'Generation failed — retry_reader re-queues it with the same topic.' });
      }
      return jsonResult(res);
    }),
  );

  server.tool(
    'create_reader',
    `Write a new graded reader by hand from a ReaderSpec (owner = the signed-in user — the tutor's own account; nothing is sent: share_reader_with_student only when the tutor asks). Use this when you author the story yourself — for a story generated from the learner's known vocabulary use generate_reader instead. Every page with an image_prompt gets an illustration generated in the background (returns image_jobs). The spec is validated locally and by the API; problems come back as a list to fix.
${READER_SPEC_DOC}`,
    { spec: readerSpecShape.describe('The complete ReaderSpec (see the tool description)'), ...folderParams, queue_position: QUEUE_PLACEMENT },
    async ({ spec, folder_id, folder, queue_position }) => guard(async () => {
      const problems = readerSpecProblems(spec);
      if (problems.length > 0) return errorResult(formatProblems('Reader spec', problems));
      const filed = await resolveFolder(api, 'reader', { folder_id, folder });
      const created = await api.post<{ id: string; status: string; image_jobs?: number; spec: unknown; pinyin_fixes?: PinyinFix[] }>('/api/readers/import', { spec, folder_id: filed?.id, position: queue_position });
      const warnings = readerPageWarnings(spec).map(w => w.message);
      return jsonResult({
        id: created.id,
        status: created.status,
        image_jobs: created.image_jobs ?? 0,
        warnings,
        ...pinyinReply(created.pinyin_fixes),
        sent: false,
        queue_position: queue_position ?? 'top',
        message: `Created reader "${spec.title_english}" (id=${created.id}).${filedNote(filed)}${queue_position === 'bottom' ? ' Placed at the bottom of the reader queue.' : ''} ${NOT_SENT}${created.image_jobs ? ` ${created.image_jobs} illustration(s) generating in the background.` : ''}${warnings.length ? ` ${warnings.length} page(s) are over the page standard (see warnings) — consider update_reader to split them.` : ''}${pinyinSuffix(created.pinyin_fixes)}`,
      });
    }),
  );

  server.tool(
    'update_reader',
    `Replace a graded reader's content in place with a FULL ReaderSpec (same reader id, so the learner's reading history carries over — a story is read once, never scheduled again). Fetch the current spec with get_reader, edit it, and send the whole thing back — pages are matched by id: keep a page's "id" to update that page (its illustration is kept when image_prompt is unchanged, regenerated when the prompt changed), omit the id for a brand-new page, leave a page out to delete it, and reorder the array to reorder pages. A page sent without its id is a NEW page — its old illustration is dropped. Returns image_jobs for prompts queued. Validated locally and by the API; problems come back as a list. When the reader was sent to students, their copies get the new content too only with update_student_copies: true, when the tutor asked (pages matched by position, reading progress kept).
${READER_SPEC_DOC}`,
    {
      reader_id: READER_ID,
      spec: readerSpecShape.describe('The complete revised ReaderSpec — it replaces the stored one entirely'),
      update_student_copies: UPDATE_STUDENT_COPIES,
    },
    async ({ reader_id, spec, update_student_copies }) => guard(async () => {
      const problems = readerSpecProblems(spec);
      if (problems.length > 0) return errorResult(formatProblems('Reader spec', problems));
      const res = await api.put<SpecResponse>(`/api/readers/${encodeURIComponent(reader_id)}/spec`, { spec });
      const warnings = readerPageWarnings(spec).map(w => w.message);
      const copies = await updateStudentCopies(api, 'reader', reader_id, update_student_copies);
      const studentCopies = copiesForReply(copies);
      return jsonResult({
        id: res.id,
        status: res.status,
        ...(studentCopies ? { student_copies: studentCopies } : {}),
        image_jobs: res.image_jobs ?? 0,
        warnings,
        ...pinyinReply(res.pinyin_fixes),
        page_count: Array.isArray((res.spec as { pages?: unknown[] })?.pages) ? (res.spec as { pages: unknown[] }).pages.length : undefined,
        message: `Updated reader ${res.id}. The device picks up the new content on its next sync; reading history is unchanged.${res.image_jobs ? ` ${res.image_jobs} illustration(s) generating in the background.` : ''}${copies?.message ? ` ${copies.message}` : ''}${pinyinSuffix(res.pinyin_fixes)}`,
      });
    }),
  );

  server.tool(
    'generate_reader',
    `Ask Claude (server-side, on a queue) to write a graded reader from vocabulary the signed-in user has ALREADY LEARNED in the given decks — a story that only uses words they know, at the chosen difficulty, optionally about a topic. Returns immediately with the reader id and status "generating"; the story, pinyin, English and illustrations arrive over the next minute or two — poll get_reader until status is "ready" (or "failed", then retry_reader). Needs at least 5 learned words in the decks (the API says so if not — then create_reader by hand is the alternative). The reader belongs to the caller: a tutor who wants a story for a student generates it from their OWN decks (e.g. the homework deck they share); it stays in the tutor's account until the tutor asks to send it (share_reader_with_student).`,
    {
      deck_ids: z.array(z.string()).min(1).describe('Deck ids (from list_decks) whose learned vocabulary the story is built from'),
      topic: z.string().optional().describe('What the story should be about, e.g. "a trip to the night market"'),
      difficulty: z.enum(['beginner', 'elementary', 'intermediate', 'advanced']).optional().describe('Reading level (default beginner)'),
      ...folderParams,
      queue_position: QUEUE_PLACEMENT,
    },
    async ({ deck_ids, topic, difficulty, folder_id, folder, queue_position }) => guard(async () => {
      const filed = await resolveFolder(api, 'reader', { folder_id, folder });
      const created = await api.post<{ id: string; status: string; title_english?: string }>('/api/readers/generate', {
        source: 'decks',
        deck_ids,
        topic,
        difficulty: difficulty ?? 'beginner',
        folder_id: filed?.id,
        position: queue_position,
      });
      return jsonResult({
        id: created.id,
        status: created.status ?? 'generating',
        sent: false,
        queue_position: queue_position ?? 'top',
        message: `Reader ${created.id} is generating${topic ? ` (topic: ${topic})` : ''} in your account.${filedNote(filed)}${queue_position === 'bottom' ? ' It goes to the bottom of the reader queue.' : ''} Poll get_reader(reader_id="${created.id}") every ~15 seconds until status is "ready". ${NOT_SENT}`,
      });
    }),
  );

  server.tool(
    'list_reader_queue',
    `The signed-in user's reader queue ("Up next"), in order: each unread, ready story with queue_position (1 = offered next), id, titles, difficulty, topic, page_count and folder. ${QUEUE_EXPLAINED} Use it before move_reader_in_queue / reorder_reader_queue, and to answer "which story comes next?".`,
    {},
    async () => guard(async () => {
      const res = await api.get<{ queue: QueueRow[] }>('/api/readers/queue');
      const names = folderNames(await listFolders(api, 'reader').catch(() => []));
      const queue = shapeReaderQueue(res.queue, names);
      return jsonResult({
        count: queue.length,
        queue,
        message: queue.length
          ? `${queue.length} unread ${queue.length === 1 ? 'story' : 'stories'} in the queue; the study session offers #1 next:\n${readerQueueLines(queue)}`
          : 'The reader queue is empty — no unread, ready story is waiting (the app writes a new daily story when none is).',
      });
    }),
  );

  server.tool(
    'move_reader_in_queue',
    `Move ONE graded reader within the signed-in user's reader queue: to 'top' (offered next), 'up' / 'down' (one place), 'bottom', or a 1-based position (2 = second). ${QUEUE_EXPLAINED} Only an unread, ready story can be moved (a read one answers 409). The other stories keep their order. Returns the new queue.`,
    {
      reader_id: READER_ID,
      to: z.union([z.enum(['top', 'up', 'down', 'bottom']), z.number().int().min(1)]).describe("'top' | 'up' | 'down' | 'bottom', or a 1-based position in the queue"),
    },
    async ({ reader_id, to }) => guard(async () => {
      const body = typeof to === 'number' ? { position: to, source: 'mcp' } : { to, source: 'mcp' };
      const res = await api.post<{ queue: QueueRow[]; changed: boolean; queue_position: number; queue_total: number }>(`/api/readers/${encodeURIComponent(reader_id)}/move`, body);
      const names = folderNames(await listFolders(api, 'reader').catch(() => []));
      const queue = shapeReaderQueue(res.queue, names);
      return jsonResult({
        changed: res.changed,
        queue_position: res.queue_position,
        queue_total: res.queue_total,
        queue,
        message: `${res.changed ? 'Moved' : 'Already there:'} reader ${reader_id} is #${res.queue_position} of ${res.queue_total}${res.queue_position === 1 ? ' — the study session offers it next' : ''}. The devices follow the new order on their next sync.\n${readerQueueLines(queue)}`,
      });
    }),
  );

  server.tool(
    'reorder_reader_queue',
    `Set the order of the signed-in user's reader queue at once: reader_ids first, in that order (the first is offered next by the study session); every other story in the queue keeps its relative order after them. Ids that are not in the queue (read, generating, failed or not the user's) are ignored and listed back. ${QUEUE_EXPLAINED} Get the ids from list_reader_queue.`,
    {
      reader_ids: z.array(z.string()).min(1).describe('Reader ids in the order wanted, first = next'),
    },
    async ({ reader_ids }) => guard(async () => {
      const res = await api.put<{ queue: QueueRow[]; changed: boolean; ignored: string[] }>('/api/readers/reorder', { reader_ids, source: 'mcp' });
      const names = folderNames(await listFolders(api, 'reader').catch(() => []));
      const queue = shapeReaderQueue(res.queue, names);
      return jsonResult({
        changed: res.changed,
        ignored: res.ignored,
        queue,
        message: `${res.changed ? 'Reordered' : 'No change to'} the reader queue (${queue.length} unread ${queue.length === 1 ? 'story' : 'stories'}).${res.ignored.length ? ` Ignored ${res.ignored.length} id(s) not in the queue.` : ''} The devices follow it on their next sync.\n${readerQueueLines(queue)}`,
      });
    }),
  );

  server.tool(
    'retry_reader',
    'Re-queue a FAILED reader generation in place (same id, same topic and difficulty). Only works when the reader\'s status is "failed"; afterwards poll get_reader until it is "ready".',
    { reader_id: READER_ID },
    async ({ reader_id }) => guard(async () => {
      const res = await api.post<{ id: string; status: string }>(`/api/readers/${encodeURIComponent(reader_id)}/retry`);
      return textResult(`Reader ${res.id} re-queued (status ${res.status}). Poll get_reader until it is "ready".`);
    }),
  );

  server.tool(
    'delete_reader',
    'Delete one of the signed-in user\'s readers and its pages. Illustrations are removed from storage unless a copy shared with a student still uses them. This is permanent; it does not delete copies already shared with students.',
    { reader_id: READER_ID },
    async ({ reader_id }) => guard(async () => {
      await api.delete(`/api/readers/${encodeURIComponent(reader_id)}`);
      return textResult(`Deleted reader ${reader_id}.`);
    }),
  );

  server.tool(
    'share_reader_with_student',
    `${SEND_RULE} Send one of your readers to a student AS HOMEWORK (a real homework assignment, like the app's Send homework sheet): copies the reader (title, pages, pinyin, English, illustrations) into the student's account as a new reader that appears on their next sync. By default (\`mode: "both"\`) it is on their Homework list due by \`due_date\` (default: the student's next logged lesson, else in two days) AND scheduled like their other readers; "one_off" = read once for the homework only (left out of their daily-reader rotation), "fsrs" = the rotation only, no date. You must be the TUTOR in the relationship and own the reader, and the reader must be "ready" (not generating/failed). The copy is independent — later edits to your reader do not reach it (share again for a second copy); the student's reading history lives on their copy. Returns the share id, the student's copy (target_reader_id) and the assignment.`,
    {
      relationship_id: RELATIONSHIP_ID,
      reader_id: READER_ID,
      mode: SEND_MODE,
      due_date: SEND_DUE_DATE,
      today: SEND_TODAY,
      student_name: STUDENT_NAME,
      confirm: CONFIRM_SEND,
    },
    async ({ relationship_id, reader_id, mode, due_date, today, student_name, confirm }) => guard(async () => {
      if (confirm !== true) return errorResult(NEEDS_CONFIRM);
      const student = await resolveStudent(api, ctx.userId, relationship_id, student_name);
      const sent = await sendAsHomework(api, relationship_id, 'reader', reader_id, { mode, due_date, today });
      const first = sent.result.assignments[0];
      const title = sent.copy?.target_name ?? first.title;
      return jsonResult({
        sent: true,
        sent_to: student,
        share: { id: sent.copy?.share_id ?? null, relationship_id, source_reader_id: reader_id, target_reader_id: sent.copy?.target_id ?? first.target_id, shared_at: first.created_at },
        student_reader: { id: sent.copy?.target_id ?? first.target_id, title },
        mode: sent.mode,
        due_date: sent.due_date,
        assignments: assignmentSummary(sent.result.assignments),
        message: sentTo(student.name, `"${title}" ${describeSend(sent.mode, sent.due_date)} — their copy (id=${sent.copy?.target_id ?? first.target_id}) shows up on their device at the next sync.`),
      });
    }),
  );

  server.tool(
    'list_student_readers',
    `Readers shared in a tutor–student relationship, newest first, with the student's read status on their copy: page_count, read_count (times finished and rated), last_read_at, last_rating (0 again · 1 hard · 2 good · 3 easy) and target_deleted when the student removed their copy. Either party of the relationship may call it. Use it to see whether homework readers were read before sharing another.`,
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) => guard(async () => {
      const shares = await api.get<unknown[]>(`/api/relationships/${encodeURIComponent(relationship_id)}/shared-readers`);
      return jsonResult({ count: shares.length, shared_readers: shares });
    }),
  );

  server.tool(
    'export_reader',
    'Export one of the signed-in user\'s readers as text: "md" = Markdown with the pages and a glossary (good for printing or pasting into a message), "json" = re-importable ReaderSpec without server ids (feed it to create_reader for a copy), "csv" = Quizlet-style vocabulary rows from vocabulary_used.',
    {
      reader_id: READER_ID,
      format: z.enum(['md', 'json', 'csv']).describe('Export format'),
    },
    async ({ reader_id, format }) => guard(async () => {
      const body = await api.get<unknown>(`/api/readers/${encodeURIComponent(reader_id)}/export.${format}`);
      return textResult(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    }),
  );
}
