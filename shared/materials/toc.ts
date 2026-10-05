/**
 * A material's Contents (round 6): the list both people open in a call (and on
 * the /materials/:id viewer) to jump to a section.
 *
 * - PDF: the uploader's device reads the PDF outline with pdf.js (each entry's
 *   destination resolved to a 0-based page) → `outlineToToc`, two levels kept.
 * - PowerPoint: each slide's title → `slideTitlesToc`.
 * - Stored on `materials.toc` (JSON, migration 0109; NULL = never computed,
 *   `[]` = computed, nothing found) and checked with `sanitizeToc`.
 * - Nothing stored (older materials, a PDF without an outline, pictures): one
 *   row per page with its first line of text (`pageListToc`).
 *
 * Pure; the Lab app's Materials.kt ports it (parity/fixtures/materials.ts).
 */

import { MAX_MATERIAL_PAGES } from './index';

export interface MaterialTocEntry {
  title: string;
  /** 0-based page. */
  page: number;
  /** 0 = top level, 1 = one level in. */
  level: number;
}

export type MaterialContentsSource = 'outline' | 'pages';

export const MAX_TOC_ENTRIES = 200;
export const MAX_TOC_TITLE = 100;
/** The deepest level kept (0-based): two levels. */
export const MAX_TOC_LEVEL = 1;
/** Deeper than this an outline is not walked at all. */
const MAX_OUTLINE_DEPTH = 8;

/** One entry's title: whitespace collapsed, trimmed, bounded ('' = none). */
export function cleanTocTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TOC_TITLE);
}

function isPage(page: unknown, pageCount: number): page is number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 0 && page < pageCount;
}

/** A PDF outline as read on the device: pdf.js `getOutline()` with each destination resolved. */
export interface OutlineNode {
  title?: unknown;
  /** 0-based page; null = no destination (or one that could not be resolved). */
  page?: number | null;
  items?: readonly OutlineNode[] | null;
}

/**
 * A PDF outline → Contents entries in document order. Entries without a
 * title or a page inside the material are left out (their children move up a
 * level); anything deeper than two levels is dropped; at most MAX_TOC_ENTRIES.
 */
export function outlineToToc(nodes: readonly OutlineNode[] | null | undefined, pageCount: number): MaterialTocEntry[] {
  const out: MaterialTocEntry[] = [];
  const walk = (list: readonly OutlineNode[] | null | undefined, level: number, depth: number) => {
    if (!Array.isArray(list) || depth > MAX_OUTLINE_DEPTH) return;
    for (const n of list) {
      if (out.length >= MAX_TOC_ENTRIES) return;
      if (!n || typeof n !== 'object') continue;
      const title = cleanTocTitle(n.title);
      const kept = !!title && isPage(n.page, pageCount);
      if (kept) out.push({ title, page: n.page as number, level });
      const next = kept ? level + 1 : level;
      if (next <= MAX_TOC_LEVEL) walk(n.items, next, depth + 1);
    }
  };
  walk(nodes, 0, 0);
  return out;
}

/** A PowerPoint's slide titles (one per slide, '' / null = none) → Contents entries. */
export function slideTitlesToc(titles: readonly (string | null | undefined)[]): MaterialTocEntry[] {
  const out: MaterialTocEntry[] = [];
  for (let i = 0; i < titles.length && out.length < MAX_TOC_ENTRIES; i++) {
    const title = cleanTocTitle(titles[i]);
    if (title) out.push({ title, page: i, level: 0 });
  }
  return out;
}

/** Stored / sent Contents, checked (null = not a list at all). */
export function sanitizeToc(raw: unknown, pageCount: number): MaterialTocEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MaterialTocEntry[] = [];
  for (const r of raw) {
    if (out.length >= MAX_TOC_ENTRIES) break;
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const title = cleanTocTitle(o.title);
    if (!title || !isPage(o.page, pageCount)) continue;
    out.push({ title, page: o.page as number, level: typeof o.level === 'number' && o.level >= 1 ? 1 : 0 });
  }
  return out;
}

const LETTER = /\p{L}/u;

/** A page's first line that has a letter in it (skips page numbers / rules), '' when none. */
export function firstLineOf(text: string | null | undefined): string {
  for (const line of (text ?? '').split('\n')) {
    const t = cleanTocTitle(line);
    if (t && LETTER.test(t)) return t;
  }
  return '';
}

/** One row per page: its first line of text, else "Page N". */
export function pageListToc(pageCount: number, pages: readonly { page_index: number; text?: string | null }[]): MaterialTocEntry[] {
  const text = new Map<number, string>();
  for (const p of pages) if (!text.has(p.page_index)) text.set(p.page_index, p.text ?? '');
  const out: MaterialTocEntry[] = [];
  const n = Math.min(Math.max(0, Math.floor(pageCount)), MAX_MATERIAL_PAGES);
  for (let i = 0; i < n; i++) out.push({ title: firstLineOf(text.get(i)) || `Page ${i + 1}`, page: i, level: 0 });
  return out;
}

/** What the Contents list shows: the stored outline when it has entries, else the page list. */
export function materialContents(
  toc: unknown,
  pageCount: number,
  pages: readonly { page_index: number; text?: string | null }[],
): { entries: MaterialTocEntry[]; source: MaterialContentsSource } {
  const outline = sanitizeToc(toc, pageCount);
  if (outline && outline.length > 0) return { entries: outline, source: 'outline' };
  return { entries: pageListToc(pageCount, pages), source: 'pages' };
}

/** The entry for the page on show: the last one at or before it (-1 = before the first entry). */
export function currentTocIndex(entries: readonly MaterialTocEntry[], page: number): number {
  let best = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].page <= page && (best < 0 || entries[i].page >= entries[best].page)) best = i;
  }
  return best;
}

/** The Contents button / heading. */
export const CONTENTS_LABEL = 'Contents';
