/**
 * Tutor → student sharing of graded readers.
 *
 * Modelled on `shareDeck` (services/conversations.ts): the tutor's reader is
 * copied into the student's account with new reader + page ids and the
 * `shared_readers` row links the two. The student's copy is a normal reader
 * (status ready, published, creator_role 'tutor') that their device picks up
 * on the next `GET /api/readers` sync and studies offline like any other.
 *
 * Illustrations are not copied: both copies point at the same R2 key. That is
 * why every place that deletes reader images goes through
 * `unreferencedImageKeys` first — a key is only removed from R2 once no
 * reader page references it any more.
 */

import type { GradedReaderWithPages, ReaderPage, VocabularyItem } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from './relationships';
import { generateId } from './cards';
import { parseReaderWords } from '@shared/reader/words';
import { deleteGradedReader } from '../db/queries';

export interface SharedReader {
  id: string;
  relationship_id: string;
  source_reader_id: string;
  target_reader_id: string;
  shared_at: string;
}

export interface SharedReaderWithDetails extends SharedReader {
  source_title_chinese: string | null;
  source_title_english: string | null;
  target_title_chinese: string | null;
  target_title_english: string | null;
  difficulty_level: string | null;
  /** The student deleted their copy. */
  target_deleted: boolean;
  page_count: number;
  /** How many times the student finished their copy (a story is read once — never scheduled again). */
  read_count: number;
  last_read_at: string | null;
  /** 0 again · 1 hard · 2 good · 3 easy, from the latest read. */
  last_rating: number | null;
}

interface ReaderRow {
  id: string;
  user_id: string;
  title_chinese: string;
  title_english: string;
  difficulty_level: string;
  topic: string | null;
  source_deck_ids: string;
  vocabulary_used: string;
  status: string;
  is_published: number | null;
  creator_role: string | null;
  created_at: string;
}

/**
 * Copy `readerId` (owned by `tutorId`) into the student's account. The
 * caller must be the tutor of the relationship; a reader that is still
 * generating or failed cannot be shared. A second share of the same reader
 * makes a second, independent copy (the same as re-sharing a deck).
 */
