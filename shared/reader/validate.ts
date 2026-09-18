/**
 * Structural validation for a reader spec (editor, import, PUT /spec, and
 * every spec Claude proposes). Returns a list of human-readable problems;
 * empty means valid.
 */

import { READER_DIFFICULTIES, ReaderSpec } from './types';

const MAX_PAGES = 60;
const MAX_TITLE = 200;
const MAX_TEXT = 4000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function validateReaderSpec(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ['Reader spec must be an object'];

  if (!str(input.title_chinese).trim()) errors.push('title_chinese is required');
  else if (str(input.title_chinese).length > MAX_TITLE) errors.push(`title_chinese is too long (max ${MAX_TITLE} characters)`);
  if (!str(input.title_english).trim()) errors.push('title_english is required');
  else if (str(input.title_english).length > MAX_TITLE) errors.push(`title_english is too long (max ${MAX_TITLE} characters)`);

  if (!(READER_DIFFICULTIES as readonly string[]).includes(str(input.difficulty_level))) {
    errors.push(`difficulty_level must be one of ${READER_DIFFICULTIES.join(', ')}`);
  }
  if (input.topic !== undefined && input.topic !== null && typeof input.topic !== 'string') {
    errors.push('topic must be a string or null');
  }

  if (input.vocabulary_used !== undefined) {
    if (!Array.isArray(input.vocabulary_used)) errors.push('vocabulary_used must be an array');
    else {
      input.vocabulary_used.forEach((item, i) => {
        if (!isRecord(item) || !str(item.hanzi).trim()) errors.push(`vocabulary_used[${i}] needs hanzi`);
      });
    }
  }

  if (!Array.isArray(input.pages)) {
    errors.push('pages must be an array');
    return errors;
  }
  if (input.pages.length === 0) errors.push('A reader needs at least one page');
  if (input.pages.length > MAX_PAGES) errors.push(`Too many pages (max ${MAX_PAGES})`);

  const seenIds = new Set<string>();
  input.pages.forEach((page, i) => {
    const n = i + 1;
    if (!isRecord(page)) {
      errors.push(`Page ${n} must be an object`);
      return;
    }
    if (page.id !== undefined) {
      if (typeof page.id !== 'string' || !page.id) errors.push(`Page ${n}: id must be a non-empty string when present`);
      else if (seenIds.has(page.id)) errors.push(`Page ${n}: duplicate page id "${page.id}"`);
      else seenIds.add(page.id);
    }
    if (!str(page.content_chinese).trim()) errors.push(`Page ${n}: Chinese text is required`);
    else if (str(page.content_chinese).length > MAX_TEXT) errors.push(`Page ${n}: Chinese text is too long`);
    if (page.content_pinyin !== undefined && typeof page.content_pinyin !== 'string') errors.push(`Page ${n}: content_pinyin must be a string`);
    if (page.content_english !== undefined && typeof page.content_english !== 'string') errors.push(`Page ${n}: content_english must be a string`);
    else if (!str(page.content_english).trim()) errors.push(`Page ${n}: English translation is required`);
    if (page.image_prompt !== undefined && page.image_prompt !== null && typeof page.image_prompt !== 'string') {
      errors.push(`Page ${n}: image_prompt must be a string or null`);
    }
  });

  return errors;
}

export function assertValidReaderSpec(input: unknown): asserts input is ReaderSpec {
  const errors = validateReaderSpec(input);
  if (errors.length > 0) throw new Error(`Invalid reader spec: ${errors.join('; ')}`);
}

/** Normalise a valid spec: trimmed strings, blank optionals → null/''. */
export function normalizeReaderSpec(spec: ReaderSpec): ReaderSpec {
  return {
    title_chinese: spec.title_chinese.trim(),
    title_english: spec.title_english.trim(),
    difficulty_level: spec.difficulty_level,
    topic: spec.topic?.trim() ? spec.topic.trim() : null,
    vocabulary_used: (spec.vocabulary_used ?? []).map(v => ({
      hanzi: v.hanzi.trim(),
      pinyin: (v.pinyin ?? '').trim(),
      english: (v.english ?? '').trim(),
    })),
    pages: spec.pages.map(p => ({
      ...(p.id ? { id: p.id } : {}),
      content_chinese: p.content_chinese.trim(),
      content_pinyin: (p.content_pinyin ?? '').trim(),
      content_english: (p.content_english ?? '').trim(),
      image_prompt: p.image_prompt?.trim() ? p.image_prompt.trim() : null,
      ...(p.image_url !== undefined ? { image_url: p.image_url } : {}),
    })),
  };
}
