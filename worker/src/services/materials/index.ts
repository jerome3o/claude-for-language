/**
 * Lesson materials (migration 0090; shared/materials): rows, access, R2 keys.
 *
 * Access: the owner (the tutor who uploaded it), and either person of an
 * active relationship it is shared with. Presenting a material in a call of
 * a relationship shares it there (so the student can see the pages during
 * and after the lesson). Originals and pages live under
 * `materials/<owner>/<id>/` in R2 — person-made, never collected
 * (admin/storage-cleanup.ts), removed by deleting the material or the account.
 */

import { generateId } from '../cards';
import { sniffImage } from '../picture-hunt';
import {
  cleanMaterialTitle,
  cleanPageText,
  materialFileProblem,
  materialKindOf,
  materialText,
  sanitizeToc,
  titleFromFileName,
  MAX_MATERIAL_PAGES,
  MAX_PAGE_IMAGE_BYTES,
  type MaterialKind,
  type MaterialStatus,
} from '@shared/materials';

export class MaterialError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 413, message: string) {
    super(message);
  }
}

export const MATERIAL_PREFIX = 'materials/';

export interface MaterialRow {
  id: string;
  owner_id: string;
  title: string;
  kind: MaterialKind;
  file_name: string | null;
  mime_type: string | null;
  original_key: string | null;
  original_size: number | null;
  status: MaterialStatus;
  page_count: number;
  render_note: string | null;
  text: string | null;
  /** Contents JSON (shared/materials/toc.ts; migration 0109): NULL = never computed. */
  toc?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface MaterialPageRow {
  material_id: string;
  page_index: number;
  image_key: string | null;
  width: number | null;
  height: number | null;
  text: string | null;
  notes: string | null;
}

/** The stored Contents, checked (null = never computed / unreadable). */
export function parseToc(m: Pick<MaterialRow, 'toc' | 'page_count'>) {
  if (!m.toc) return null;
  try {
    return sanitizeToc(JSON.parse(m.toc), m.page_count);
  } catch {
    return null;
  }
}

/** Contents sent by the uploader's device, as stored (null = nothing usable sent). */
export function tocColumn(raw: unknown, pageCount: number): string | null {
  const toc = sanitizeToc(raw, pageCount);
  return toc ? JSON.stringify(toc) : null;
}

/**
 * What the API returns for a material (no keys; page pictures by URL). `toc`
 * (the Contents, null = never computed) only on one material, not in lists.
 */
export function materialJson(
  m: MaterialRow,
  extra: { owner_name?: string | null; shared_with?: string[]; mine?: boolean } = {},
  opts: { toc?: boolean } = {},
) {
  const { original_key: _k, text: _t, deleted_at: _d, toc: _toc, ...rest } = m;
  return { ...rest, has_text: !!(m.text && m.text.trim()), ...(opts.toc ? { toc: parseToc(m) } : {}), ...extra };
}

export function pageJson(p: MaterialPageRow) {
  return {
    page_index: p.page_index,
    width: p.width,
    height: p.height,
    text: p.text ?? '',
    notes: p.notes ?? '',
    image_url: p.image_key ? `/api/materials/${p.material_id}/pages/${p.page_index}/image` : null,
  };
}

export async function getMaterial(db: D1Database, id: string): Promise<MaterialRow | null> {
  return db.prepare('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL').bind(id).first<MaterialRow>();
}

/** The relationships (active, mine) this material is shared in. */
async function sharedRelationshipsFor(db: D1Database, materialId: string, userId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT s.relationship_id AS id FROM material_shares s JOIN tutor_relationships r ON r.id = s.relationship_id
        WHERE s.material_id = ? AND r.status = 'active' AND (r.requester_id = ? OR r.recipient_id = ?)`,
    )
    .bind(materialId, userId, userId)
    .all<{ id: string }>();
  return (rows.results ?? []).map((r) => r.id);
}

/** A material the user may see (owner, or shared in one of their relationships), else 404. */
export async function requireMaterial(db: D1Database, id: string, userId: string): Promise<{ material: MaterialRow; mine: boolean }> {
  const m = await getMaterial(db, id);
  if (!m) throw new MaterialError(404, 'Material not found');
  if (m.owner_id === userId) return { material: m, mine: true };
  if ((await sharedRelationshipsFor(db, id, userId)).length > 0) return { material: m, mine: false };
  throw new MaterialError(404, 'Material not found');
}

export async function requireOwnMaterial(db: D1Database, id: string, userId: string): Promise<MaterialRow> {
  const { material, mine } = await requireMaterial(db, id, userId);
  if (!mine) throw new MaterialError(403, 'Only the person who uploaded it can change it');
  return material;
}

export async function createMaterial(
  db: D1Database,
  ownerId: string,
  input: { title?: unknown; file_name?: unknown; mime_type?: unknown; size?: unknown },
): Promise<MaterialRow> {
  const fileName = typeof input.file_name === 'string' ? input.file_name.slice(0, 200) : '';
  const mime = typeof input.mime_type === 'string' ? input.mime_type.slice(0, 120) : null;
  const size = Number(input.size);
  const problem = materialFileProblem(fileName, mime, size);
  if (problem) throw new MaterialError(size > 0 && problem.includes('MB') ? 413 : 400, problem);
  const kind = materialKindOf(fileName, mime)!;
  const title = cleanMaterialTitle(input.title) ?? titleFromFileName(fileName);
  const id = generateId();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO materials (id, owner_id, title, kind, file_name, mime_type, original_size, status, page_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', 0, ?, ?)`,
    )
    .bind(id, ownerId, title, kind, fileName, mime, size, now, now)
    .run();
  return (await getMaterial(db, id))!;
}

