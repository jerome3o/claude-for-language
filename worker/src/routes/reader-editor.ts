/**
 * Graded-reader editor: whole-reader spec read/replace, JSON import, exports
 * and a small text-assist endpoint for the form (translate / image prompt
 * for text that isn't saved yet).
 *
 * Mounted at /api after the auth middleware, so c.get('user') is set.
 * The Claude co-editor chat for readers lives in routes/lesson-editor.ts
 * (target type 'reader'), sharing the editor_chats tables.
 *
 *   GET  /readers/:id/spec
 *   PUT  /readers/:id/spec               { spec }
 *   POST /readers/import                 { spec }
 *   GET  /readers/:id/export.(md|json|csv)
 *   POST /readers/:id/assist             { field: 'english'|'image_prompt', chinese, english? }
 */

import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import {
  ReaderSpec,
  validateReaderSpec,
  normalizeReaderSpec,
  readerToMarkdown,
  readerToJson,
  readerToCsv,
  readerExportFilename,
} from '@shared/reader';
import { Env } from '../types';
import * as db from '../db/queries';
import { readerToSpec, applyReaderSpec, createReaderFromSpec } from '../db/reader-editor-queries';
import { unreferencedImageKeys } from '../services/shared-readers';

type AppEnv = { Bindings: Env };

const readerEditor = new Hono<AppEnv>();

/** Queue illustration jobs the same way generated readers do; returns how many. */
async function queueReaderImages(env: Env, readerId: string, jobs: Array<{ pageId: string; imagePrompt: string }>): Promise<number> {
  if (jobs.length === 0 || !env.GEMINI_API_KEY || !env.IMAGE_QUEUE) return 0;
  try {
    await env.IMAGE_QUEUE.sendBatch(jobs.map(job => ({
      body: { readerId, pageId: job.pageId, imagePrompt: job.imagePrompt, totalPages: jobs.length },
    })));
    return jobs.length;
  } catch (err) {
    console.error('[reader-editor] Failed to queue images:', err);
    return 0;
  }
}

/** Delete stale illustration keys — except any a shared copy (tutor → student)
 * of another reader still references; see services/shared-readers.ts. */
async function deleteImages(env: Env, keys: string[], readerId: string): Promise<void> {
  for (const key of await unreferencedImageKeys(env.DB, keys, readerId)) {
    try {
      await env.AUDIO_BUCKET.delete(key);
    } catch (err) {
      console.error('[reader-editor] Failed to delete image:', key, err);
    }
  }
}

export function readerExportResponse(spec: ReaderSpec, format: string): Response | null {
  let body: string;
  let type: string;
  let ext: 'md' | 'json' | 'csv';
  switch (format) {
    case 'md':
      body = readerToMarkdown(spec); type = 'text/markdown; charset=utf-8'; ext = 'md'; break;
    case 'json':
      body = readerToJson(spec); type = 'application/json; charset=utf-8'; ext = 'json'; break;
    case 'csv':
      body = readerToCsv(spec); type = 'text/csv; charset=utf-8'; ext = 'csv'; break;
    default:
      return null;
  }
  const filename = readerExportFilename(spec, ext);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

// ============ Import (before /:id routes so "import" is never an id) ============

readerEditor.post('/readers/import', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ spec?: unknown }>().catch(() => ({} as { spec?: unknown }));
  const errors = validateReaderSpec(body.spec);
  if (errors.length > 0) return c.json({ error: 'Invalid reader spec', problems: errors }, 400);
  const spec = normalizeReaderSpec(body.spec as ReaderSpec);
  const { reader, imageJobs } = await createReaderFromSpec(c.env.DB, userId, spec);
  const queued = await queueReaderImages(c.env, reader.id, imageJobs);
  return c.json({ ...reader, spec: readerToSpec(reader), image_jobs: queued }, 201);
});

// ============ Spec read / replace ============

