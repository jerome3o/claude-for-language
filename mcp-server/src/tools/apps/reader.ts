/**
 * `review_reader` app: a graded reader page by page (Chinese large, pinyin,
 * English, illustration), editable in place, saved whole through
 * `PUT /api/readers/:id/spec`, and sent to a student with the share-reader
 * endpoint.
 */
import { z } from 'zod';
import { normalizeReaderSpec, validateReaderSpec } from '../../../../shared/reader/validate';
import type { ToolContext } from '../context.js';
import { registerApp } from '../apps.js';
import { appResult, appTool, loadStudents, mediaBase, toStudentPick, withProblems } from './shared.js';
import type { ReaderPayload, ReaderSaveResult, ReaderSpec, StudentPick } from './types.js';

interface ReaderSpecResponse {
  id: string;
  status: string;
  is_published: number;
  created_at: string;
  spec: ReaderSpec;
  image_jobs?: unknown[];
}

/** Ids of the readers already shared into a relationship (sibling endpoint; tolerant of its shape). */
async function sharedReaderIds(ctx: ToolContext, relationshipId: string): Promise<Set<string>> {
  try {
    const res = await ctx.api.get<unknown>(`/api/relationships/${encodeURIComponent(relationshipId)}/shared-readers`);
    const rows: unknown[] = Array.isArray(res)
      ? res
      : res && typeof res === 'object'
        ? ((res as { shared_readers?: unknown[]; readers?: unknown[] }).shared_readers ??
          (res as { readers?: unknown[] }).readers ??
          [])
        : [];
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      for (const key of ['source_reader_id', 'reader_id', 'id']) {
        if (typeof r[key] === 'string') ids.add(r[key] as string);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

async function readerStudents(ctx: ToolContext, readerId: string): Promise<ReaderPayload['students']> {
  const students = (await loadStudents(ctx)).map(toStudentPick);
  const shared = await Promise.all(students.map((s: StudentPick) => sharedReaderIds(ctx, s.relationship_id)));
  return students.map((s, i) => ({ ...s, already_shared: shared[i].has(readerId) }));
}

export function readerSummary(spec: ReaderSpec): string {
  const pages = spec.pages.map((p, i) => `${i + 1}. ${p.content_chinese} — ${p.content_english}`);
  return `《${spec.title_chinese}》 ${spec.title_english} (${spec.difficulty_level}${spec.topic ? `, ${spec.topic}` : ''}), ${spec.pages.length} pages:\n${pages.join('\n')}`;
}

export function registerReaderApp(ctx: ToolContext): void {
  const resourceUri = registerApp(ctx, 'review_reader');

  appTool(
    ctx,
    'review_reader',
    {
      title: 'Review a reader',
      description:
        'Open a graded reader in the interactive reviewer: every page with its Chinese text, pinyin, English and illustration, editable in place (texts, image prompts, titles, add / delete / reorder pages), with Save, Send to a student, and an "Ask Claude to revise" box that turns the tutor\'s instruction into a chat message. After generating or editing a reader (or when the tutor asks to see, check, tweak or send one), open it here so the tutor can review it page by page and send it to a student. Takes the reader id from list_readers / generate_reader.',
      inputSchema: { reader_id: z.string().describe('The reader id') },
      resourceUri,
    },
    async ({ reader_id }) => {
      const [res, students] = await Promise.all([
        ctx.api.get<ReaderSpecResponse>(`/api/readers/${encodeURIComponent(reader_id)}/spec`),
        readerStudents(ctx, reader_id),
      ]);
      const payload: ReaderPayload = {
        kind: 'review_reader',
        reader: { id: res.id, status: res.status, is_published: res.is_published, created_at: res.created_at },
        spec: res.spec,
        media_base: mediaBase(ctx),
        students,
      };
      return appResult(`Opened reader ${res.id} for review.\n${readerSummary(res.spec)}`, payload as unknown as Record<string, unknown>);
    },
  );

  appTool(
    ctx,
    'app_save_reader_spec',
    {
      title: 'Save reader',
      description:
        'Replace the whole reader with the edited spec (called by the reader UI). Keeps page ids so unchanged illustrations survive; changed or new image prompts are queued for illustration.',
      inputSchema: {
        reader_id: z.string(),
        spec: z.record(z.unknown()).describe('The full ReaderSpec'),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ reader_id, spec }) => {
      const problems = validateReaderSpec(spec);
      if (problems.length > 0) {
        const result: ReaderSaveResult = { ok: false, problems };
        return appResult(`Reader not saved: ${problems.join('; ')}`, result as unknown as Record<string, unknown>);
      }
      const clean = normalizeReaderSpec(spec as unknown as ReaderSpec);
      const saved = await withProblems(() =>
        ctx.api.put<ReaderSpecResponse>(`/api/readers/${encodeURIComponent(reader_id)}/spec`, { spec: clean }),
      );
      if (!saved.ok) {
        const result: ReaderSaveResult = { ok: false, problems: saved.problems };
        return appResult(`Reader not saved: ${saved.problems.join('; ')}`, result as unknown as Record<string, unknown>);
      }
      const result: ReaderSaveResult = {
        ok: true,
        spec: saved.value.spec,
        image_jobs: Array.isArray(saved.value.image_jobs) ? saved.value.image_jobs.length : 0,
      };
      return appResult(`Reader ${reader_id} saved.\n${readerSummary(saved.value.spec)}`, result as unknown as Record<string, unknown>);
    },
  );

  appTool(
    ctx,
    'app_share_reader',
    {
      title: 'Send reader to a student',
      description: "Copy this reader to a student's account (called by the reader UI).",
      inputSchema: {
        relationship_id: z.string(),
        reader_id: z.string(),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ relationship_id, reader_id }) => {
      const res = await ctx.api.post<Record<string, unknown>>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/share-reader`,
        { reader_id },
      );
      return appResult(`Reader ${reader_id} sent to relationship ${relationship_id}.`, { ok: true, result: res });
    },
  );
}
