import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, createTestRelationship, MockD1Database } from './d1-mock';
import { shareReader, listSharedReaders, unreferencedImageKeys } from '../shared-readers';

describe('shareReader', () => {
  let db: MockD1Database;

  const rel = createTestRelationship({
    id: 'rel-1',
    requester_id: 'tutor-1',
    recipient_id: 'student-1',
    requester_role: 'tutor',
    status: 'active',
  });

  const reader = {
    id: 'reader-1',
    user_id: 'tutor-1',
    title_chinese: '小猫找家',
    title_english: 'The Kitten Finds a Home',
    difficulty_level: 'beginner',
    topic: 'pets',
    source_deck_ids: '["deck-1"]',
    vocabulary_used: '[{"hanzi":"猫","pinyin":"māo","english":"cat"}]',
    status: 'ready',
    is_published: 0,
    creator_role: 'tutor',
    created_at: '2026-09-01T00:00:00Z',
  };

  const pages = [
    { id: 'p1', reader_id: 'reader-1', page_number: 1, content_chinese: '小猫很饿。', content_pinyin: 'xiǎo māo hěn è', content_english: 'The kitten is hungry.', image_url: 'reader-images/p1.png', image_prompt: 'a hungry kitten' },
    { id: 'p2', reader_id: 'reader-1', page_number: 2, content_chinese: '它找到了家。', content_pinyin: 'tā zhǎo dào le jiā', content_english: 'It found a home.', image_url: null, image_prompt: null },
  ];

  beforeEach(() => {
    db = createMockD1();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
  });

  it('copies the reader and its pages (sharing the image keys) into the student account and records the share', async () => {
    db.addResult('SELECT * FROM graded_readers WHERE id = ? AND user_id = ?', reader);
    db.addAllResult('SELECT * FROM reader_pages WHERE reader_id = ? ORDER BY page_number ASC', pages);

    const result = await shareReader(db, 'rel-1', 'tutor-1', 'reader-1');

    expect(result.share).toMatchObject({ relationship_id: 'rel-1', source_reader_id: 'reader-1' });
    expect(result.share.target_reader_id).not.toBe('reader-1');
    expect(result.reader).toMatchObject({
      id: result.share.target_reader_id,
      user_id: 'student-1',
      title_chinese: '小猫找家',
      status: 'ready',
      is_published: 1,
      creator_role: 'tutor',
      source_deck_ids: [],
      vocabulary_used: [{ hanzi: '猫', pinyin: 'māo', english: 'cat' }],
    });

    const readerInsert = db.getQueries().find((q) => q.sql.includes('INSERT INTO graded_readers'));
    expect(readerInsert?.params).toEqual([
      result.share.target_reader_id, 'student-1', '小猫找家', 'The Kitten Finds a Home', 'beginner', 'pets', reader.vocabulary_used,
    ]);
    expect(readerInsert?.sql).toContain("'ready', 1, 'tutor'");

    const pageInserts = db.getQueries().filter((q) => q.sql.includes('INSERT INTO reader_pages'));
    expect(pageInserts).toHaveLength(2);
    // new page ids, same reader target, same R2 key (no bytes copied)
    expect(pageInserts.map((q) => q.params[0])).not.toContain('p1');
    expect(pageInserts.every((q) => q.params[1] === result.share.target_reader_id)).toBe(true);
    expect(pageInserts.map((q) => q.params[6])).toEqual(['reader-images/p1.png', null]);
    expect(pageInserts.map((q) => q.params[2])).toEqual([1, 2]);
    expect(result.reader.pages.map((p) => p.image_url)).toEqual(['reader-images/p1.png', null]);

    const shareInsert = db.getQueries().find((q) => q.sql.includes('INSERT INTO shared_readers'));
    expect(shareInsert?.params.slice(0, 4)).toEqual([result.share.id, 'rel-1', 'reader-1', result.share.target_reader_id]);
  });

  it('refuses a caller who is not the tutor of the relationship', async () => {
    db.reset();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', createTestRelationship({
      id: 'rel-1', requester_id: 'student-1', recipient_id: 'tutor-1', requester_role: 'tutor',
    }));
    db.addResult('SELECT * FROM graded_readers WHERE id = ? AND user_id = ?', reader);

    await expect(shareReader(db, 'rel-1', 'tutor-1', 'reader-1')).rejects.toThrow('Only tutors can share readers');
    expect(db.getQueries().some((q) => q.sql.startsWith('INSERT'))).toBe(false);
  });

  it('refuses a reader the tutor does not own', async () => {
    // no graded_readers result configured → the ownership lookup returns null
    await expect(shareReader(db, 'rel-1', 'tutor-1', 'someone-elses-reader')).rejects.toThrow('Reader not found');
    const lookup = db.getQueries().find((q) => q.sql.includes('FROM graded_readers'));
    expect(lookup?.params).toEqual(['someone-elses-reader', 'tutor-1']);
    expect(db.getQueries().some((q) => q.sql.startsWith('INSERT'))).toBe(false);
  });

  it('refuses a reader that is still generating', async () => {
    db.addResult('SELECT * FROM graded_readers WHERE id = ? AND user_id = ?', { ...reader, status: 'generating' });
    await expect(shareReader(db, 'rel-1', 'tutor-1', 'reader-1')).rejects.toThrow('Only a finished reader can be shared');
  });
});

