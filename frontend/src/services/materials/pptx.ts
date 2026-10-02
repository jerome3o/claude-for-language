/**
 * PowerPoint (.pptx) → slide models, on the device (round 4, lesson
 * materials). A .pptx is a zip of XML: we read each slide's text boxes (with
 * their position, size, font size, bold, colour, bullets), its pictures (PNG /
 * JPEG / GIF / WebP — EMF / WMF are skipped), tables' text, the background
 * colour and the speaker notes. `drawSlide` then paints a model onto a canvas.
 * It is an approximation (no theme fonts, SmartArt, charts or animations), so
 * the material says "for exact slides, export the PowerPoint as PDF".
 *
 * Positions are in EMU (914,400 per inch, 12,700 per point) of the slide size.
 */

import type JSZip from 'jszip';

export interface SlideRun {
  text: string;
  /** Font size in points (default 18). */
  size: number;
  bold: boolean;
  color: string | null;
}

export interface SlideParagraph {
  runs: SlideRun[];
  bullet: boolean;
  level: number;
  align: 'l' | 'ctr' | 'r';
}

export interface SlideTextBox {
  kind: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Placeholder type (title, ctrTitle, body, subTitle…) when it has one. */
  placeholder: string | null;
  paragraphs: SlideParagraph[];
}

export interface SlidePicture {
  kind: 'picture';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Path of the image inside the zip. */
  path: string;
}

export type SlideShape = SlideTextBox | SlidePicture;

export interface SlideModel {
  index: number;
  width: number;
  height: number;
  background: string | null;
  shapes: SlideShape[];
  notes: string;
}

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * Relationship attributes (`r:id`, `r:embed`) are renamed to plain `rel-id` / `rel-embed` before
 * parsing: some XML parsers (happy-dom) drop a prefixed attribute whose local name an
 * unprefixed one already uses (`<p:sldId id="257" r:id="rId2">`).
 */
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/\sr:(id|embed|link)="/g, ' rel-$1="'), 'application/xml');
// Matched by local name (prefixes vary between producers; some XML parsers ignore namespaces).
const localOf = (el: Element) => el.localName || el.nodeName.split(':').pop() || '';
const kids = (el: Element | null | undefined, _ns: string, name: string): Element[] => (el ? Array.from(el.children).filter((c) => localOf(c) === name) : []);
const kid = (el: Element | null | undefined, ns: string, name: string): Element | null => kids(el, ns, name)[0] ?? null;
const all = (el: Element | Document, _ns: string, name: string): Element[] => Array.from(el.getElementsByTagName('*')).filter((c) => localOf(c) === name);
/** An r:… attribute (relationship id). */
const rAttr = (el: Element | null | undefined, name: string): string | null => {
  if (!el) return null;
  const hit = Array.from(el.attributes).find((a) => a.name === `rel-${name}` || a.name === `r:${name}` || (a.localName === name && a.namespaceURI === R));
  return hit ? hit.value : null;
};
const num = (v: string | null | undefined, d = 0) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

/** Resolve "../media/image1.png" against "ppt/slides/slide1.xml". */
export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

async function rels(zip: JSZip, partPath: string): Promise<Map<string, { target: string; type: string }>> {
  const dir = partPath.split('/').slice(0, -1).join('/');
  const file = `${dir}/_rels/${partPath.split('/').pop()}.rels`;
  const xml = await zip.file(file)?.async('string');
  const out = new Map<string, { target: string; type: string }>();
  if (!xml) return out;
  for (const r of Array.from(parse(xml).getElementsByTagName('Relationship'))) {
    out.set(r.getAttribute('Id') ?? '', { target: resolvePath(partPath, r.getAttribute('Target') ?? ''), type: r.getAttribute('Type') ?? '' });
  }
  return out;
}

function color(el: Element | null): string | null {
  const srgb = el ? all(el, A, 'srgbClr')[0] : null;
  const v = srgb?.getAttribute('val');
  return v && /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : null;
}

function xfrm(spPr: Element | null): { x: number; y: number; w: number; h: number } | null {
  const x = kid(spPr, A, 'xfrm');
  const off = kid(x, A, 'off');
  const ext = kid(x, A, 'ext');
  if (!off || !ext) return null;
  return { x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), w: num(ext.getAttribute('cx')), h: num(ext.getAttribute('cy')) };
}

