/**
 * Reader editor persistence: a whole reader (meta + pages) replaced in one
 * call from a ReaderSpec, and a reader created from a spec (import).
 *
 * Pages are upserted by id: a spec page whose id matches an existing page is
 * updated in place (keeping its illustration when the prompt is unchanged),
 * unknown/missing ids become new pages, existing pages absent from the spec
 * are deleted, and page numbers are renumbered to match spec order.
 */

import { ReaderSpec, ReaderPageSpec } from '@shared/reader';
import { GradedReaderWithPages, ReaderPage, DifficultyLevel, VocabularyItem } from '../types';

export function readerToSpec(reader: GradedReaderWithPages): ReaderSpec {
  return {
    title_chinese: reader.title_chinese,
    title_english: reader.title_english,
    difficulty_level: reader.difficulty_level,
    topic: reader.topic ?? null,
    vocabulary_used: reader.vocabulary_used ?? [],
    pages: reader.pages.map(p => ({
      id: p.id,
      content_chinese: p.content_chinese,
      content_pinyin: p.content_pinyin,
      content_english: p.content_english,
      image_prompt: p.image_prompt ?? null,
      image_url: p.image_url ?? null,
    })),
  };
}

export interface ApplyReaderSpecResult {
  pages: ReaderPage[];
  /** Pages that need an illustration generated (new or changed prompt). */
  imageJobs: Array<{ pageId: string; imagePrompt: string }>;
  /** R2 keys of illustrations that no longer belong to any page/prompt. */
  removedImageKeys: string[];
}

function samePrompt(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}

/**
 * Replace a reader's meta and pages from a (validated, normalised) spec.
 * `existing` is the reader as currently stored (ownership already checked).
 */
export async function applyReaderSpec(
  db: D1Database,
  existing: GradedReaderWithPages,
  spec: ReaderSpec,
): Promise<ApplyReaderSpecResult> {
  await db.prepare(`
    UPDATE graded_readers
    SET title_chinese = ?, title_english = ?, difficulty_level = ?, topic = ?, vocabulary_used = ?
    WHERE id = ?
  `).bind(
    spec.title_chinese,
    spec.title_english,
    spec.difficulty_level,
    spec.topic ?? null,
    JSON.stringify(spec.vocabulary_used ?? []),
    existing.id,
  ).run();

  const existingById = new Map(existing.pages.map(p => [p.id, p]));
  const keptIds = new Set<string>();
  const pages: ReaderPage[] = [];
  const imageJobs: ApplyReaderSpecResult['imageJobs'] = [];
  const removedImageKeys: string[] = [];

  for (let i = 0; i < spec.pages.length; i++) {
    const page: ReaderPageSpec = spec.pages[i];
    const pageNumber = i + 1;
    const prompt = page.image_prompt?.trim() ? page.image_prompt.trim() : null;
    const current = page.id ? existingById.get(page.id) : undefined;

    if (current) {
      keptIds.add(current.id);
      const keepImage = !!current.image_url && samePrompt(current.image_prompt, prompt);
      const imageUrl = keepImage ? current.image_url : null;
      if (!keepImage && current.image_url) removedImageKeys.push(current.image_url);
      await db.prepare(`
        UPDATE reader_pages
        SET page_number = ?, content_chinese = ?, content_pinyin = ?, content_english = ?, image_prompt = ?, image_url = ?
        WHERE id = ? AND reader_id = ?
      `).bind(pageNumber, page.content_chinese, page.content_pinyin ?? '', page.content_english ?? '', prompt, imageUrl, current.id, existing.id).run();
      if (!imageUrl && prompt) imageJobs.push({ pageId: current.id, imagePrompt: prompt });
      pages.push({ ...current, page_number: pageNumber, content_chinese: page.content_chinese, content_pinyin: page.content_pinyin ?? '', content_english: page.content_english ?? '', image_prompt: prompt, image_url: imageUrl });
    } else {
      const id = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english, image_url, image_prompt)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      `).bind(id, existing.id, pageNumber, page.content_chinese, page.content_pinyin ?? '', page.content_english ?? '', prompt).run();
      if (prompt) imageJobs.push({ pageId: id, imagePrompt: prompt });
      pages.push({ id, reader_id: existing.id, page_number: pageNumber, content_chinese: page.content_chinese, content_pinyin: page.content_pinyin ?? '', content_english: page.content_english ?? '', image_prompt: prompt, image_url: null });
    }
  }

  for (const old of existing.pages) {
    if (keptIds.has(old.id)) continue;
    await db.prepare('DELETE FROM reader_pages WHERE id = ? AND reader_id = ?').bind(old.id, existing.id).run();
    if (old.image_url) removedImageKeys.push(old.image_url);
  }

  return { pages, imageJobs, removedImageKeys };
}

/** Create a new, ready, unpublished reader owned by `userId` from a spec. */
export async function createReaderFromSpec(
  db: D1Database,
  userId: string,
  spec: ReaderSpec,
): Promise<{ reader: GradedReaderWithPages; imageJobs: ApplyReaderSpecResult['imageJobs'] }> {
  const readerId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, topic, source_deck_ids, vocabulary_used, status, is_published, creator_role)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'ready', 0, 'tutor')
  `).bind(readerId, userId, spec.title_chinese, spec.title_english, spec.difficulty_level, spec.topic ?? null, JSON.stringify(spec.vocabulary_used ?? [])).run();

  const shell: GradedReaderWithPages = {
    id: readerId,
    user_id: userId,
    title_chinese: spec.title_chinese,
    title_english: spec.title_english,
    difficulty_level: spec.difficulty_level as DifficultyLevel,
    topic: spec.topic ?? null,
    source_deck_ids: [],
    vocabulary_used: (spec.vocabulary_used ?? []) as VocabularyItem[],
    status: 'ready',
    is_published: 0,
    creator_role: 'tutor',
    created_at: new Date().toISOString(),
    pages: [],
  };
  // Ids in an imported spec belong to someone else's reader — never reuse them.
  const fresh: ReaderSpec = { ...spec, pages: spec.pages.map(({ id: _drop, image_url: _drop2, ...rest }) => rest) };
  const applied = await applyReaderSpec(db, shell, fresh);
  return { reader: { ...shell, pages: applied.pages }, imageJobs: applied.imageJobs };
}
