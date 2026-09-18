/**
 * Structural diff between two reader specs — pages added / removed / moved /
 * changed (with field detail) plus title / difficulty / topic changes.
 *
 * Used by the reader editor's Claude side-chat in both directions: the
 * server tells Claude "what the author changed since your last message", and
 * the client renders Claude's proposal as a compact diff card. Pure and
 * dependency-free so it runs in the worker, the browser and unit tests.
 *
 * Page identity: stored pages carry an id, so a page is matched by id first;
 * otherwise by identical content, and finally by similarity of the Chinese
 * text (so a page Claude rewrote without keeping its id still shows as
 * "changed", not "removed + added").
 */

import { ReaderPageSpec, ReaderSpec } from './types';

export interface ReaderFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export type ReaderPageDiffEntry =
  | { kind: 'added'; index: number; page: ReaderPageSpec }
  | { kind: 'removed'; index: number; page: ReaderPageSpec }
  | { kind: 'moved'; fromIndex: number; index: number; page: ReaderPageSpec }
  | {
      kind: 'changed';
      fromIndex: number;
      index: number;
      before: ReaderPageSpec;
      after: ReaderPageSpec;
      fields: ReaderFieldChange[];
    };

export interface ReaderDiff {
  /** True when anything at all differs. */
  changed: boolean;
  meta: ReaderFieldChange[];
  pages: ReaderPageDiffEntry[];
}

const PAGE_FIELDS = ['content_chinese', 'content_pinyin', 'content_english', 'image_prompt'] as const;

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v);
}

/** Content identity of a page: its four authored fields, ignoring id/image_url. */
export function pageContentKey(page: ReaderPageSpec): string {
  return JSON.stringify(PAGE_FIELDS.map(f => norm(page[f])));
}

function pageFieldChanges(before: ReaderPageSpec, after: ReaderPageSpec): ReaderFieldChange[] {
  const out: ReaderFieldChange[] = [];
  for (const f of PAGE_FIELDS) {
    if (norm(before[f]) !== norm(after[f])) out.push({ field: f, before: before[f] ?? null, after: after[f] ?? null });
  }
  return out;
}

function bigrams(text: string): Set<string> {
  const s = text.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

/** Dice coefficient over character bigrams of the Chinese text (0..1). */
export function pageSimilarity(a: ReaderPageSpec, b: ReaderPageSpec): number {
  const A = bigrams(a.content_chinese ?? '');
  const B = bigrams(b.content_chinese ?? '');
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

interface Located {
  index: number;
  page: ReaderPageSpec;
  matched: boolean;
}

const SIMILARITY_THRESHOLD = 0.4;

export function diffReaderSpecs(before: ReaderSpec, after: ReaderSpec): ReaderDiff {
  const meta: ReaderFieldChange[] = [];
  for (const field of ['title_chinese', 'title_english', 'difficulty_level', 'topic'] as const) {
    if (norm(before[field]) !== norm(after[field])) meta.push({ field, before: before[field] ?? null, after: after[field] ?? null });
  }

  const olds: Located[] = before.pages.map((page, index) => ({ index, page, matched: false }));
  const news: Located[] = after.pages.map((page, index) => ({ index, page, matched: false }));
  const pairs: Array<{ o: Located; n: Located }> = [];

  const pair = (o: Located, n: Located) => {
    o.matched = true;
    n.matched = true;
    pairs.push({ o, n });
  };

  // Pass 1: same id.
  for (const n of news) {
    if (!n.page.id) continue;
    const o = olds.find(x => !x.matched && x.page.id === n.page.id);
    if (o) pair(o, n);
  }
  // Pass 2: identical content.
  for (const n of news) {
    if (n.matched) continue;
    const key = pageContentKey(n.page);
    const o = olds.find(x => !x.matched && pageContentKey(x.page) === key);
    if (o) pair(o, n);
  }
  // Pass 3: most similar Chinese text above a threshold.
  for (const n of news) {
    if (n.matched) continue;
    let best: Located | null = null;
    let bestScore = 0;
    for (const o of olds) {
      if (o.matched) continue;
      const score = pageSimilarity(o.page, n.page);
      if (score > bestScore) {
        best = o;
        bestScore = score;
      }
    }
    if (best && bestScore >= SIMILARITY_THRESHOLD) pair(best, n);
  }

  const pages: ReaderPageDiffEntry[] = [];
  for (const { o, n } of pairs) {
    const fields = pageFieldChanges(o.page, n.page);
    if (fields.length > 0) {
      pages.push({ kind: 'changed', fromIndex: o.index, index: n.index, before: o.page, after: n.page, fields });
    } else if (o.index !== n.index) {
      pages.push({ kind: 'moved', fromIndex: o.index, index: n.index, page: n.page });
    }
  }
  for (const n of news) if (!n.matched) pages.push({ kind: 'added', index: n.index, page: n.page });
  for (const o of olds) if (!o.matched) pages.push({ kind: 'removed', index: o.index, page: o.page });

  pages.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));

  return { changed: meta.length > 0 || pages.length > 0, meta, pages };
}

function short(value: unknown, max = 40): string {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const FIELD_LABELS: Record<string, string> = {
  title_chinese: 'Chinese title',
  title_english: 'English title',
  difficulty_level: 'difficulty',
  topic: 'topic',
  content_chinese: 'Chinese',
  content_pinyin: 'pinyin',
  content_english: 'English',
  image_prompt: 'illustration prompt',
};

export function readerFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Plain-text lines describing a diff, for the model ("Changes the author
 * made since your last message") and for logs. Empty when nothing changed.
 */
export function formatReaderDiff(diff: ReaderDiff): string[] {
  const lines: string[] = [];
  for (const m of diff.meta) {
    lines.push(`${readerFieldLabel(m.field)}: "${short(m.before)}" → "${short(m.after)}"`);
  }
  for (const p of diff.pages) {
    switch (p.kind) {
      case 'added':
        lines.push(`Page ${p.index + 1}: added "${short(p.page.content_chinese)}"`);
        break;
      case 'removed':
        lines.push(`Page ${p.index + 1}: removed "${short(p.page.content_chinese)}"`);
        break;
      case 'moved':
        lines.push(`Page ${p.index + 1}: moved here from page ${p.fromIndex + 1} ("${short(p.page.content_chinese)}")`);
        break;
      case 'changed': {
        const fields = p.fields.map(f => `${readerFieldLabel(f.field)} "${short(f.before)}" → "${short(f.after)}"`).join('; ');
        const moved = p.fromIndex !== p.index ? ` (was page ${p.fromIndex + 1})` : '';
        lines.push(`Page ${p.index + 1}${moved}: changed — ${fields}`);
        break;
      }
    }
  }
  return lines;
}
