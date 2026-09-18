/**
 * Export formatters for a reader spec — pure functions so the worker can
 * serve downloads and the frontend can build the same files offline.
 *
 * - Markdown: title, one section per page (中文 / pinyin / English), glossary
 * - JSON: the spec itself, re-importable (page ids and image keys stripped)
 * - CSV: Quizlet-style hanzi / pinyin / english rows from vocabulary_used
 */

import { csvEscape } from '../lesson/export';
import { ReaderExportSpec, ReaderSpec, ReaderVocabularyItem } from './types';

export { csvEscape };

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  elementary: 'Elementary',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export function readerDifficultyLabel(level: string): string {
  return DIFFICULTY_LABELS[level] ?? level;
}

// ============ Markdown ============

export function readerToMarkdown(spec: ReaderSpec): string {
  const lines: string[] = [];
  lines.push(`# ${spec.title_chinese}`);
  lines.push('', `*${spec.title_english}*`);
  const metaBits = [readerDifficultyLabel(spec.difficulty_level)];
  if (spec.topic?.trim()) metaBits.push(`Topic: ${spec.topic.trim()}`);
  metaBits.push(`${spec.pages.length} page${spec.pages.length === 1 ? '' : 's'}`);
  lines.push('', metaBits.join(' · '));

  spec.pages.forEach((page, i) => {
    lines.push('', `## ${i + 1}`, '');
    lines.push(page.content_chinese.trim());
    if (page.content_pinyin?.trim()) lines.push('', `*${page.content_pinyin.trim()}*`);
    if (page.content_english?.trim()) lines.push('', page.content_english.trim());
    if (page.image_prompt?.trim()) lines.push('', `> Illustration: ${page.image_prompt.trim()}`);
  });

  const vocab = readerVocabRows(spec);
  if (vocab.length > 0) {
    lines.push('', '---', '', '## Glossary', '', '| 中文 | Pinyin | English |', '|---|---|---|');
    for (const v of vocab) lines.push(`| ${v.hanzi} | ${v.pinyin} | ${v.english} |`);
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

// ============ JSON ============

/** The spec with server-filled fields removed, so it imports cleanly for
 * anyone (page ids and R2 image keys from another account are meaningless). */
export function readerToExportSpec(spec: ReaderSpec): ReaderExportSpec {
  return {
    title_chinese: spec.title_chinese,
    title_english: spec.title_english,
    difficulty_level: spec.difficulty_level,
    topic: spec.topic ?? null,
    vocabulary_used: readerVocabRows(spec),
    pages: spec.pages.map(p => ({
      content_chinese: p.content_chinese,
      content_pinyin: p.content_pinyin ?? '',
      content_english: p.content_english ?? '',
      image_prompt: p.image_prompt?.trim() ? p.image_prompt : null,
    })),
  };
}

export function readerToJson(spec: ReaderSpec): string {
  return `${JSON.stringify(readerToExportSpec(spec), null, 2)}\n`;
}

// ============ CSV (Quizlet-style) ============

/** Vocabulary rows, deduplicated by hanzi, blank entries dropped. */
export function readerVocabRows(spec: ReaderSpec): ReaderVocabularyItem[] {
  const seen = new Set<string>();
  const rows: ReaderVocabularyItem[] = [];
  for (const v of spec.vocabulary_used ?? []) {
    const hanzi = (v.hanzi ?? '').trim();
    if (!hanzi || seen.has(hanzi)) continue;
    seen.add(hanzi);
    rows.push({ hanzi, pinyin: (v.pinyin ?? '').trim(), english: (v.english ?? '').trim() });
  }
  return rows;
}

export function readerToCsv(spec: ReaderSpec): string {
  const lines = ['hanzi,pinyin,english'];
  for (const row of readerVocabRows(spec)) {
    lines.push([row.hanzi, row.pinyin, row.english].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

// ============ Filenames ============

export function readerExportFilename(spec: ReaderSpec, ext: 'md' | 'json' | 'csv'): string {
  const base = (spec.title_english || spec.title_chinese)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'reader';
  return `${base}.${ext}`;
}
