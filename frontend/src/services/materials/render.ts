/**
 * Render a lesson material to page pictures on this device (round 4), so the
 * server, the other person and the Lab app only ever show pictures:
 * - PDF: pdf.js draws each page at MATERIAL_RENDER_WIDTH px and reads its text layer;
 * - picture: as it is (re-encoded, at most 2400 px);
 * - PowerPoint: its slides drawn from their text boxes and pictures
 *   (services/materials/pptx.ts) — an approximation, said so in `renderNote`.
 */

import { MATERIAL_RENDER_WIDTH, MAX_MATERIAL_PAGES, PPTX_RENDER_NOTE, cleanPageText, slideTitlesToc, type MaterialKind, type MaterialTocEntry } from '@shared/materials';
import { drawSlide, readPptx, slideText, slideTitle } from './pptx';
import { pdfOutlineToc } from './toc';

export interface RenderedPage {
  image: Blob;
  width: number;
  height: number;
  text: string;
  notes: string;
}

export interface RenderResult {
  pages: RenderedPage[];
  renderNote: string | null;
  /** Contents: the PDF outline / slide titles ([] = none found). */
  toc: MaterialTocEntry[];
}

type Progress = (done: number, total: number) => void;

function canvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t draw the page'))), type, quality));
}

async function renderPdf(file: Blob, onProgress?: Progress): Promise<RenderResult> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const total = Math.min(doc.numPages, MAX_MATERIAL_PAGES);
  const pages: RenderedPage[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MATERIAL_RENDER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const content = await page.getTextContent();
    const text = content.items.map((it) => ('str' in it ? `${it.str}${it.hasEOL ? '\n' : ''}` : '')).join('');
    pages.push({ image: await canvasBlob(canvas), width: canvas.width, height: canvas.height, text: cleanPageText(text), notes: '' });
    page.cleanup();
    onProgress?.(i, total);
  }
  const toc = await pdfOutlineToc(doc, total);
  await doc.destroy();
  return { pages, renderNote: null, toc };
}

async function renderImage(file: Blob): Promise<RenderResult> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return { pages: [{ image: await canvasBlob(canvas), width: canvas.width, height: canvas.height, text: '', notes: '' }], renderNote: null, toc: [] };
}

async function renderPptx(file: Blob, onProgress?: Progress): Promise<RenderResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const slides = (await readPptx(zip)).slice(0, MAX_MATERIAL_PAGES);
  if (slides.length === 0) throw new Error('No slides found in this PowerPoint');
  const images = new Map<string, ImageBitmap>();
  const pages: RenderedPage[] = [];
  for (const [i, s] of slides.entries()) {
    for (const sh of s.shapes) {
      if (sh.kind !== 'picture' || images.has(sh.path)) continue;
      const data = await zip.file(sh.path)?.async('blob');
      if (!data) continue;
      try {
        images.set(sh.path, await createImageBitmap(data));
      } catch {
        /* an image format the browser can't decode: left out */
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = MATERIAL_RENDER_WIDTH;
    canvas.height = Math.round((MATERIAL_RENDER_WIDTH * s.height) / s.width);
    drawSlide(canvas.getContext('2d')!, s, canvas.width, images);
    pages.push({ image: await canvasBlob(canvas), width: canvas.width, height: canvas.height, text: cleanPageText(slideText(s)), notes: cleanPageText(s.notes) });
    onProgress?.(i + 1, slides.length);
  }
  images.forEach((b) => b.close());
  return { pages, renderNote: PPTX_RENDER_NOTE, toc: slideTitlesToc(slides.map(slideTitle)) };
}

export async function renderMaterial(file: Blob, kind: MaterialKind, onProgress?: Progress): Promise<RenderResult> {
  if (kind === 'pdf') return renderPdf(file, onProgress);
  if (kind === 'pptx') return renderPptx(file, onProgress);
  return renderImage(file);
}