export async function shareReader(
  db: D1Database,
  relationshipId: string,
  tutorId: string,
  readerId: string
): Promise<{ share: SharedReader; reader: GradedReaderWithPages }> {
  const rel = await verifyRelationshipAccess(db, relationshipId, tutorId);
  if (getMyRole(rel, tutorId) !== 'tutor') {
    throw new Error('Only tutors can share readers');
  }

  const source = await db
    .prepare('SELECT * FROM graded_readers WHERE id = ? AND user_id = ?')
    .bind(readerId, tutorId)
    .first<ReaderRow>();
  if (!source) {
    throw new Error('Reader not found');
  }
  if (source.status !== 'ready') {
    throw new Error(`Only a finished reader can be shared (this one is "${source.status}")`);
  }

  const pages = await db
    .prepare('SELECT * FROM reader_pages WHERE reader_id = ? ORDER BY page_number ASC')
    .bind(readerId)
    .all<ReaderPage>();
  if (pages.results.length === 0) {
    throw new Error('This reader has no pages yet');
  }

  const studentId = getOtherUserId(rel, tutorId);
  const targetReaderId = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(`
      INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, topic,
        source_deck_ids, vocabulary_used, status, is_published, creator_role)
      VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'ready', 1, 'tutor')
    `)
    .bind(
      targetReaderId,
      studentId,
      source.title_chinese,
      source.title_english,
      source.difficulty_level,
      source.topic,
      source.vocabulary_used
    )
    .run();

  const copiedPages: ReaderPage[] = [];
  for (const page of pages.results) {
    const pageId = generateId();
    // image_url is the same R2 key on both copies — no bytes are copied.
    await db
      .prepare(`
        INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english, image_url, image_prompt, words)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        pageId,
        targetReaderId,
        page.page_number,
        page.content_chinese,
        page.content_pinyin,
        page.content_english,
        page.image_url ?? null,
        page.image_prompt ?? null,
        // The word chips travel with the copy (same text, same words).
        typeof page.words === 'string' ? page.words : null
      )
      .run();
    copiedPages.push({ ...page, id: pageId, reader_id: targetReaderId, words: parseReaderWords(page.words ?? null, page.content_chinese) });
  }

  const shareId = generateId();
  await db
    .prepare(`
      INSERT INTO shared_readers (id, relationship_id, source_reader_id, target_reader_id, shared_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(shareId, relationshipId, readerId, targetReaderId, now)
    .run();

  let vocabulary: VocabularyItem[] = [];
  try {
    vocabulary = JSON.parse(source.vocabulary_used) as VocabularyItem[];
  } catch {
    vocabulary = [];
  }

  return {
    share: {
      id: shareId,
      relationship_id: relationshipId,
      source_reader_id: readerId,
      target_reader_id: targetReaderId,
      shared_at: now,
    },
    reader: {
      id: targetReaderId,
      user_id: studentId,
      title_chinese: source.title_chinese,
      title_english: source.title_english,
      difficulty_level: source.difficulty_level as GradedReaderWithPages['difficulty_level'],
      topic: source.topic,
      source_deck_ids: [],
      vocabulary_used: vocabulary,
      status: 'ready',
      is_published: 1,
      creator_role: 'tutor',
      created_at: now,
      pages: copiedPages,
    },
  };
}

interface SharedReaderRow extends SharedReader {
  source_title_chinese: string | null;
  source_title_english: string | null;
  target_title_chinese: string | null;
  target_title_english: string | null;
  target_id: string | null;
  difficulty_level: string | null;
  page_count: number | null;
  read_count: number | null;
  last_read_at: string | null;
  last_rating: number | null;
}

/** Readers shared in a relationship, newest first, with the student's read
 * status (from `reader_review_events` on their copy). Either party may call. */
export async function listSharedReaders(
  db: D1Database,
  relationshipId: string,
  userId: string
): Promise<SharedReaderWithDetails[]> {
  await verifyRelationshipAccess(db, relationshipId, userId);

  const result = await db
    .prepare(`
      SELECT sr.*,
        src.title_chinese AS source_title_chinese,
        src.title_english AS source_title_english,
        tgt.id AS target_id,
        tgt.user_id AS target_user_id,
        tgt.title_chinese AS target_title_chinese,
        tgt.title_english AS target_title_english,
        tgt.difficulty_level AS difficulty_level,
        (SELECT COUNT(*) FROM reader_pages p WHERE p.reader_id = sr.target_reader_id) AS page_count,
        (SELECT COUNT(*) FROM reader_review_events e WHERE e.reader_id = sr.target_reader_id) AS read_count,
        (SELECT MAX(e.reviewed_at) FROM reader_review_events e WHERE e.reader_id = sr.target_reader_id) AS last_read_at,
        (SELECT e.rating FROM reader_review_events e WHERE e.reader_id = sr.target_reader_id ORDER BY e.reviewed_at DESC LIMIT 1) AS last_rating
      FROM shared_readers sr
      LEFT JOIN graded_readers src ON src.id = sr.source_reader_id
      LEFT JOIN graded_readers tgt ON tgt.id = sr.target_reader_id
      WHERE sr.relationship_id = ?
      ORDER BY sr.shared_at DESC
    `)
    .bind(relationshipId)
    .all<SharedReaderRow & { target_user_id?: string | null }>();

  return result.results.map(row => ({
    id: row.id,
    relationship_id: row.relationship_id,
    source_reader_id: row.source_reader_id,
    target_reader_id: row.target_reader_id,
    shared_at: row.shared_at,
    source_title_chinese: row.source_title_chinese,
    source_title_english: row.source_title_english,
    target_title_chinese: row.target_title_chinese,
    target_title_english: row.target_title_english,
    difficulty_level: row.difficulty_level,
    target_deleted: row.target_id === null || row.target_id === undefined,
    page_count: row.page_count ?? 0,
    read_count: row.read_count ?? 0,
    last_read_at: row.last_read_at ?? null,
    last_rating: row.last_rating ?? null,
  }));
}

/**
 * Of `keys` (R2 image keys about to be deleted for `readerId`), the ones no
 * OTHER reader page still references — the only ones safe to remove from R2.
 * A shared copy references the same key as its source, so deleting either
 * reader (or replacing a page's prompt) must leave the other's picture alone.
 */
export async function unreferencedImageKeys(
  db: D1Database,
  keys: string[],
  readerId: string
): Promise<string[]> {
  const safe: string[] = [];
  for (const key of [...new Set(keys)]) {
    if (!key) continue;
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM reader_pages WHERE image_url = ? AND reader_id != ?')
      .bind(key, readerId)
      .first<{ n: number }>();
    if (!row || Number(row.n) === 0) safe.push(key);
  }
  return safe;
}

/**
 * Delete one of the user's readers with its pictures — except pictures another
 * reader's page still uses (a shared copy). The one reader delete path:
 * `DELETE /api/readers/:id` and the tutor taking a shared reader back.
 */
export async function deleteReaderWithImages(
  env: { DB: D1Database; AUDIO_BUCKET: R2Bucket },
  userId: string,
  readerId: string
): Promise<boolean> {
  const pages = await env.DB
    .prepare('SELECT p.image_url FROM reader_pages p JOIN graded_readers r ON r.id = p.reader_id WHERE r.id = ? AND r.user_id = ?')
    .bind(readerId, userId)
    .all<{ image_url: string | null }>();
  const imageKeys = (pages.results || []).map(p => p.image_url).filter((k): k is string => !!k);
  const keys = await unreferencedImageKeys(env.DB, imageKeys, readerId);
  const deleted = await deleteGradedReader(env.DB, readerId, userId);
  if (!deleted) return false;
  for (const key of keys) {
    try {
      await env.AUDIO_BUCKET.delete(key);
    } catch (err) {
      console.error('Failed to delete image:', key, err);
    }
  }
  return true;
}

export interface ReaderCopyUpdate {
  /** Pages whose text / picture changed, added, removed. */
  changed: number;
  added: number;
  removed: number;
}

/**
 * Bring the student's copy of a shared reader up to date with the tutor's
 * reader (docs/HOMEWORK.md §10). Pages are matched by position and the copy's
 * page ids are KEPT, so the student's reading history stays attached; extra
 * source pages are inserted, extra copy pages deleted. Pictures and word chips
 * travel with the text (the same R2 key on both copies — nothing is copied or
 * deleted in R2; storage clean-up removes keys nothing references).
 */
export async function updateSharedReaderCopy(db: D1Database, sourceReaderId: string, targetReaderId: string): Promise<ReaderCopyUpdate> {
  const source = await db.prepare('SELECT * FROM graded_readers WHERE id = ?').bind(sourceReaderId).first<ReaderRow>();
  if (!source) throw new Error('The original reader no longer exists');
  const target = await db.prepare('SELECT id FROM graded_readers WHERE id = ?').bind(targetReaderId).first<{ id: string }>();
  if (!target) throw new Error('The student no longer has this reader');
  const [srcPages, copyPages] = await Promise.all([
    db.prepare('SELECT * FROM reader_pages WHERE reader_id = ? ORDER BY page_number ASC').bind(sourceReaderId).all<ReaderPage>(),
    db.prepare('SELECT * FROM reader_pages WHERE reader_id = ? ORDER BY page_number ASC').bind(targetReaderId).all<ReaderPage>(),
  ]);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare('UPDATE graded_readers SET title_chinese = ?, title_english = ?, difficulty_level = ?, topic = ?, vocabulary_used = ? WHERE id = ?')
      .bind(source.title_chinese, source.title_english, source.difficulty_level, source.topic, source.vocabulary_used, targetReaderId),
  ];
  const result: ReaderCopyUpdate = { changed: 0, added: 0, removed: 0 };
  const words = (p: ReaderPage) => (typeof p.words === 'string' ? p.words : p.words ? JSON.stringify(p.words) : null);
  srcPages.results.forEach((page, i) => {
    const copy = copyPages.results[i];
    if (copy) {
      const same =
        copy.page_number === page.page_number &&
        copy.content_chinese === page.content_chinese &&
        copy.content_pinyin === page.content_pinyin &&
        copy.content_english === page.content_english &&
        (copy.image_url ?? null) === (page.image_url ?? null) &&
        (copy.image_prompt ?? null) === (page.image_prompt ?? null);
      if (same) return;
      result.changed++;
      stmts.push(
        db
          .prepare('UPDATE reader_pages SET page_number = ?, content_chinese = ?, content_pinyin = ?, content_english = ?, image_url = ?, image_prompt = ?, words = ? WHERE id = ?')
          .bind(page.page_number, page.content_chinese, page.content_pinyin, page.content_english, page.image_url ?? null, page.image_prompt ?? null, words(page), copy.id)
      );
    } else {
      result.added++;
      stmts.push(
        db
          .prepare('INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english, image_url, image_prompt, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(generateId(), targetReaderId, page.page_number, page.content_chinese, page.content_pinyin, page.content_english, page.image_url ?? null, page.image_prompt ?? null, words(page))
      );
    }
  });
  for (const extra of copyPages.results.slice(srcPages.results.length)) {
    result.removed++;
    stmts.push(db.prepare('DELETE FROM reader_pages WHERE id = ?').bind(extra.id));
  }
  await db.batch(stmts);
  return result;
}
