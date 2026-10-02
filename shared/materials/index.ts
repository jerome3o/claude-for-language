/**
 * Lesson materials (round 4): a tutor's PDFs, pictures and PowerPoints. The
 * uploader's device renders every page to a picture (frontend
 * services/materials/render.ts; Lab: PdfRenderer / its own slide drawing), so
 * viewers, the call and the Lab app only ever show pictures; the text of each
 * page goes to the homework agent and the MCP. Pure rules here, unit-tested;
 * the Lab app's MaterialsRules.kt is parity-tested.
 */

export type MaterialKind = 'pdf' | 'image' | 'pptx';
export type MaterialStatus = 'uploading' | 'ready' | 'failed';

/** The original file may be at most this big (Minghui's PowerPoints with pictures). */
export const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;
/** A rendered page picture (JPEG / PNG / WebP). */
export const MAX_PAGE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_MATERIAL_PAGES = 300;
export const MAX_MATERIAL_TITLE = 120;
/** Text kept per page / per material (agents read it; OCR is not done). */
export const MAX_PAGE_TEXT = 8_000;
export const MAX_MATERIAL_TEXT = 200_000;
/** Pages are rendered this wide (px) on the uploader's device. */
export const MATERIAL_RENDER_WIDTH = 1600;
export const PPTX_RENDER_NOTE = 'Slides drawn from their text and pictures — for exact slides, export the PowerPoint as PDF and upload that.';

const EXT_KIND: Record<string, MaterialKind> = {
  pdf: 'pdf',
  pptx: 'pptx',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
};

/** What kind a file is, from its name and type; null = not supported (e.g. old .ppt, .key, .docx). */
export function materialKindOf(fileName: string, mime?: string | null): MaterialKind | null {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  const m = (mime ?? '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (/^image\/(png|jpeg|webp|gif)$/.test(m)) return 'image';
  return null;
}

/** Why a file can't be added, in plain words (null = fine). */
export function materialFileProblem(fileName: string, mime: string | null | undefined, size: number): string | null {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (ext === 'ppt') return 'Old .ppt files can’t be read — save it as .pptx (or PDF) in PowerPoint and upload that.';
  if (ext === 'key') return 'Keynote files can’t be read — export it as PDF and upload that.';
  if (!materialKindOf(fileName, mime)) return 'Upload a PDF, a PowerPoint (.pptx) or a picture (JPEG, PNG, WebP).';
  if (!(size > 0)) return 'The file is empty.';
  if (size > MAX_MATERIAL_BYTES) return `The file is ${Math.round(size / 1024 / 1024)} MB — 50 MB at most.`;
  return null;
}

/** A title from a file name: "Lesson 5 – 把字句.pptx" → "Lesson 5 – 把字句". */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || 'Untitled').slice(0, MAX_MATERIAL_TITLE);
}

export function cleanMaterialTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_MATERIAL_TITLE);
  return t || null;
}

/** One page's text as stored: whitespace tidied, bounded. */
export function cleanPageText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_PAGE_TEXT);
}

/** All pages' text for an agent: "— Page 3 —\n…" (+ speaker notes), bounded. */
export function materialText(pages: { page_index: number; text?: string | null; notes?: string | null }[], max = MAX_MATERIAL_TEXT): string {
  const parts: string[] = [];
  for (const p of [...pages].sort((a, b) => a.page_index - b.page_index)) {
    const text = (p.text ?? '').trim();
    const notes = (p.notes ?? '').trim();
    if (!text && !notes) continue;
    parts.push(`— Page ${p.page_index + 1} —${text ? `\n${text}` : ''}${notes ? `\n(Speaker notes: ${notes})` : ''}`);
  }
  const all = parts.join('\n\n');
  return all.length > max ? `${all.slice(0, max)}\n[… cut for length …]` : all;
}

/**
 * Drawings / text on a material page in a call use the shared-screen
 * annotation messages with a `target` naming the page.
 */
export function materialTarget(materialId: string, page: number): string {
  return `material:${materialId}:${page}`;
}

export function parseMaterialTarget(raw: unknown): { materialId: string; page: number } | null {
  if (typeof raw !== 'string') return null;
  const m = /^material:([A-Za-z0-9_-]{1,64}):(\d{1,4})$/.exec(raw);
  return m ? { materialId: m[1], page: Number(m[2]) } : null;
}

/** The page after a turn, kept inside the material. */
export function turnPage(page: number, delta: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.max(0, Math.min(pageCount - 1, Math.round(page + delta)));
}

/** What the call room says is being presented. */
export interface PresentedMaterial {
  material_id: string;
  title: string;
  page: number;
  page_count: number;
  /** Who opened it (user id) and their name. */
  by: string;
  by_name: string;
}

export function sanitizePresented(raw: unknown): PresentedMaterial | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.material_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.material_id)) return null;
  const count = Number(r.page_count);
  const page = Number(r.page);
  if (!Number.isInteger(count) || count < 1 || count > MAX_MATERIAL_PAGES) return null;
  return {
    material_id: r.material_id,
    title: typeof r.title === 'string' ? r.title.slice(0, MAX_MATERIAL_TITLE) : '',
    page: turnPage(Number.isFinite(page) ? page : 0, 0, count),
    page_count: count,
    by: typeof r.by === 'string' ? r.by : '',
    by_name: typeof r.by_name === 'string' ? r.by_name.slice(0, 80) : '',
  };
}