function paragraphs(txBody: Element | null, isBody: boolean): SlideParagraph[] {
  const out: SlideParagraph[] = [];
  for (const p of kids(txBody, A, 'p')) {
    const pPr = kid(p, A, 'pPr');
    const defSize = num(kid(pPr, A, 'defRPr')?.getAttribute('sz'), 0);
    const runs: SlideRun[] = [];
    for (const r of Array.from(p.children)) {
      if (localOf(r) === 'br') {
        runs.push({ text: '\n', size: 18, bold: false, color: null });
        continue;
      }
      if (localOf(r) !== 'r' && localOf(r) !== 'fld') continue;
      const rPr = kid(r, A, 'rPr');
      const t = kid(r, A, 't')?.textContent ?? '';
      if (!t) continue;
      const sz = num(rPr?.getAttribute('sz'), defSize);
      runs.push({ text: t, size: sz ? sz / 100 : 0, bold: rPr?.getAttribute('b') === '1', color: color(rPr) });
    }
    const text = runs.map((r) => r.text).join('');
    const noBullet = !!kid(pPr, A, 'buNone');
    const hasBullet = !!kid(pPr, A, 'buChar') || !!kid(pPr, A, 'buAutoNum');
    out.push({
      runs,
      bullet: !!text.trim() && !noBullet && (hasBullet || isBody),
      level: num(pPr?.getAttribute('lvl')),
      align: (pPr?.getAttribute('algn') as 'l' | 'ctr' | 'r') ?? 'l',
    });
  }
  return out;
}

/** Shapes in a tree (groups flattened, their own offsets ignored). */
function shapes(tree: Element | null, slidePath: string, rel: Map<string, { target: string; type: string }>): SlideShape[] {
  const out: SlideShape[] = [];
  if (!tree) return out;
  for (const el of Array.from(tree.children)) {
    const ln = localOf(el);
    if (ln === 'grpSp') out.push(...shapes(el, slidePath, rel));
    else if (ln === 'sp') {
      const ph = all(el, P, 'ph')[0];
      const phType = ph ? ph.getAttribute('type') ?? 'body' : null;
      const box = xfrm(kid(el, P, 'spPr'));
      const isBody = phType === 'body' || (phType !== null && !['title', 'ctrTitle', 'subTitle', 'dt', 'ftr', 'sldNum'].includes(phType));
      if (phType === 'dt' || phType === 'ftr' || phType === 'sldNum') continue;
      const paras = paragraphs(kid(el, P, 'txBody'), isBody);
      if (!paras.some((p) => p.runs.some((r) => r.text.trim()))) continue;
      out.push({ kind: 'text', x: box?.x ?? -1, y: box?.y ?? -1, w: box?.w ?? -1, h: box?.h ?? -1, placeholder: phType, paragraphs: paras });
    } else if (ln === 'pic') {
      const blip = all(el, A, 'blip')[0];
      const id = rAttr(blip, 'embed') ?? '';
      const target = rel.get(id)?.target;
      const box = xfrm(kid(el, P, 'spPr'));
      if (target && box && /\.(png|jpe?g|gif|webp)$/i.test(target)) out.push({ kind: 'picture', ...box, path: target });
    } else if (ln === 'graphicFrame') {
      // Tables: their text, one paragraph per row ("cell | cell").
      const box = (() => {
        const x = kid(el, P, 'xfrm');
        const off = kid(x, A, 'off');
        const ext = kid(x, A, 'ext');
        return off && ext ? { x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), w: num(ext.getAttribute('cx')), h: num(ext.getAttribute('cy')) } : null;
      })();
      const rows = all(el, A, 'tr').map((tr) => all(tr, A, 'tc').map((tc) => all(tc, A, 't').map((t) => t.textContent ?? '').join('')).join(' | '));
      if (rows.some((r) => r.trim()))
        out.push({ kind: 'text', x: box?.x ?? -1, y: box?.y ?? -1, w: box?.w ?? -1, h: box?.h ?? -1, placeholder: null, paragraphs: rows.map((r) => ({ runs: [{ text: r, size: 14, bold: false, color: null }], bullet: false, level: 0, align: 'l' as const })) });
    }
  }
  return out;
}

/** Every slide of a presentation, in order. */
export async function readPptx(zip: JSZip): Promise<SlideModel[]> {
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXml) throw new Error('This isn’t a PowerPoint file (no ppt/presentation.xml)');
  const pres = parse(presXml);
  const sz = all(pres, P, 'sldSz')[0];
  const width = num(sz?.getAttribute('cx'), 12_192_000);
  const height = num(sz?.getAttribute('cy'), 6_858_000);
  const presRels = await rels(zip, 'ppt/presentation.xml');
  const order = all(pres, P, 'sldId').map((s) => presRels.get(rAttr(s, 'id') ?? '')?.target).filter((t): t is string => !!t);
  const out: SlideModel[] = [];
  for (const [index, path] of order.entries()) {
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const doc = parse(xml);
    const rel = await rels(zip, path);
    const cSld = all(doc, P, 'cSld')[0];
    const bg = color(kid(cSld, P, 'bg'));
    const list = shapes(kid(cSld, P, 'spTree'), path, rel);
    let notes = '';
    const notesPath = [...rel.values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    if (notesPath) {
      const nx = await zip.file(notesPath)?.async('string');
      if (nx) {
        const nd = parse(nx);
        notes = all(nd, P, 'sp')
          .filter((sp) => {
            const t = all(sp, P, 'ph')[0]?.getAttribute('type');
            return t !== 'sldImg' && t !== 'sldNum' && t !== 'hdr' && t !== 'ftr' && t !== 'dt';
          })
          .map((sp) => all(sp, A, 'p').map((p) => all(p, A, 't').map((t) => t.textContent ?? '').join('')).join('\n'))
          .join('\n')
          .trim();
      }
    }
    out.push({ index, width, height, background: bg, shapes: list, notes });
  }
  return out;
}