const extOf = (fileName: string | null) => ((fileName ?? '').split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';

export function originalKey(m: Pick<MaterialRow, 'owner_id' | 'id' | 'file_name'>): string {
  return `${MATERIAL_PREFIX}${m.owner_id}/${m.id}/original.${extOf(m.file_name)}`;
}

export function pageKey(m: Pick<MaterialRow, 'owner_id' | 'id'>, page: number, ext: string): string {
  return `${MATERIAL_PREFIX}${m.owner_id}/${m.id}/p${page}.${ext}`;
}

export async function storeOriginal(env: { DB: D1Database; AUDIO_BUCKET: R2Bucket }, m: MaterialRow, body: ArrayBuffer): Promise<void> {
  if (body.byteLength === 0) throw new MaterialError(400, 'The file is empty');
  if (m.original_size && body.byteLength > m.original_size * 1.05 + 1024) throw new MaterialError(413, 'The file is larger than announced');
  const key = originalKey(m);
  await env.AUDIO_BUCKET.put(key, body, { httpMetadata: { contentType: m.mime_type || 'application/octet-stream' } });
  await env.DB.prepare('UPDATE materials SET original_key = ?, original_size = ?, updated_at = ? WHERE id = ?').bind(key, body.byteLength, Date.now(), m.id).run();
}

export async function storePage(env: { DB: D1Database; AUDIO_BUCKET: R2Bucket }, m: MaterialRow, page: number, body: ArrayBuffer): Promise<void> {
  if (!Number.isInteger(page) || page < 0 || page >= MAX_MATERIAL_PAGES) throw new MaterialError(400, 'Bad page number');
  if (body.byteLength > MAX_PAGE_IMAGE_BYTES) throw new MaterialError(413, 'The page picture is too big');
  const bytes = new Uint8Array(body);
  const img = sniffImage(bytes);
  if (!img) throw new MaterialError(400, 'A page must be a JPEG, PNG or WebP picture');
  const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg';
  const key = pageKey(m, page, ext);
  await env.AUDIO_BUCKET.put(key, body, { httpMetadata: { contentType: img.mime } });
  await env.DB
    .prepare(
      `INSERT INTO material_pages (material_id, page_index, image_key, width, height) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (material_id, page_index) DO UPDATE SET image_key = excluded.image_key, width = excluded.width, height = excluded.height`,
    )
    .bind(m.id, page, key, img.width || null, img.height || null)
    .run();
}

/** The upload is done: the pages' text and the page count; the material is ready. */
export async function completeMaterial(
  db: D1Database,
  m: MaterialRow,
  input: { pages?: unknown; render_note?: unknown; toc?: unknown },
): Promise<MaterialRow> {
  const raw = Array.isArray(input.pages) ? input.pages.slice(0, MAX_MATERIAL_PAGES) : [];
  const pages = raw
    .map((p) => p as Record<string, unknown>)
    .filter((p) => Number.isInteger(Number(p.index)) && Number(p.index) >= 0)
    .map((p) => ({ page_index: Number(p.index), text: cleanPageText(p.text), notes: cleanPageText(p.notes) }));
  const stored = await db.prepare('SELECT page_index FROM material_pages WHERE material_id = ? AND image_key IS NOT NULL').bind(m.id).all<{ page_index: number }>();
  const have = new Set((stored.results ?? []).map((r) => r.page_index));
  if (have.size === 0) throw new MaterialError(409, 'No page pictures were uploaded');
  const count = Math.max(...have) + 1;
  for (let i = 0; i < count; i++) if (!have.has(i)) throw new MaterialError(409, `Page ${i + 1} is missing`);
  const stmts = pages
    .filter((p) => p.page_index < count)
    .map((p) => db.prepare('UPDATE material_pages SET text = ?, notes = ? WHERE material_id = ? AND page_index = ?').bind(p.text || null, p.notes || null, m.id, p.page_index));
  const note = typeof input.render_note === 'string' ? input.render_note.slice(0, 300) : null;
  stmts.push(
    db
      .prepare(`UPDATE materials SET status = 'ready', page_count = ?, render_note = ?, text = ?, toc = ?, updated_at = ? WHERE id = ?`)
      .bind(count, note, materialText(pages.filter((p) => p.page_index < count)) || null, tocColumn(input.toc, count), Date.now(), m.id),
  );
  await db.batch(stmts);
  return (await getMaterial(db, m.id))!;
}

export async function listPages(db: D1Database, materialId: string): Promise<MaterialPageRow[]> {
  const rows = await db.prepare('SELECT * FROM material_pages WHERE material_id = ? ORDER BY page_index').bind(materialId).all<MaterialPageRow>();
  return rows.results ?? [];
}

/** Mine + shared with me (optionally only those shared in one relationship). */
export async function listMaterials(db: D1Database, userId: string, opts: { relationshipId?: string } = {}) {
  const rel = opts.relationshipId ?? null;
  const rows = await db
    .prepare(
      `SELECT m.*, COALESCE(u.name, u.email) AS owner_name,
              (SELECT group_concat(s.relationship_id) FROM material_shares s WHERE s.material_id = m.id) AS shared_csv
         FROM materials m JOIN users u ON u.id = m.owner_id
        WHERE m.deleted_at IS NULL
          AND (?2 IS NULL OR EXISTS (SELECT 1 FROM material_shares s2 WHERE s2.material_id = m.id AND s2.relationship_id = ?2))
          AND (m.owner_id = ?1 OR EXISTS (
                SELECT 1 FROM material_shares s JOIN tutor_relationships r ON r.id = s.relationship_id
                 WHERE s.material_id = m.id AND r.status = 'active' AND (r.requester_id = ?1 OR r.recipient_id = ?1)))
        ORDER BY m.updated_at DESC
        LIMIT 200`,
    )
    .bind(userId, rel)
    .all<MaterialRow & { owner_name: string | null; shared_csv: string | null }>();
  return (rows.results ?? []).map(({ owner_name, shared_csv, ...m }) =>
    materialJson(m, { owner_name, mine: m.owner_id === userId, shared_with: m.owner_id === userId && shared_csv ? shared_csv.split(',') : [] }),
  );
}

/** Share with a relationship the owner is in (idempotent). */
export async function shareMaterial(db: D1Database, m: MaterialRow, relationshipId: string, userId: string): Promise<void> {
  const rel = await db
    .prepare(`SELECT id FROM tutor_relationships WHERE id = ? AND status = 'active' AND (requester_id = ? OR recipient_id = ?)`)
    .bind(relationshipId, userId, userId)
    .first();
  if (!rel) throw new MaterialError(404, 'Relationship not found');
  await db
    .prepare('INSERT INTO material_shares (material_id, relationship_id, shared_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(m.id, relationshipId, userId, Date.now())
    .run();
}

export async function unshareMaterial(db: D1Database, materialId: string, relationshipId: string): Promise<void> {
  await db.prepare('DELETE FROM material_shares WHERE material_id = ? AND relationship_id = ?').bind(materialId, relationshipId).run();
}

/** Delete: rows go, R2 objects (original + pages) go. */
export async function deleteMaterial(env: { DB: D1Database; AUDIO_BUCKET: R2Bucket }, m: MaterialRow): Promise<void> {
  const pages = await listPages(env.DB, m.id);
  const keys = [m.original_key, ...pages.map((p) => p.image_key)].filter((k): k is string => !!k && k.startsWith(MATERIAL_PREFIX));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM material_pages WHERE material_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM material_shares WHERE material_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM material_annotations WHERE material_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM call_materials WHERE material_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM materials WHERE id = ?').bind(m.id),
  ]);
  for (let i = 0; i < keys.length; i += 1000) await env.AUDIO_BUCKET.delete(keys.slice(i, i + 1000));
}