readerEditor.get('/readers/:id/spec', async (c) => {
  const userId = c.get('user').id;
  const reader = await db.getGradedReader(c.env.DB, c.req.param('id'), userId);
  if (!reader) return c.json({ error: 'Reader not found' }, 404);
  return c.json({
    id: reader.id,
    status: reader.status,
    is_published: reader.is_published ?? 1,
    created_at: reader.created_at,
    spec: readerToSpec(reader),
  });
});

readerEditor.put('/readers/:id/spec', async (c) => {
  const userId = c.get('user').id;
  const existing = await db.getGradedReader(c.env.DB, c.req.param('id'), userId);
  if (!existing) return c.json({ error: 'Reader not found' }, 404);
  const body = await c.req.json<{ spec?: unknown }>().catch(() => ({} as { spec?: unknown }));
  const errors = validateReaderSpec(body.spec);
  if (errors.length > 0) return c.json({ error: 'Invalid reader spec', problems: errors }, 400);
  const spec = normalizeReaderSpec(body.spec as ReaderSpec);

  const applied = await applyReaderSpec(c.env.DB, existing, spec);
  await deleteImages(c.env, applied.removedImageKeys, existing.id);
  const queued = await queueReaderImages(c.env, existing.id, applied.imageJobs);

  const updated: typeof existing = {
    ...existing,
    title_chinese: spec.title_chinese,
    title_english: spec.title_english,
    difficulty_level: spec.difficulty_level,
    topic: spec.topic ?? null,
    vocabulary_used: spec.vocabulary_used ?? [],
    pages: applied.pages,
  };
  return c.json({
    id: updated.id,
    status: updated.status,
    is_published: updated.is_published ?? 1,
    created_at: updated.created_at,
    spec: readerToSpec(updated),
    image_jobs: queued,
  });
});

// ============ Exports ============

readerEditor.get('/readers/:id/:file{export\\.(md|json|csv)}', async (c) => {
  const userId = c.get('user').id;
  const reader = await db.getGradedReader(c.env.DB, c.req.param('id'), userId);
  if (!reader) return c.json({ error: 'Reader not found' }, 404);
  const res = readerExportResponse(readerToSpec(reader), (c.req.param('file') ?? '').replace(/^export\./, ''));
  return res ?? c.json({ error: 'Unknown export format' }, 400);
});

// ============ Text assist for the form ============

/** Translate a page or draft an illustration prompt for text that may not
 * be saved yet (the older per-page generate-text route needs a stored page). */
readerEditor.post('/readers/:id/assist', async (c) => {
  const userId = c.get('user').id;
  const reader = await db.getGradedReader(c.env.DB, c.req.param('id'), userId);
  if (!reader) return c.json({ error: 'Reader not found' }, 404);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured' }, 503);

  const body = await c.req.json<{ field?: unknown; chinese?: unknown; english?: unknown }>().catch(() => ({} as { field?: unknown; chinese?: unknown; english?: unknown }));
  const field = body.field === 'english' || body.field === 'image_prompt' ? body.field : null;
  const chinese = typeof body.chinese === 'string' ? body.chinese.trim() : '';
  const english = typeof body.english === 'string' ? body.english.trim() : '';
  if (!field) return c.json({ error: 'field must be "english" or "image_prompt"' }, 400);
  if (!chinese) return c.json({ error: 'chinese is required' }, 400);

  const system = field === 'english'
    ? `You translate pages of a ${reader.difficulty_level}-level Chinese graded reader ("${reader.title_english}") into natural English. Output only the translation.`
    : `You write prompts for warm children's-storybook illustrations of a Chinese graded reader ("${reader.title_english}"). Describe the scene in English in 1-2 sentences, consistent characters, no text in the image. Output only the prompt.`;
  const user = field === 'english' ? chinese : `Page text: ${chinese}${english ? `\nEnglish: ${english}` : ''}`;

  try {
    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text.trim()).join('\n').trim();
    return c.json({ text });
  } catch (err) {
    console.error('[reader-editor] assist failed:', err);
    return c.json({ error: 'Claude is unavailable right now' }, 502);
  }
});

export default readerEditor;