/** A slide's text, top to bottom (the page text agents read). */
export function slideText(s: SlideModel): string {
  const texts = s.shapes.filter((x): x is SlideTextBox => x.kind === 'text');
  texts.sort((a, b) => (a.y < 0 ? 0 : a.y) - (b.y < 0 ? 0 : b.y) || (a.x < 0 ? 0 : a.x) - (b.x < 0 ? 0 : b.x));
  return texts.map((t) => t.paragraphs.map((p) => `${p.bullet ? '• ' : ''}${p.runs.map((r) => r.text).join('')}`).join('\n')).join('\n').trim();
}

/** Boxes for text placeholders that inherit their position from the layout (no xfrm here). */
function fallbackBox(t: SlideTextBox, s: SlideModel, nth: number): { x: number; y: number; w: number; h: number } {
  const W = s.width;
  const H = s.height;
  if (t.placeholder === 'title') return { x: W * 0.06, y: H * 0.05, w: W * 0.88, h: H * 0.16 };
  if (t.placeholder === 'ctrTitle') return { x: W * 0.1, y: H * 0.3, w: W * 0.8, h: H * 0.2 };
  if (t.placeholder === 'subTitle') return { x: W * 0.15, y: H * 0.55, w: W * 0.7, h: H * 0.15 };
  return { x: W * 0.06, y: H * (0.25 + 0.05 * nth), w: W * 0.88, h: H * 0.65 };
}

/** Lay out one paragraph's characters into lines that fit `maxW` (CJK breaks anywhere, Latin at spaces). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    let line = '';
    const tokens = raw.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) ?? [''];
    for (const tok of tokens) {
      const next = line + tok;
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line.trimEnd());
        line = tok.trimStart();
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Paint a slide onto a canvas `width` px wide. `images` = decoded pictures by zip path. */
export function drawSlide(ctx: CanvasRenderingContext2D, s: SlideModel, width: number, images: Map<string, CanvasImageSource>): void {
  const scale = width / s.width;
  const height = Math.round(s.height * scale);
  ctx.fillStyle = s.background ?? '#ffffff';
  ctx.fillRect(0, 0, width, height);
  // Pictures first (text usually sits on top of them).
  for (const sh of s.shapes) {
    if (sh.kind !== 'picture') continue;
    const img = images.get(sh.path);
    if (img) ctx.drawImage(img, sh.x * scale, sh.y * scale, sh.w * scale, sh.h * scale);
  }
  let bodyN = 0;
  for (const sh of s.shapes) {
    if (sh.kind !== 'text') continue;
    const box = sh.w > 0 ? sh : fallbackBox(sh, s, bodyN++);
    const isTitle = sh.placeholder === 'title' || sh.placeholder === 'ctrTitle';
    let y = box.y * scale + 6;
    for (const p of sh.paragraphs) {
      const pt = p.runs.find((r) => r.size)?.size || (isTitle ? 36 : 20);
      const px = Math.max(10, pt * 12_700 * scale);
      const bold = isTitle || p.runs.some((r) => r.bold);
      ctx.font = `${bold ? '700' : '400'} ${px}px system-ui, -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = p.runs.find((r) => r.color)?.color ?? '#111827';
      ctx.textBaseline = 'top';
      const indent = (p.bullet ? px * 1.1 : 0) + p.level * px * 1.2;
      const maxW = Math.max(40, box.w * scale - indent - 8);
      const text = p.runs.map((r) => r.text).join('');
      const lines = wrap(ctx, text, maxW);
      lines.forEach((line, i) => {
        const lw = ctx.measureText(line).width;
        const x0 = box.x * scale + 4 + indent;
        const x = p.align === 'ctr' ? box.x * scale + (box.w * scale - lw) / 2 : p.align === 'r' ? box.x * scale + box.w * scale - lw - 4 : x0;
        if (i === 0 && p.bullet) ctx.fillText('•', x0 - px * 0.9, y);
        ctx.fillText(line, x, y);
        y += px * 1.25;
      });
      if (!text) y += px * 0.6;
    }
  }
}