/** A call presented a material page: remember it (the homework agent reads the lesson's materials). */
export async function notePresented(db: D1Database, callId: string, materialId: string, page: number): Promise<void> {
  const row = await db.prepare('SELECT pages_shown FROM call_materials WHERE call_id = ? AND material_id = ?').bind(callId, materialId).first<{ pages_shown: string }>();
  let shown: number[] = [];
  try {
    shown = row ? (JSON.parse(row.pages_shown) as number[]) : [];
  } catch {
    shown = [];
  }
  if (row && shown.includes(page)) return;
  const next = JSON.stringify([...new Set([...shown, page])].sort((a, b) => a - b));
  await db
    .prepare(
      `INSERT INTO call_materials (call_id, material_id, pages_shown, first_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (call_id, material_id) DO UPDATE SET pages_shown = excluded.pages_shown`,
    )
    .bind(callId, materialId, next, Date.now())
    .run();
}

/** Materials presented in a lesson's calls, with their text (the homework agent's briefing). */
export async function lessonMaterials(db: D1Database, callIds: string[]): Promise<{ id: string; title: string; kind: string; page_count: number; pages_shown: number[]; text: string }[]> {
  if (callIds.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT m.id, m.title, m.kind, m.page_count, m.text, cm.pages_shown FROM call_materials cm JOIN materials m ON m.id = cm.material_id
        WHERE cm.call_id IN (${callIds.map(() => '?').join(',')}) AND m.deleted_at IS NULL ORDER BY cm.first_at`,
    )
    .bind(...callIds)
    .all<{ id: string; title: string; kind: string; page_count: number; text: string | null; pages_shown: string }>();
  const by = new Map<string, { id: string; title: string; kind: string; page_count: number; pages_shown: number[]; text: string }>();
  for (const r of rows.results ?? []) {
    let shown: number[] = [];
    try {
      shown = JSON.parse(r.pages_shown) as number[];
    } catch {
      shown = [];
    }
    const prev = by.get(r.id);
    if (prev) prev.pages_shown = [...new Set([...prev.pages_shown, ...shown])].sort((a, b) => a - b);
    else by.set(r.id, { id: r.id, title: r.title, kind: r.kind, page_count: r.page_count, pages_shown: shown, text: r.text ?? '' });
  }
  return [...by.values()];
}

/** Kept drawings / text on a material page in a lesson. */
export async function loadMaterialAnnotations(db: D1Database, lessonId: string, materialId: string, page: number): Promise<string | null> {
  const r = await db
    .prepare('SELECT data FROM material_annotations WHERE lesson_id = ? AND material_id = ? AND page_index = ?')
    .bind(lessonId, materialId, page)
    .first<{ data: string }>();
  return r?.data ?? null;
}

export async function saveMaterialAnnotations(db: D1Database, lessonId: string, materialId: string, page: number, data: string | null): Promise<void> {
  if (!data) {
    await db.prepare('DELETE FROM material_annotations WHERE lesson_id = ? AND material_id = ? AND page_index = ?').bind(lessonId, materialId, page).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO material_annotations (lesson_id, material_id, page_index, data, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (lesson_id, material_id, page_index) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .bind(lessonId, materialId, page, data, Date.now())
    .run();
}
