/**
 * Pure helpers for the tutor's "Needs your ear" page (RecordingsInboxPage): which
 * characters to highlight in Expected / Heard, the All-recordings order, and the
 * optimistic removal of a marked item. The server decides membership and reasons
 * (shared/recordings/queue.ts); this only shapes what is on screen.
 */
import { diffHanzi } from '@shared/lesson/answer-check';
import type { RecordingQueueItem, RecordingQueueResponse, WeakChar, WeakKind } from '@shared/recordings/queue';

export interface ExpectedChar {
  ch: string;
  /** How it sounded off (Azure), null = fine / not scored. */
  kind: Exclude<WeakKind, 'extra'> | null;
}

/**
 * The card's hanzi, character by character, each weak character tagged with its kind.
 * Weak characters are in reference order, so each one claims the next matching
 * character from where the previous one was found (银行行 with one weak 行 tags the first 行).
 */
export function expectedChars(hanzi: string, weak: WeakChar[] | null | undefined): ExpectedChar[] {
  const chars = Array.from(hanzi);
  const out: ExpectedChar[] = chars.map((ch) => ({ ch, kind: null }));
  let from = 0;
  for (const w of weak ?? []) {
    if (w.kind === 'extra') continue;
    let idx = chars.indexOf(w.char, from);
    if (idx < 0) idx = chars.findIndex((c, i) => c === w.char && out[i].kind == null);
    if (idx < 0) continue;
    out[idx].kind = w.kind;
    from = idx + 1;
  }
  return out;
}

export interface HeardChar {
  ch: string;
  /** Not part of the expected word (or in the wrong place). */
  wrong: boolean;
}

/** What the recogniser heard, with the characters that don't line up with the card marked. */
export function heardChars(transcript: string | null | undefined, hanzi: string): HeardChar[] {
  const t = (transcript ?? '').trim();
  if (!t) return [];
  const d = diffHanzi(t, hanzi);
  if (d.typed.length === 0) return Array.from(t).map((ch) => ({ ch, wrong: false }));
  return d.typed.map((c) => ({ ch: c.ch, wrong: !c.hit }));
}

/** All recordings: unmarked first, then needs work, then listened; newest first within each. */
export function sortAllRecordings(items: RecordingQueueItem[]): RecordingQueueItem[] {
  const group = (i: RecordingQueueItem) => (!i.mark ? 0 : i.mark.status === 'needs_work' ? 1 : 2);
  return [...items].sort(
    (a, b) => group(a) - group(b) || (a.reviewed_at < b.reviewed_at ? 1 : a.reviewed_at > b.reviewed_at ? -1 : 0)
  );
}

/** The queue response after marking one item (it leaves the queue). Unchanged when absent. */
export function withoutQueueItem(data: RecordingQueueResponse, eventId: string): RecordingQueueResponse {
  if (!data.items.some((i) => i.event_id === eventId)) return data;
  return {
    ...data,
    items: data.items.filter((i) => i.event_id !== eventId),
    counts: { ...data.counts, queue: Math.max(0, data.counts.queue - 1) },
  };
}

/** "Nothing needs your ear 🎧 — 5 recordings in this range sound fine" */
export function emptyQueueLine(all: number): string {
  if (all === 0) return 'No recordings in this range yet.';
  return `Nothing needs your ear 🎧 — ${all} recording${all === 1 ? '' : 's'} in this range sound${all === 1 ? 's' : ''} fine`;
}

/** Keep polling while checks are running, but never forever. */
export const CHECKING_POLL_MS = 10_000;
export const CHECKING_POLL_CAP_MS = 3 * 60_000;

export function shouldPoll(checking: number, startedAt: number, now: number): boolean {
  return checking > 0 && now - startedAt < CHECKING_POLL_CAP_MS;
}
