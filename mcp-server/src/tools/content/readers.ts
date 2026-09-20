/**
 * Graded reader tools: list / get / create from a spec / replace / generate
 * with Claude / retry / delete / export, and tutor → student sharing.
 * Everything goes through the main API as the signed-in user (ctx.api), so
 * ownership checks, validation, illustration queues and R2 cleanup are the
 * API's — this module only shapes the calls and the replies.
 */
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { jsonResult, textResult, errorResult, guard } from '../context.js';
import {
  READER_SPEC_DOC,
  readerSpecProblems,
  formatProblems,
  filterReaders,
  type ReaderListRow,
} from './specs.js';

const READER_ID = z.string().describe('The reader id (from list_readers / generate_reader)');
const RELATIONSHIP_ID = z.string().describe('The tutor–student relationship id (from list_students or the students tools)');

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
}

export function registerReaderTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_readers',
    `List the signed-in user's graded readers (short Chinese stories read page by page, with pinyin/English reveal and illustrations). Returns id, titles, difficulty, topic, status (ready | generating | failed), page_count, created_at and creator_role ('tutor' for readers written/imported by hand or shared by a tutor, 'student' for generated ones). Use it to find a reader id before get_reader, update_reader, share_reader_with_student or export_reader. Readers are per-user: a tutor sees their own readers here, not the students' — use list_student_readers for what a student has received.`,
    {
      status: z.enum(['ready', 'generating', 'failed', 'all']).optional().describe('Filter by status (default: all)'),
    },
    async ({ status }) => guard(async () => {
      const rows = await api.get<ReaderListRow[]>('/api/readers', { include_pages: 'true' });
      const readers = filterReaders(rows, status);
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
    `Write a new graded reader by hand from a ReaderSpec (owner = the signed-in user; it appears in their Readers list on the next sync and can be shared with a student via share_reader_with_student). Use this when you author the story yourself — for a story generated from the learner's known vocabulary use generate_reader instead. Every page with an image_prompt gets an illustration generated in the background (returns image_jobs). The spec is validated locally and by the API; problems come back as a list to fix.
${READER_SPEC_DOC}`,
    { spec: readerSpecShape.describe('The complete ReaderSpec (see the tool description)') },
    async ({ spec }) => guard(async () => {
      const problems = readerSpecProblems(spec);
      if (problems.length > 0) return errorResult(formatProblems('Reader spec', problems));
      const created = await api.post<{ id: string; status: string; image_jobs?: number; spec: unknown }>('/api/readers/import', { spec });
      return jsonResult({
        id: created.id,
        status: created.status,
        image_jobs: created.image_jobs ?? 0,
        message: `Created reader "${spec.title_english}" (id=${created.id}).${created.image_jobs ? ` ${created.image_jobs} illustration(s) generating in the background.` : ''}`,
      });
    }),
  );

  server.tool(
    'update_reader',
    `Replace a graded reader's content in place with a FULL ReaderSpec (same reader id, so the learner's reading history and FSRS schedule carry over). Fetch the current spec with get_reader, edit it, and send the whole thing back — pages are matched by id: keep a page's "id" to update that page (its illustration is kept when image_prompt is unchanged, regenerated when the prompt changed), omit the id for a brand-new page, leave a page out to delete it, and reorder the array to reorder pages. A page sent without its id is a NEW page — its old illustration is dropped. Returns image_jobs for prompts queued. Validated locally and by the API; problems come back as a list.
${READER_SPEC_DOC}`,
    {
      reader_id: READER_ID,
      spec: readerSpecShape.describe('The complete revised ReaderSpec — it replaces the stored one entirely'),
    },
    async ({ reader_id, spec }) => guard(async () => {
      const problems = readerSpecProblems(spec);
      if (problems.length > 0) return errorResult(formatProblems('Reader spec', problems));
      const res = await api.put<SpecResponse>(`/api/readers/${encodeURIComponent(reader_id)}/spec`, { spec });
      return jsonResult({
        id: res.id,
        status: res.status,
        image_jobs: res.image_jobs ?? 0,
        page_count: Array.isArray((res.spec as { pages?: unknown[] })?.pages) ? (res.spec as { pages: unknown[] }).pages.length : undefined,
        message: `Updated reader ${res.id}. The device picks up the new content on its next sync; reading history is unchanged.${res.image_jobs ? ` ${res.image_jobs} illustration(s) generating in the background.` : ''}`,
      });
    }),
  );

  server.tool(
    'generate_reader',
    `Ask Claude (server-side, on a queue) to write a graded reader from vocabulary the signed-in user has ALREADY LEARNED in the given decks — a story that only uses words they know, at the chosen difficulty, optionally about a topic. Returns immediately with the reader id and status "generating"; the story, pinyin, English and illustrations arrive over the next minute or two — poll get_reader until status is "ready" (or "failed", then retry_reader). Needs at least 5 learned words in the decks (the API says so if not — then create_reader by hand is the alternative). The reader belongs to the caller: a tutor who wants a story for a student generates it from their OWN decks (e.g. the homework deck they share) and then share_reader_with_student.`,
    {
      deck_ids: z.array(z.string()).min(1).describe('Deck ids (from list_decks) whose learned vocabulary the story is built from'),
      topic: z.string().optional().describe('What the story should be about, e.g. "a trip to the night market"'),
      difficulty: z.enum(['beginner', 'elementary', 'intermediate', 'advanced']).optional().describe('Reading level (default beginner)'),
    },
    async ({ deck_ids, topic, difficulty }) => guard(async () => {
      const created = await api.post<{ id: string; status: string; title_english?: string }>('/api/readers/generate', {
        source: 'decks',
        deck_ids,
        topic,
        difficulty: difficulty ?? 'beginner',
      });
      return jsonResult({
        id: created.id,
        status: created.status ?? 'generating',
        message: `Reader ${created.id} is generating${topic ? ` (topic: ${topic})` : ''}. Poll get_reader(reader_id="${created.id}") every ~15 seconds until status is "ready".`,
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
    `Send one of your readers to a student: copies the reader (title, pages, pinyin, English, illustrations) into the student's account as a new reader that appears in their Readers list on their next sync and is scheduled like their other readers. You must be the TUTOR in the relationship and own the reader, and the reader must be "ready" (not generating/failed). The copy is independent — later edits to your reader do not reach it (share again for a second copy); the student's reading history lives on their copy. Returns the share record and the student's copy (its id is target_reader_id).`,
    {
      relationship_id: RELATIONSHIP_ID,
      reader_id: READER_ID,
    },
    async ({ relationship_id, reader_id }) => guard(async () => {
      const res = await api.post<{
        share: { id: string; relationship_id: string; source_reader_id: string; target_reader_id: string; shared_at: string };
        reader: { id: string; title_chinese: string; title_english: string; pages?: unknown[] };
      }>(`/api/relationships/${encodeURIComponent(relationship_id)}/share-reader`, { reader_id });
      return jsonResult({
        share: res.share,
        student_reader: {
          id: res.reader.id,
          title_chinese: res.reader.title_chinese,
          title_english: res.reader.title_english,
          page_count: Array.isArray(res.reader.pages) ? res.reader.pages.length : undefined,
        },
        message: `Shared "${res.reader.title_english}" — the student's copy (id=${res.reader.id}) shows up on their device at the next sync.`,
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
