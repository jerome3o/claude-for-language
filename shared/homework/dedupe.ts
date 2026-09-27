/**
 * "Don't send words the student already has": draft words are matched against
 * the student's notes on normalised hanzi (the same key the word importer uses:
 * whitespace and punctuation ignored), the way check_student_words matches
 * them. A word repeated inside the draft is skipped too. `includeAnyway` lets
 * the tutor keep a known word on purpose.
 */

import { normalizeHanzi } from '../import/parse';

export function hanziKey(hanzi: string): string {
  return normalizeHanzi(hanzi);
}

export type SkipReason = 'known' | 'repeat';

export interface DedupeResult<T> {
  keep: T[];
  skipped: Array<{ word: T; reason: SkipReason }>;
}

export function dedupeWords<T extends { hanzi: string }>(
  words: readonly T[],
  knownHanzi: Iterable<string>,
  includeAnyway: Iterable<string> = []
): DedupeResult<T> {
  const known = new Set(Array.from(knownHanzi, hanziKey));
  const forced = new Set(Array.from(includeAnyway, hanziKey));
  const seen = new Set<string>();
  const keep: T[] = [];
  const skipped: DedupeResult<T>['skipped'] = [];
  for (const word of words) {
    const key = hanziKey(word.hanzi);
    if (!key) continue;
    if (seen.has(key)) {
      skipped.push({ word, reason: 'repeat' });
      continue;
    }
    seen.add(key);
    if (known.has(key) && !forced.has(key)) {
      skipped.push({ word, reason: 'known' });
      continue;
    }
    keep.push(word);
  }
  return { keep, skipped };
}
