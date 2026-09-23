import { describe, it, expect } from 'vitest';
import { createMockD1 } from './d1-mock';
import { propagateNoteAudioToSharedCopies } from '../../db/queries';

const NOTE_SQL = 'SELECT id, deck_id, hanzi, audio_url, audio_provider FROM notes WHERE id = ?';
const SHARES_SQL = 'SELECT target_deck_id FROM shared_decks WHERE source_deck_id = ?';
const UPDATE_SQL = 'UPDATE notes SET audio_url = ?, audio_provider = ?';

describe('propagateNoteAudioToSharedCopies', () => {
  it('gives every student copy of the word the clip, matched by hanzi and only where it has none', async () => {
    const db = createMockD1();
    db.addResult(NOTE_SQL, { id: 's1', deck_id: 'src', hanzi: '刮风 ', audio_url: '/audio/s1.mp3', audio_provider: 'gtts' });
    db.addAllResult(SHARES_SQL, [{ target_deck_id: 'tgt-a' }, { target_deck_id: 'tgt-b' }]);

    await propagateNoteAudioToSharedCopies(db, 's1');

    const updates = db.getQueries().filter(q => q.sql.includes(UPDATE_SQL));
    expect(updates).toHaveLength(2);
    expect(updates.map(q => q.params)).toEqual([
      ['/audio/s1.mp3', 'gtts', 'tgt-a', '刮风'],
      ['/audio/s1.mp3', 'gtts', 'tgt-b', '刮风'],
    ]);
    expect(updates[0].sql).toContain('AND audio_url IS NULL');
  });

  it('does nothing when the note has no clip yet or was never shared', async () => {
    const db = createMockD1();
    db.addResult(NOTE_SQL, { id: 's1', deck_id: 'src', hanzi: '刮风', audio_url: null, audio_provider: null });
    expect(await propagateNoteAudioToSharedCopies(db, 's1')).toBe(0);
    expect(db.getQueries().some(q => q.sql.includes(UPDATE_SQL))).toBe(false);

    const db2 = createMockD1();
    db2.addResult(NOTE_SQL, { id: 's1', deck_id: 'src', hanzi: '刮风', audio_url: '/audio/s1.mp3', audio_provider: 'gtts' });
    db2.addAllResult(SHARES_SQL, []);
    expect(await propagateNoteAudioToSharedCopies(db2, 's1')).toBe(0);
    expect(db2.getQueries().some(q => q.sql.includes(UPDATE_SQL))).toBe(false);
  });
});
