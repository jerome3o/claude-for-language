import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, createTestRelationship, MockD1Database } from './d1-mock';
import { updateSharedDeckCopy, COPY_NOTE_COLUMNS } from '../relationships';

const TARGET_SQL = `SELECT ${COPY_NOTE_COLUMNS} FROM notes WHERE deck_id = ?`;

describe('updateSharedDeckCopy', () => {
  let db: MockD1Database;

  const rel = createTestRelationship({
    id: 'rel-1',
    requester_id: 'tutor-1',
    recipient_id: 'student-1',
    requester_role: 'tutor',
    status: 'active',
  });
  const share = { id: 'share-1', relationship_id: 'rel-1', source_deck_id: 'src', target_deck_id: 'tgt', shared_at: '2026-09-01T00:00:00Z' };

  function note(id: string, hanzi: string, audio_url: string | null = `/audio/${id}.mp3`, extra: Record<string, unknown> = {}) {
    return { id, deck_id: 'src', hanzi, pinyin: 'x', english: 'y', audio_url, fun_facts: null, updated_at: '2026-09-01 10:00:00', ...extra };
  }

  beforeEach(() => {
    db = createMockD1();
    // verifyRelationshipAccess
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    db.addResult('SELECT * FROM shared_decks WHERE id = ?', share);
    db.addResult('SELECT id, name FROM decks WHERE id = ? AND user_id = ?', { id: 'src', name: 'Weather' });
    db.addResult('SELECT id FROM decks WHERE id = ? AND user_id = ?', { id: 'tgt' });
  });

  it('copies only the notes the student does not have yet and keeps the rest', async () => {
    db.addAllResult('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC', [
      note('s1', '刮风'),
      note('s2', '晴天'),
      note('s3', '下雨'),
    ]);
    db.addAllResult(TARGET_SQL, [
      { id: 't1', hanzi: '刮风', audio_url: '/audio/s1.mp3' },
    ]);

    const result = await updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1');

    expect(result).toMatchObject({ shared_deck_id: 'share-1', target_deck_id: 'tgt', added: 2, kept: 1, audio_filled: 0 });

    const inserts = db.getQueries().filter((q) => q.sql.includes('INSERT INTO notes'));
    expect(inserts).toHaveLength(2);
    expect(inserts.map((q) => q.params[2])).toEqual(['晴天', '下雨']);
    // every new note lands in the student's copy, with its three cards
    expect(inserts.every((q) => q.params[1] === 'tgt')).toBe(true);
    const cardInserts = db.getQueries().filter((q) => q.sql.includes('INSERT INTO cards'));
    expect(cardInserts).toHaveLength(6);
    expect(new Set(cardInserts.map((q) => q.params[2]))).toEqual(new Set(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi']));
    // the student's existing note is not touched
    expect(db.getQueries().some((q) => q.sql.includes('UPDATE notes'))).toBe(false);
    // the copy's updated_at is bumped so the student's next sync sees it
    expect(db.getQueries().some((q) => q.sql.includes("UPDATE decks SET updated_at") && q.params[0] === 'tgt')).toBe(true);
  });

  it('is a no-op when the copy is already up to date', async () => {
    db.addAllResult('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC', [note('s1', '刮风')]);
    db.addAllResult(TARGET_SQL, [{ id: 't1', hanzi: '刮风', audio_url: '/audio/s1.mp3' }]);

    const result = await updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1');

    expect(result).toMatchObject({ added: 0, kept: 1, audio_filled: 0 });
    expect(db.getQueries().some((q) => q.sql.startsWith('INSERT') || q.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('fills in audio the copy is missing without touching its cards', async () => {
    db.addAllResult('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC', [note('s1', '刮风', '/audio/s1.mp3')]);
    db.addAllResult(TARGET_SQL, [{ id: 't1', hanzi: '刮风', audio_url: null }]);

    const result = await updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1');

    expect(result).toMatchObject({ added: 0, kept: 1, audio_filled: 1 });
    const update = db.getQueries().find((q) => q.sql.includes('UPDATE notes SET audio_url'));
    expect(update?.params).toEqual(['/audio/s1.mp3', null, 't1']);
    expect(db.getQueries().some((q) => q.sql.includes('INSERT INTO cards'))).toBe(false);
  });

  it('matches by hanzi ignoring surrounding whitespace and never duplicates a repeated hanzi', async () => {
    db.addAllResult('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC', [
      note('s1', ' 刮风 '),
      note('s2', '晴天'),
      note('s3', '晴天'),
    ]);
    db.addAllResult(TARGET_SQL, [{ id: 't1', hanzi: '刮风', audio_url: '/a.mp3' }]);

    const result = await updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1');

    expect(result).toMatchObject({ added: 1, kept: 2 });
  });

  it("carries the tutor's newer text onto the copy, cards and history untouched", async () => {
    db.addAllResult('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC', [
      note('s1', '刮风', '/a.mp3', { english: 'windy (weather)', sentence_clue: '今天刮风。', updated_at: '2026-09-05 10:00:00' }),
    ]);
    db.addAllResult(TARGET_SQL, [{ id: 't1', hanzi: '刮风', pinyin: 'x', english: 'y', audio_url: '/a.mp3', fun_facts: null, sentence_clue: null, updated_at: '2026-09-01 10:00:00' }]);

    const result = await updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1');

    expect(result).toMatchObject({ added: 0, kept: 1, audio_filled: 0, updated: 1 });
    const update = db.getQueries().find((q) => q.sql.includes('UPDATE notes SET english = ?, sentence_clue = ?'));
    expect(update?.params).toEqual(['windy (weather)', '今天刮风。', 't1']);
    expect(db.getQueries().some((q) => q.sql.includes('INSERT INTO'))).toBe(false);
    expect(db.getQueries().some((q) => q.sql.includes("UPDATE decks SET updated_at") && q.params[0] === 'tgt')).toBe(true);
  });

  it("keeps the student's own more recent edit", async () => {
    db.addAllResult('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC', [
      note('s1', '刮风', '/a.mp3', { english: 'windy (weather)', updated_at: '2026-09-05 10:00:00' }),
    ]);
    db.addAllResult(TARGET_SQL, [{ id: 't1', hanzi: '刮风', pinyin: 'x', english: 'my gloss', audio_url: '/a.mp3', fun_facts: null, sentence_clue: null, updated_at: '2026-09-06 10:00:00' }]);

    const result = await updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1');

    expect(result).toMatchObject({ added: 0, kept: 1, updated: 0 });
    expect(db.getQueries().some((q) => q.sql.startsWith('UPDATE notes'))).toBe(false);
  });

  it('refuses when the caller is the student', async () => {
    await expect(updateSharedDeckCopy(db, 'rel-1', 'student-1', 'share-1')).rejects.toThrow('Only tutors');
  });

  it('refuses a share that belongs to another relationship', async () => {
    db.reset();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    db.addResult('SELECT * FROM shared_decks WHERE id = ?', { ...share, relationship_id: 'rel-other' });
    await expect(updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1')).rejects.toThrow('Shared deck not found');
  });

  it('tells the tutor to share again when the student deleted their copy', async () => {
    db.reset();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    db.addResult('SELECT * FROM shared_decks WHERE id = ?', share);
    db.addResult('SELECT id, name FROM decks WHERE id = ? AND user_id = ?', { id: 'src', name: 'Weather' });
    await expect(updateSharedDeckCopy(db, 'rel-1', 'tutor-1', 'share-1')).rejects.toThrow('share it again');
  });
});
