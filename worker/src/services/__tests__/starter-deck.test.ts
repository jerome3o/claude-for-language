import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, createTestDeck, MockD1Database } from './d1-mock';

let idCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `id-${++idCounter}`,
});

const generateTTSMock = vi.fn();
vi.mock('../audio', () => ({
  generateTTS: (...args: unknown[]) => generateTTSMock(...args),
}));

import {
  ensureStarterDeck,
  generateStarterDeckAudio,
  STARTER_WORDS,
  STARTER_DECK_NAME,
} from '../starter-deck';

const Q_FIND = 'SELECT * FROM decks WHERE user_id = ? AND name = ?';

describe('starter deck content', () => {
  it('has about fifteen words, each with tone-marked pinyin and one example sentence', () => {
    expect(STARTER_WORDS.length).toBeGreaterThanOrEqual(13);
    expect(STARTER_WORDS.length).toBeLessThanOrEqual(20);
    const hanzi = new Set<string>();
    for (const w of STARTER_WORDS) {
      expect(hanzi.has(w.hanzi)).toBe(false);
      hanzi.add(w.hanzi);
      // tone marks, never tone numbers
      expect(w.pinyin).not.toMatch(/[0-9]/);
      expect(w.pinyin).toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/);
      expect(w.sentence).toContain(w.hanzi.replace(/[，。！？]/g, '').slice(0, 1));
      expect(w.sentence_pinyin).not.toMatch(/[0-9]/);
      expect(w.sentence_translation.length).toBeGreaterThan(0);
    }
    for (const must of ['你好', '谢谢', '再见', '不好意思', '请', '对不起', '没关系', '我', '你', '是', '不是', '好', '不好']) {
      expect(hanzi.has(must)).toBe(true);
    }
  });
});

describe('ensureStarterDeck', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = createMockD1();
    idCounter = 0;
    generateTTSMock.mockReset();
  });

  it('creates the deck with one note per word (and its sentence) the first time', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ?', createTestDeck({ id: 'id-1', user_id: 'tutor-1', name: STARTER_DECK_NAME }));
    db.addResult('SELECT * FROM notes WHERE id = ?', { id: 'n' });
    db.addAllResult('SELECT * FROM cards WHERE note_id = ?', []);

    const r = await ensureStarterDeck(db, 'tutor-1');
    expect(r.created).toBe(true);
    expect(r.deck.name).toBe(STARTER_DECK_NAME);
    expect(r.noteIds).toHaveLength(STARTER_WORDS.length);

    const queries = db.getQueries();
    const deckInsert = queries.find(q => q.sql.includes('INSERT INTO decks'));
    expect(deckInsert?.params.slice(1, 3)).toEqual(['tutor-1', STARTER_DECK_NAME]);
    const noteInserts = queries.filter(q => q.sql.includes('INSERT INTO notes'));
    expect(noteInserts).toHaveLength(STARTER_WORDS.length);
    expect(noteInserts[0].params.slice(2, 5)).toEqual([STARTER_WORDS[0].hanzi, STARTER_WORDS[0].pinyin, STARTER_WORDS[0].english]);
    // three cards per note
    expect(queries.filter(q => q.sql.includes('INSERT INTO cards'))).toHaveLength(STARTER_WORDS.length * 3);
    // the example sentence is written onto every note
    const clueUpdates = queries.filter(q => q.sql.includes('UPDATE notes') && q.sql.includes('sentence_clue'));
    expect(clueUpdates).toHaveLength(STARTER_WORDS.length);
    expect(clueUpdates[0].params).toContain(STARTER_WORDS[0].sentence);
  });

  it('is idempotent: returns the existing deck and inserts nothing', async () => {
    db.addResult(Q_FIND, createTestDeck({ id: 'existing', user_id: 'tutor-1', name: STARTER_DECK_NAME }));
    const r = await ensureStarterDeck(db, 'tutor-1');
    expect(r.created).toBe(false);
    expect(r.deck.id).toBe('existing');
    expect(r.noteIds).toEqual([]);
    expect(db.getQueries().some(q => q.sql.startsWith('INSERT'))).toBe(false);
  });

  it('looks the deck up by the calling user, not globally', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ?', createTestDeck({ id: 'id-1', user_id: 'other' }));
    db.addResult('SELECT * FROM notes WHERE id = ?', { id: 'n' });
    db.addAllResult('SELECT * FROM cards WHERE note_id = ?', []);
    await ensureStarterDeck(db, 'other');
    const find = db.getQueries().find(q => q.sql.includes(Q_FIND));
    expect(find?.params).toEqual(['other', STARTER_DECK_NAME]);
  });
});

describe('generateStarterDeckAudio', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = createMockD1();
    generateTTSMock.mockReset();
  });

  it('generates the word clip and the sentence clip for each note', async () => {
    db.addResult('SELECT id, hanzi, sentence_clue FROM notes WHERE id = ?', { id: 'n1', hanzi: '你好', sentence_clue: '你好！我叫李华。' });
    generateTTSMock.mockResolvedValue({ audioKey: 'generated/x.mp3', provider: 'minimax' });
    const env = { DB: db, MINIMAX_API_KEY: 'k' } as any;
    await generateStarterDeckAudio(env, ['n1']);
    expect(generateTTSMock).toHaveBeenCalledTimes(2);
    expect(generateTTSMock).toHaveBeenNthCalledWith(1, env, '你好', 'n1');
    expect(generateTTSMock).toHaveBeenNthCalledWith(2, env, '你好！我叫李华。', 'n1-sentence');
    const updates = db.getQueries().filter(q => q.sql.includes('UPDATE notes'));
    expect(updates.some(q => q.sql.includes('audio_url'))).toBe(true);
    expect(updates.some(q => q.sql.includes('sentence_clue_audio_url'))).toBe(true);
  });

  it('does nothing without a TTS key, and one failure does not stop the rest', async () => {
    await generateStarterDeckAudio({ DB: db } as any, ['n1']);
    expect(generateTTSMock).not.toHaveBeenCalled();

    db.addResult('SELECT id, hanzi, sentence_clue FROM notes WHERE id = ?', { id: 'n', hanzi: '好', sentence_clue: null });
    generateTTSMock.mockRejectedValueOnce(new Error('tts down')).mockResolvedValueOnce({ audioKey: 'g/y.mp3', provider: 'gtts' });
    await generateStarterDeckAudio({ DB: db, GOOGLE_TTS_API_KEY: 'k' } as any, ['n1', 'n2']);
    expect(generateTTSMock).toHaveBeenCalledTimes(2);
  });
});
