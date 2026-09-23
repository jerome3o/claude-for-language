import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, createTestDeck, MockD1Database } from './d1-mock';

let idCounter = 0;
vi.stubGlobal('crypto', { randomUUID: () => `id-${++idCounter}` });

const generateTTSMock = vi.fn();
const deleteAudioMock = vi.fn();
vi.mock('../audio', () => ({
  generateTTS: (...args: unknown[]) => generateTTSMock(...args),
  deleteAudio: (...args: unknown[]) => deleteAudioMock(...args),
}));

import * as content from '../content';
import { DEFAULT_DECK_SETTINGS } from '@shared/decks';

const NOTE_ROW = { id: 'n1', deck_id: 'd1', hanzi: '刮风', pinyin: 'guā fēng', english: 'windy', audio_url: null, sentence_clue: null, sentence_clue_audio_url: null };

function envFor(db: MockD1Database) {
  return { DB: db, MINIMAX_API_KEY: 'k', AUDIO_BUCKET: {}, SENTENCE_SET_QUEUE: { send: vi.fn() } } as any;
}

describe('content service: decks', () => {
  let db: MockD1Database;
  beforeEach(() => { db = createMockD1(); idCounter = 0; });

  it('a new deck is written with every shared default (3 new + 6 secondary), never the column defaults', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ?', createTestDeck({ id: 'id-1', user_id: 'u1', name: 'Weather' }));
    await content.createDeck(db, 'u1', { name: '  Weather ', description: '' });
    const insert = db.getQueries().find(q => q.sql.includes('INSERT INTO decks'))!;
    for (const key of Object.keys(DEFAULT_DECK_SETTINGS)) expect(insert.sql).toContain(key);
    expect(insert.params.slice(0, 4)).toEqual(['id-1', 'u1', 'Weather', null]);
    const byColumn = Object.fromEntries(insert.sql.match(/\(([^)]+)\) VALUES/)![1].split(', ').map((c, i) => [c, insert.params[i]]));
    expect(byColumn.new_cards_per_day).toBe(3);
    expect(byColumn.secondary_cards_per_day).toBe(6);
    expect(byColumn.request_retention).toBe(0.9);
  });

  it('explicit settings override the defaults; bad ones are refused with the field named', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ?', createTestDeck({ id: 'id-1', user_id: 'u1' }));
    await content.createDeck(db, 'u1', { name: 'X', settings: { new_cards_per_day: 10 } });
    const insert = db.getQueries().find(q => q.sql.includes('INSERT INTO decks'))!;
    expect(insert.params).toContain(10);
    expect(insert.params).toContain(6);

    expect(() => content.pickDeckSettingsOrThrow({ new_cards_per_day: -1 })).toThrow(/new_cards_per_day/);
    await expect(content.createDeck(db, 'u1', { name: '   ' })).rejects.toThrow('Name is required');
  });

  it('updateDeckSettings validates before it writes', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ? AND user_id = ?', createTestDeck({ id: 'd1', user_id: 'u1' }));
    await expect(content.updateDeckSettings(db, 'u1', 'd1', { request_retention: 2 })).rejects.toMatchObject({ status: 400 });
    expect(db.getQueries().some(q => q.sql.includes('UPDATE decks'))).toBe(false);
    await content.updateDeckSettings(db, 'u1', 'd1', { new_cards_per_day: '4', request_retention: 0.85 });
    const update = db.getQueries().find(q => q.sql.includes('UPDATE decks SET'))!;
    expect(update.sql).toContain('new_cards_per_day = ?');
    expect(update.sql).toContain('request_retention = ?');
    expect(update.params.slice(0, 2)).toEqual([4, 0.85]);
  });

  it('copyDeckForUser makes a NEW deck with the defaults, copies notes with their clips and fresh cards', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ?', createTestDeck({ id: 'id-1', user_id: 'student' }));
    db.addAllResult('SELECT * FROM notes WHERE deck_id = ?', [
      { ...NOTE_ROW, audio_url: 'generated/a.mp3' },
      { ...NOTE_ROW, id: 'n2', hanzi: '晴天' },
    ]);
    const source = { ...createTestDeck({ id: 'src', user_id: 'tutor', name: 'Weather' }), new_cards_per_day: 20, secondary_cards_per_day: 10 } as any;
    const { deck, noteIds } = await content.copyDeckForUser(db, source, 'student', 'Weather (from tutor)');
    expect(deck.id).toBe('id-1');
    expect(noteIds).toHaveLength(2);
    const deckInsert = db.getQueries().find(q => q.sql.includes('INSERT INTO decks'))!;
    expect(deckInsert.params).toContain('student');
    expect(deckInsert.params).toContain(3);
    expect(deckInsert.params).not.toContain(20);
    const noteInserts = db.getQueries().filter(q => q.sql.includes('INSERT INTO notes'));
    expect(noteInserts).toHaveLength(2);
    expect(noteInserts[0].params).toContain('generated/a.mp3');
    expect(db.getQueries().filter(q => q.sql.includes('INSERT INTO cards'))).toHaveLength(6);
  });
});

