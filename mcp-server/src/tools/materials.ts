/**
 * Lesson materials (worker routes/materials.ts): a tutor's PDFs, PowerPoints
 * and pictures, shared with students and presented in video calls. Uploading
 * happens in the app (the pages are rendered on the uploader's device); these
 * tools list them and read their text (PDF text layer, slide text and speaker
 * notes — pictures have none, no OCR).
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

interface MaterialSummary {
  id: string;
  title: string;
  kind: string;
  status: string;
  page_count: number;
  has_text: boolean;
  mine: boolean;
  owner_name?: string | null;
  shared_with?: string[];
  render_note?: string | null;
  updated_at: number;
}

export function trimMaterial(m: MaterialSummary) {
  return {
    id: m.id,
    title: m.title,
    kind: m.kind,
    status: m.status,
    pages: m.page_count,
    has_text: m.has_text,
    ...(m.mine ? { shared_with_relationships: m.shared_with ?? [] } : { from: m.owner_name ?? null }),
    ...(m.render_note ? { note: m.render_note } : {}),
    updated_at: new Date(m.updated_at).toISOString(),
    view_path: `/materials/${m.id}`,
  };
}

export function registerMaterialTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_materials',
    "Lesson materials: the tutor's uploaded PDFs, PowerPoints and pictures (and, for a student, those shared with them). Optionally only those shared in one relationship (relationship_id from list_students). Read one with read_material.",
    { relationship_id: z.string().optional().describe('Only materials shared in this tutor–student relationship.') },
    async ({ relationship_id }) =>
      guard(async () => {
        const q = relationship_id ? `?relationship_id=${encodeURIComponent(relationship_id)}` : '';
        const { materials } = await api.get<{ materials: MaterialSummary[] }>(`/api/materials${q}`);
        return jsonResult({ materials: materials.map(trimMaterial) });
      }),
  );

  server.tool(
    'read_material',
    "The text of a lesson material's pages (numbered from 1): a PDF's text layer, a PowerPoint's slide text and speaker notes. Pictures have no text. Use it to prepare homework or a lesson from what the tutor presented.",
    {
      material_id: z.string(),
      from_page: z.number().int().min(1).optional(),
      to_page: z.number().int().min(1).optional(),
    },
    async ({ material_id, from_page, to_page }) =>
      guard(async () => {
        const qs = new URLSearchParams();
        if (from_page) qs.set('from', String(from_page));
        if (to_page) qs.set('to', String(to_page));
        const r = await api.get<{ material: { id: string; title: string; kind: string; page_count: number; render_note: string | null }; pages: { page: number; text: string; notes: string }[] }>(
          `/api/materials/${encodeURIComponent(material_id)}/text${qs.size ? `?${qs}` : ''}`,
        );
        return jsonResult({
          ...r.material,
          pages: r.pages.map((p) => ({ page: p.page, text: p.text || '(no text on this page)', ...(p.notes ? { speaker_notes: p.notes } : {}) })),
        });
      }),
  );
}
