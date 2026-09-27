/**
 * "Spread the words over N days": consecutive, balanced slices, one due date
 * per day starting at the first due date. Order is kept (the tutor's order is
 * usually the lesson's order); bigger slices come first.
 */

import { addDays } from './due';

export const MAX_SPLIT_DAYS = 14;

export interface SplitPart<T> {
  index: number;
  items: T[];
  due_date: string;
}

export function clampSplitDays(days: unknown, itemCount: number): number {
  const n = typeof days === 'number' && Number.isFinite(days) ? Math.round(days) : 1;
  return Math.max(1, Math.min(n, MAX_SPLIT_DAYS, Math.max(1, itemCount)));
}

export function splitIntoDays<T>(items: readonly T[], days: number, firstDue: string): SplitPart<T>[] {
  if (items.length === 0) return [];
  const n = clampSplitDays(days, items.length);
  const base = Math.floor(items.length / n);
  const extra = items.length % n;
  const parts: SplitPart<T>[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    parts.push({ index: i, items: items.slice(at, at + size), due_date: addDays(firstDue, i) });
    at += size;
  }
  return parts;
}

/** A gentle default: about `perDay` words a day. */
export function suggestSplitDays(wordCount: number, perDay = 10): number {
  if (wordCount <= perDay) return 1;
  return Math.min(MAX_SPLIT_DAYS, Math.ceil(wordCount / perDay));
}