describe('content service: notes', () => {
  let db: MockD1Database;
  let env: any;
  beforeEach(() => {
    db = createMockD1();
    idCounter = 0;
    env = envFor(db);
    generateTTSMock.mockReset();
    deleteAudioMock.mockReset();
    db.addResult('SELECT * FROM decks WHERE id = ? AND user_id = ?', createTestDeck({ id: 'd1', user_id: 'u1' }));
    db.addAllResult('SELECT * FROM cards WHERE note_id = ?', []);
  });

  it('createNote validates, inserts the note + three cards, queues audio in queue mode and the sentence set', async () => {
    db.addResult('SELECT * FROM notes WHERE id = ?', NOTE_ROW);
    await expect(content.createNote(env, 'u1', 'd1', { hanzi: '刮风', pinyin: 'gua1 feng1', english: 'windy' })).rejects.toThrow(/tone marks/);

    const note = await content.createNote(env, 'u1', 'd1', { hanzi: ' 刮风 ', pinyin: 'guā fēng', english: 'windy', sentence_clue: '今天刮风。' }, { audio: 'queue' });
    expect(note.id).toBe('n1');
    const insert = db.getQueries().find(q => q.sql.includes('INSERT INTO notes'))!;
    expect(insert.params.slice(2, 5)).toEqual(['刮风', 'guā fēng', 'windy']);
    expect(insert.params).toContain('今天刮风。');
    expect(db.getQueries().filter(q => q.sql.includes('INSERT INTO cards'))).toHaveLength(3);
    expect(env.SENTENCE_SET_QUEUE.send).toHaveBeenCalledWith({ noteId: 'n1', kind: 'note_audio' });
    expect(env.SENTENCE_SET_QUEUE.send).toHaveBeenCalledWith({ noteId: 'n1', count: undefined });
    expect(generateTTSMock).not.toHaveBeenCalled();
  });

  it('background mode hands the word + sentence clips to waitUntil and propagates the clip to student copies', async () => {
    db.addResult('SELECT * FROM notes WHERE id = ?', { ...NOTE_ROW, sentence_clue: '今天刮风。' });
    db.addResult('SELECT id, deck_id, hanzi, audio_url, audio_provider FROM notes WHERE id = ?', { id: 'n1', deck_id: 'd1', hanzi: '刮风', audio_url: 'generated/new.mp3', audio_provider: 'minimax' });
    db.addAllResult('SELECT target_deck_id FROM shared_decks WHERE source_deck_id = ?', [{ target_deck_id: 'tgt' }]);
    generateTTSMock.mockResolvedValue({ audioKey: 'generated/new.mp3', provider: 'minimax' });
    const pending: Promise<unknown>[] = [];
    const bg = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };

    await content.createNote(env, 'u1', 'd1', { hanzi: '刮风', pinyin: 'guā fēng', english: 'windy', sentence_clue: '今天刮风。' }, { audio: 'background', bg });
    expect(pending).toHaveLength(2);
    await Promise.all(pending);
    expect(generateTTSMock).toHaveBeenCalledTimes(2);
    expect(generateTTSMock.mock.calls[0][1]).toBe('刮风');
    expect(generateTTSMock.mock.calls[1][1]).toBe('今天刮风。');
    const propagate = db.getQueries().find(q => q.sql.includes('UPDATE notes SET audio_url = ?, audio_provider = ?') && q.sql.includes('audio_url IS NULL'));
    expect(propagate?.params).toEqual(['generated/new.mp3', 'minimax', 'tgt', '刮风']);
  });

  it('createNote refuses a deck the user does not own', async () => {
    const other = createMockD1();
    await expect(content.createNote(envFor(other), 'u1', 'missing', { hanzi: '刮风', pinyin: 'guā fēng', english: 'windy' })).rejects.toMatchObject({ status: 404 });
    expect(other.getQueries().some(q => q.sql.startsWith('INSERT'))).toBe(false);
  });

  it('createNotes keeps going past a bad row and reports it by index', async () => {
    db.addResult('SELECT * FROM notes WHERE id = ?', NOTE_ROW);
    const r = await content.createNotes(env, 'u1', 'd1', [
      { hanzi: '刮风', pinyin: 'guā fēng', english: 'windy' },
      { hanzi: '下雨', pinyin: 'xia4 yu3', english: 'rain' },
      { hanzi: '', pinyin: 'x', english: 'y' },
      { hanzi: '晴天', pinyin: 'qíng tiān', english: 'sunny' },
    ]);
    expect(r.created).toHaveLength(2);
    expect(r.failed).toEqual([
      { index: 1, hanzi: '下雨', error: expect.stringContaining('tone marks') },
      { index: 2, hanzi: '', error: 'hanzi is required' },
    ]);
    expect(env.SENTENCE_SET_QUEUE.send).toHaveBeenCalledTimes(4); // 2 × (note_audio + sentence set)
  });

  it('updateNote regenerates the word clip when the hanzi changes and the sentence clip when the clue changes', async () => {
    db.addResult('SELECT n.* FROM notes n', { ...NOTE_ROW, audio_url: 'generated/old.mp3' });
    db.addResult('SELECT * FROM notes WHERE id = ?', { ...NOTE_ROW, hanzi: '大风', audio_url: 'generated/old.mp3' });
    db.addAllResult('SELECT target_deck_id FROM shared_decks WHERE source_deck_id = ?', []);
    db.addAllResult('SELECT audio_url AS k FROM notes WHERE audio_url IN', []);
    generateTTSMock.mockResolvedValue({ audioKey: 'generated/new.mp3', provider: 'gtts' });

    const note = await content.updateNote(env, 'u1', 'n1', { hanzi: '大风' });
    expect(note?.hanzi).toBe('大风');
    expect(generateTTSMock).toHaveBeenCalledWith(env, '大风', 'n1');
    // the old clip goes only after the new one is stored
    expect(deleteAudioMock).toHaveBeenCalledWith(env.AUDIO_BUCKET, 'generated/old.mp3');

    await expect(content.updateNote(env, 'u1', 'n1', { pinyin: 'da4 feng1' })).rejects.toThrow(/tone marks/);
  });

  it('deleteNote removes only clips no other note or sentence still references', async () => {
    db.addResult('SELECT n.* FROM notes n', { ...NOTE_ROW, audio_url: 'generated/shared.mp3', sentence_clue_audio_url: 'generated/clue.mp3' });
    db.addResult('SELECT * FROM notes WHERE id = ?', { ...NOTE_ROW, audio_url: 'generated/shared.mp3', sentence_clue_audio_url: 'generated/clue.mp3' });
    db.addAllResult('SELECT audio_url FROM note_sentences WHERE note_id = ?', [{ audio_url: 'generated/s1.mp3' }]);
    // the student's copy still points at the word clip
    db.addAllResult('SELECT audio_url AS k FROM notes WHERE audio_url IN', [{ k: 'generated/shared.mp3' }]);

    expect(await content.deleteNote(env, 'u1', 'n1')).toBe(true);
    expect(db.getQueries().some(q => q.sql.includes('DELETE FROM notes WHERE id = ?'))).toBe(true);
    expect(db.getQueries().some(q => q.sql.includes('INSERT INTO deleted_items'))).toBe(true);
    const deleted = deleteAudioMock.mock.calls.map(c => c[1]).sort();
    expect(deleted).toEqual(['generated/clue.mp3', 'generated/s1.mp3']);
  });

  it('moveNotes only moves notes the user owns, into a deck they own, and bumps both decks', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ? AND user_id = ?', createTestDeck({ id: 'd2', user_id: 'u1' }));
    db.addAllResult('SELECT n.id, n.deck_id FROM notes n JOIN decks d', [{ id: 'n1', deck_id: 'd1' }]);
    const moved = await content.moveNotes(db, 'u1', ['n1', 'not-mine'], 'd2');
    expect(moved).toEqual(['n1']);
    const update = db.getQueries().find(q => q.sql.includes('UPDATE notes SET deck_id = ?'))!;
    expect(update.params).toEqual(['d2', 'n1']);
    const bumps = db.getQueries().filter(q => q.sql.includes("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")).map(q => q.params[0]);
    expect(bumps.sort()).toEqual(['d1', 'd2']);
  });
});
