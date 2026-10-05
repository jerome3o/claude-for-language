/**
 * A material's Contents on this device (shared/materials/toc.ts):
 * - at upload, the PDF outline read with pdf.js (each destination resolved to
 *   a page) or the PowerPoint's slide titles (render.ts);
 * - for an older material (`toc` null — never computed) the uploader's own
 *   device reads it from the original file once, when it next opens the
 *   material on the viewer page, and sends it (`PATCH /api/materials/:id`).
 *   Until then everyone sees the page list.
 */

import { MAX_MATERIAL_PAGES, MAX_TOC_ENTRIES, outlineToToc, slideTitlesToc, type MaterialKind, type MaterialTocEntry, type OutlineNode } from '@shared/materials';
import { fetchPageImage, setMaterialToc, type MaterialInfo } from '../../api/materials';

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;
type PdfOutline = Awaited<ReturnType<PdfDoc['getOutline']>>;

/** The PDF's outline → Contents entries (pages inside the first `pageCount`). */
export async function pdfOutlineToc(doc: PdfDoc, pageCount: number): Promise<MaterialTocEntry[]> {
  let outline: PdfOutline | null = null;
  try {
    outline = await doc.getOutline();
  } catch {
    return [];
  }
  if (!outline || outline.length === 0) return [];
  // Resolving a destination is a round trip into the worker: bounded.
  let budget = MAX_TOC_ENTRIES * 2;
  const pageOf = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref = explicit[0] as unknown;
      if (typeof ref === 'number') return Number.isInteger(ref) ? ref : null;
      if (ref && typeof ref === 'object') return await doc.getPageIndex(ref as Parameters<PdfDoc['getPageIndex']>[0]);
    } catch {
      /* a broken destination: left out */
    }
    return null;
  };
  const build = async (items: PdfOutline | undefined, depth: number): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = [];
    for (const it of items ?? []) {
      if (budget-- <= 0) break;
      out.push({ title: it.title, page: await pageOf(it.dest), items: depth < 2 ? await build(it.items as PdfOutline, depth + 1) : [] });
    }
    return out;
  };
  return outlineToToc(await build(outline, 0), pageCount);
}

/** Contents straight from the original file (an older material). */
export async function tocFromFile(file: Blob, kind: MaterialKind, pageCount: number): Promise<MaterialTocEntry[]> {
  if (kind === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      return await pdfOutlineToc(doc, Math.min(pageCount, doc.numPages, MAX_MATERIAL_PAGES));
    } finally {
      await doc.destroy();
    }
  }
  if (kind === 'pptx') {
    const [{ default: JSZip }, { readPptx, slideTitle }] = await Promise.all([import('jszip'), import('./pptx')]);
    const slides = (await readPptx(await JSZip.loadAsync(file))).slice(0, pageCount);
    return slideTitlesToc(slides.map(slideTitle));
  }
  return [];
}

const tried = new Set<string>();

/**
 * My own older material has no Contents yet: read it from the original once
 * (per page load) and store it. Returns the stored Contents, or null when
 * there is nothing to do / it failed (the page list stays).
 */
export async function backfillMaterialToc(material: MaterialInfo): Promise<MaterialTocEntry[] | null> {
  if (!material.mine || material.toc !== null || material.kind === 'image' || !material.original_size || material.status !== 'ready') return null;
  if (tried.has(material.id) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  tried.add(material.id);
  try {
    const file = await fetchPageImage(`/api/materials/${material.id}/original`);
    const toc = await tocFromFile(file, material.kind, material.page_count);
    const r = await setMaterialToc(material.id, toc);
    return r.material.toc ?? toc;
  } catch {
    return null;
  }
}
