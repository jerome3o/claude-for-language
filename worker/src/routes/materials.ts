/**
 * Lesson materials (round 4; services/materials; docs/VIDEO_CALLS.md "Lesson materials").
 *
 *   GET    /materials?relationship_id=            mine + shared with me (or only those shared in one relationship)
 *   POST   /materials                             { title?, file_name, mime_type, size } → 201 { material } (status uploading)
 *   PUT    /materials/:id/original                raw file bytes (≤ 50 MB) — the original, kept for download
 *   PUT    /materials/:id/pages/:n                raw JPEG / PNG / WebP — page n (0-based) as rendered on the uploader's device
 *   POST   /materials/:id/complete                { pages: [{ index, text?, notes? }], render_note?, toc? } → { material } (ready)
 *   GET    /materials/:id                         { material (+ toc: [{ title, page, level }] | null), pages: [{ page_index, width, height, text, notes, image_url }] }
 *   GET    /materials/:id/pages/:n/image          the page picture (owner / shared)
 *   GET    /materials/:id/original                the original file
 *   GET    /materials/:id/text?from=&to=          page texts (agents, MCP): { material, pages: [{ page, text, notes }] }
 *   PATCH  /materials/:id                         { title?, toc? } (toc: the uploader's device filling in an older material's Contents)
 *   DELETE /materials/:id                         rows + R2 (owner)
 *   POST   /materials/:id/share                   { relationship_id } · DELETE /materials/:id/share/:relId
 *   GET    /materials/:id/annotations?lesson_id=  kept drawings / text per page in a lesson { pages: { [page]: KeptAnnotations } }
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  completeMaterial,
  createMaterial,
  deleteMaterial,
  listMaterials,
  listPages,
  materialJson,
  MaterialError,
  pageJson,
  requireMaterial,
  tocColumn,
  requireOwnMaterial,
  shareMaterial,
  storeOriginal,
  storePage,
  unshareMaterial,
} from '../services/materials';
import { cleanMaterialTitle, MAX_MATERIAL_BYTES, MAX_PAGE_IMAGE_BYTES } from '@shared/materials';

const materials = new Hono<{ Bindings: Env }>();

function fail(c: { json: (b: unknown, s?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof MaterialError) return c.json({ error: error.message }, error.status);
  console.error('[materials]', error);
  return c.json({ error: fallback }, 500);
}

async function readBody(req: Request, max: number): Promise<ArrayBuffer> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw new MaterialError(413, `Too big (${Math.round(len / 1024 / 1024)} MB)`);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) throw new MaterialError(413, 'Too big');
  return buf;
}

materials.get('/materials', async (c) => {
  try {
    return c.json({ materials: await listMaterials(c.env.DB, c.get('user').id, { relationshipId: c.req.query('relationship_id') || undefined }) });
  } catch (error) {
    return fail(c, error, 'Failed to load materials');
  }
});

materials.post('/materials', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const m = await createMaterial(c.env.DB, c.get('user').id, body);
    return c.json({ material: materialJson(m, { mine: true }) }, 201);
  } catch (error) {
    return fail(c, error, 'Failed to add the material');
  }
});

materials.put('/materials/:id/original', async (c) => {
  try {
    const m = await requireOwnMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    await storeOriginal(c.env, m, await readBody(c.req.raw, MAX_MATERIAL_BYTES));
    return c.json({ ok: true });
  } catch (error) {
    return fail(c, error, 'Failed to upload the file');
  }
});

materials.put('/materials/:id/pages/:n', async (c) => {
  try {
    const m = await requireOwnMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    await storePage(c.env, m, Number(c.req.param('n')), await readBody(c.req.raw, MAX_PAGE_IMAGE_BYTES));
    return c.json({ ok: true });
  } catch (error) {
    return fail(c, error, 'Failed to upload the page');
  }
});

materials.post('/materials/:id/complete', async (c) => {
  try {
    const m = await requireOwnMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const done = await completeMaterial(c.env.DB, m, body);
    return c.json({ material: materialJson(done, { mine: true }, { toc: true }) });
  } catch (error) {
    return fail(c, error, 'Failed to finish the upload');
  }
});

materials.get('/materials/:id', async (c) => {
  try {
    const { material, mine } = await requireMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    const pages = await listPages(c.env.DB, material.id);
    return c.json({ material: materialJson(material, { mine }, { toc: true }), pages: pages.map(pageJson) });
  } catch (error) {
    return fail(c, error, 'Failed to load the material');
  }
});

materials.get('/materials/:id/pages/:n/image', async (c) => {
  try {
    const { material } = await requireMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    const row = await c.env.DB
      .prepare('SELECT image_key FROM material_pages WHERE material_id = ? AND page_index = ?')
      .bind(material.id, Number(c.req.param('n')))
      .first<{ image_key: string | null }>();
    if (!row?.image_key) throw new MaterialError(404, 'Page not found');
    const obj = await c.env.AUDIO_BUCKET.get(row.image_key);
    if (!obj) throw new MaterialError(404, 'Page not found');
    return new Response(obj.body, {
      headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  } catch (error) {
    return fail(c, error, 'Failed to load the page');
  }
});

materials.get('/materials/:id/original', async (c) => {
  try {
    const { material } = await requireMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    if (!material.original_key) throw new MaterialError(404, 'No original file');
    const obj = await c.env.AUDIO_BUCKET.get(material.original_key);
    if (!obj) throw new MaterialError(404, 'No original file');
    const name = (material.file_name || 'material').replace(/[^\w.\- ]+/g, '_');
    return new Response(obj.body, {
      headers: { 'Content-Type': material.mime_type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` },
    });
  } catch (error) {
    return fail(c, error, 'Failed to download the file');
  }
});

materials.get('/materials/:id/text', async (c) => {
  try {
    const { material } = await requireMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    const from = Math.max(1, Number(c.req.query('from')) || 1);
    const to = Math.min(material.page_count || 1, Number(c.req.query('to')) || material.page_count || 1);
    const pages = (await listPages(c.env.DB, material.id)).filter((p) => p.page_index + 1 >= from && p.page_index + 1 <= to);
    return c.json({
      material: { id: material.id, title: material.title, kind: material.kind, page_count: material.page_count, render_note: material.render_note },
      pages: pages.map((p) => ({ page: p.page_index + 1, text: p.text ?? '', notes: p.notes ?? '' })),
    });
  } catch (error) {
    return fail(c, error, 'Failed to read the material');
  }
});

materials.patch('/materials/:id', async (c) => {
  try {
    const m = await requireOwnMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    const body = await c.req.json<{ title?: unknown; toc?: unknown }>().catch(() => ({} as { title?: unknown; toc?: unknown }));
    let next = m;
    if (body.title !== undefined) {
      const title = cleanMaterialTitle(body.title);
      if (!title) throw new MaterialError(400, 'Give it a title');
      await c.env.DB.prepare('UPDATE materials SET title = ?, updated_at = ? WHERE id = ?').bind(title, Date.now(), m.id).run();
      next = { ...next, title };
    }
    if (body.toc !== undefined) {
      // The Contents is no edit of the material: updated_at stays.
      const toc = tocColumn(body.toc, m.page_count);
      if (toc === null) throw new MaterialError(400, 'Contents must be a list');
      await c.env.DB.prepare('UPDATE materials SET toc = ? WHERE id = ?').bind(toc, m.id).run();
      next = { ...next, toc };
    }
    if (body.title === undefined && body.toc === undefined) throw new MaterialError(400, 'Give it a title');
    return c.json({ material: materialJson(next, { mine: true }, { toc: true }) });
  } catch (error) {
    return fail(c, error, 'Failed to rename');
  }
});

materials.delete('/materials/:id', async (c) => {
  try {
    const m = await requireOwnMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    await deleteMaterial(c.env, m);
    return c.json({ ok: true });
  } catch (error) {
    return fail(c, error, 'Failed to delete');
  }
});

materials.post('/materials/:id/share', async (c) => {
  try {
    const user = c.get('user');
    const m = await requireOwnMaterial(c.env.DB, c.req.param('id'), user.id);
    const body = await c.req.json<{ relationship_id?: string }>().catch(() => ({} as { relationship_id?: string }));
    if (!body.relationship_id) throw new MaterialError(400, 'Pick a student');
    await shareMaterial(c.env.DB, m, body.relationship_id, user.id);
    return c.json({ ok: true });
  } catch (error) {
    return fail(c, error, 'Failed to share');
  }
});

materials.delete('/materials/:id/share/:relId', async (c) => {
  try {
    const m = await requireOwnMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    await unshareMaterial(c.env.DB, m.id, c.req.param('relId'));
    return c.json({ ok: true });
  } catch (error) {
    return fail(c, error, 'Failed to stop sharing');
  }
});

materials.get('/materials/:id/annotations', async (c) => {
  try {
    const { material } = await requireMaterial(c.env.DB, c.req.param('id'), c.get('user').id);
    const lessonId = c.req.query('lesson_id') || '';
    const rows = await c.env.DB
      .prepare('SELECT page_index, data FROM material_annotations WHERE material_id = ? AND lesson_id = ?')
      .bind(material.id, lessonId)
      .all<{ page_index: number; data: string }>();
    const pages: Record<number, unknown> = {};
    for (const r of rows.results ?? []) {
      try {
        pages[r.page_index] = JSON.parse(r.data);
      } catch {
        /* skip */
      }
    }
    return c.json({ pages });
  } catch (error) {
    return fail(c, error, 'Failed to load the drawings');
  }
});

export default materials;
