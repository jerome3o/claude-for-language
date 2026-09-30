/**
 * Board pages: the call's text board keeps its content per tutor relationship,
 * across calls, as numbered pages (Preply's "Canvas" page strip). Each page is
 * one text CRDT document (./textDoc.ts); the call room holds the pages of its
 * relationship while the call is live and writes them back to D1
 * (`board_pages`, migration 0086). A solo test call has its own pages (the
 * caller's, no relationship).
 *
 * Pure rules here, shared by the worker (the room decides which page a call
 * opens on) and both apps (labels, previews).
 *
 * The opening rule (`pickOpeningPage`):
 *  - the relationship has no pages yet → a new page;
 *  - the last page is still empty → reuse it (no pile of blank pages);
 *  - the page used most recently was used in a call within
 *    CONTINUE_PAGE_WINDOW_MS AND on the same local day (the call starter's
 *    time zone) → continue it: a dropped call, or a second call to fix the
 *    sound, carries on where the lesson was;
 *  - otherwise → a new page at the end: every lesson starts on a fresh page,
 *    with all earlier pages one tap away in the strip.
 *
 * Following: each person views the page they choose. A "Follow <name>" switch
 * makes my view jump whenever theirs does (turning a page myself stops
 * following); "Bring <name> here" moves the other person to my page at once
 * (they see "<name> brought you to page N"). Both start on the opening page.
 */

import type { TextDocSnapshot } from './textDoc';

export interface BoardPageMeta {
  id: string;
  title: string | null;
  /** The first characters of the page (for the thumbnail strip). */
  preview: string;
  /** Visible characters on the page. */
  chars: number;
  /** Epoch ms. */
  created_at: number;
  updated_at: number;
  /** The call the page was made in (null: imported / made outside a call). */
  call_id: string | null;
}

/** A call within this long of the page's last use (and on the same day) continues it. */
export const CONTINUE_PAGE_WINDOW_MS = 3 * 60 * 60_000;
export const MAX_PAGE_TITLE = 60;
export const PAGE_PREVIEW_CHARS = 140;
/** Pages kept per relationship (the oldest are never dropped silently: the room refuses a new page past this). */
export const MAX_BOARD_PAGES = 500;

export interface OpeningCandidate {
  id: string;
  chars: number;
  /** When a call last opened or edited the page (epoch ms). */
  last_used_at: number;
}

export type OpeningChoice = { kind: 'continue'; id: string } | { kind: 'new' };

/** YYYY-MM-DD of `ms` in `timeZone` (an IANA zone; falls back to UTC for a bad / missing one). */
export function localDateKey(ms: number, timeZone?: string | null): string {
  const d = new Date(ms);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const key = `${get('year')}-${get('month')}-${get('day')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
    } catch {
      /* unknown zone → UTC */
    }
  }
  return d.toISOString().slice(0, 10);
}

/** Which page a call opens on (pages in strip order). */
export function pickOpeningPage(pages: OpeningCandidate[], now: number, timeZone?: string | null): OpeningChoice {
  if (pages.length === 0) return { kind: 'new' };
  const last = pages[pages.length - 1];
  if (last.chars === 0) return { kind: 'continue', id: last.id };
  let recent = pages[0];
  for (const p of pages) if (p.last_used_at > recent.last_used_at) recent = p;
  const gap = now - recent.last_used_at;
  if (gap >= 0 && gap <= CONTINUE_PAGE_WINDOW_MS && localDateKey(recent.last_used_at, timeZone) === localDateKey(now, timeZone)) {
    return { kind: 'continue', id: recent.id };
  }
  return { kind: 'new' };
}

/** The thumbnail text: the page's start, blank lines squeezed. */
export function pagePreview(text: string): string {
  const squeezed = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trimStart();
  const chars = Array.from(squeezed);
  return chars.length > PAGE_PREVIEW_CHARS ? chars.slice(0, PAGE_PREVIEW_CHARS).join('') : squeezed;
}

/** A title as typed → stored (one line, ≤ 60 characters; blank = null, i.e. "Page N"). */
export function sanitizePageTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const one = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!one) return null;
  return Array.from(one).slice(0, MAX_PAGE_TITLE).join('');
}

/** "Page 7" or its title. `index` is 0-based in strip order. */
export function pageLabel(index: number, title: string | null | undefined): string {
  return title && title.trim() ? title.trim() : `Page ${index + 1}`;
}

/** A page id as sent by a client (the room only knows its own pages anyway). */
export function sanitizePageId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

/** Where someone on a deleted page goes: the next page, else the previous one. */
export function pageAfterDelete(pageIds: string[], deleted: string): string | null {
  const i = pageIds.indexOf(deleted);
  if (i < 0) return pageIds[0] ?? null;
  return pageIds[i + 1] ?? pageIds[i - 1] ?? null;
}

/**
 * A document holding `text` as one run from `site` — for pages made from plain
 * text (a duplicate, the migration of a call's old board_text: the SQL in
 * 0086 builds exactly this shape).
 */
export function snapshotFromText(text: string, site: string): TextDocSnapshot {
  return text ? { v: 1, runs: [[1, site, text, 0]] } : { v: 1, runs: [] };
}

/**
 * The text a call leaves in `calls.board_text` (review page, lesson report,
 * session-notes homework agent): the pages written in that call, in strip
 * order; one page is just its text, several are headed with their label.
 */
export function combineCallPagesText(pages: { label: string; text: string }[]): string {
  const written = pages.filter((p) => p.text.trim());
  if (written.length === 0) return '';
  if (written.length === 1) return written[0].text;
  return written.map((p) => `— ${p.label} —\n${p.text.replace(/\s+$/, '')}`).join('\n\n');
}