describe('listSharedReaders', () => {
  it('returns the shares with the student read status and flags deleted copies', async () => {
    const db = createMockD1();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', createTestRelationship({
      id: 'rel-1', requester_id: 'tutor-1', recipient_id: 'student-1',
    }));
    db.addAllResult('FROM shared_readers sr', [
      {
        id: 'share-1', relationship_id: 'rel-1', source_reader_id: 'r1', target_reader_id: 't1', shared_at: '2026-09-02T00:00:00Z',
        source_title_chinese: '小猫找家', source_title_english: 'Kitten', target_id: 't1', target_title_chinese: '小猫找家', target_title_english: 'Kitten',
        difficulty_level: 'beginner', page_count: 4, read_count: 2, last_read_at: '2026-09-03T00:00:00Z', last_rating: 2,
      },
      {
        id: 'share-2', relationship_id: 'rel-1', source_reader_id: 'r2', target_reader_id: 't2', shared_at: '2026-09-01T00:00:00Z',
        source_title_chinese: '去市场', source_title_english: 'Market', target_id: null, target_title_chinese: null, target_title_english: null,
        difficulty_level: null, page_count: 0, read_count: 0, last_read_at: null, last_rating: null,
      },
    ]);

    const shares = await listSharedReaders(db, 'rel-1', 'student-1');

    expect(shares).toHaveLength(2);
    expect(shares[0]).toMatchObject({ id: 'share-1', target_deleted: false, page_count: 4, read_count: 2, last_rating: 2 });
    expect(shares[1]).toMatchObject({ id: 'share-2', target_deleted: true, page_count: 0, read_count: 0, last_read_at: null });
  });
});

describe('unreferencedImageKeys', () => {
  it('keeps keys another reader page still points at', async () => {
    const db = createMockD1();
    db.addResultOnce('SELECT COUNT(*) AS n FROM reader_pages WHERE image_url = ? AND reader_id != ?', { n: 1 });
    db.addResultOnce('SELECT COUNT(*) AS n FROM reader_pages WHERE image_url = ? AND reader_id != ?', { n: 0 });

    const safe = await unreferencedImageKeys(db, ['reader-images/shared.png', 'reader-images/mine.png', 'reader-images/mine.png'], 'reader-1');

    expect(safe).toEqual(['reader-images/mine.png']);
    const checks = db.getQueries();
    expect(checks).toHaveLength(2);
    expect(checks.map((q) => q.params)).toEqual([
      ['reader-images/shared.png', 'reader-1'],
      ['reader-images/mine.png', 'reader-1'],
    ]);
  });
});
