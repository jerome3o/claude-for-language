import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, createTestDeck, MockD1Database } from './d1-mock';

let idCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `id-${++idCounter}`,
});

const generateTTSMock = vi.fn();
vi.mock('../audio', () => ({
  generateTTS: (...args: unknown[]) => generateTTSMock(...args),
  deleteAudio: vi.fn(),
}));

import { ensureStarterDeck, STARTER_WORDS, STARTER_DECK_NAME } from '../starter-deck';

const Q_FIND = 'SELECT * FROM decks WHERE user_id = ? AND name = ?';

function envFor(db: MockD1Database) {
  return { DB: db, MINIMAX_API_KEY: 'k', SENTENCE_SET_QUEUE: { send: vi.fn() } } as any;
}

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
    generateTTSMock.mockResolvedValue({ audioKey: 'generated/x.mp3', provider: 'minimax' });
  });

  it('creates the deck (shared defaults) with one note per word, its sentence, three cards and audio', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ?', createTestDeck({ id: 'id-1', user_id: 'tutor-1', name: STARTER_DECK_NAME }));
    db.addResult('SELECT * FROM notes WHERE id = ?', { id: 'n', hanzi: '你好', sentence_clue: '你好！我叫李华。', audio_url: null, sentence_clue_audio_url: null });
    db.addAllResult('SELECT * FROM cards WHERE note_id = ?', []);
    const env = envFor(db);

    const r = await ensureStarterDeck(env, 'tutor-1');
    expect(r.created).toBe(true);
    expect(r.deck.name).toBe(STARTER_DECK_NAME);
    expect(r.noteIds).toHaveLength(STARTER_WORDS.length);

    const queries = db.getQueries();
    const deckInsert = queries.find(q => q.sql.includes('INSERT INTO decks'));
    expect(deckInsert?.params.slice(1, 3)).toEqual(['tutor-1', STARTER_DECK_NAME]);
    // new-deck defaults come from shared/decks, not the D1 column defaults
    expect(deckInsert?.sql).toContain('new_cards_per_day');
    expect(deckInsert?.params).toContain(3);
    expect(deckInsert?.params).toContain(6);
    const noteInserts = queries.filter(q => q.sql.includes('INSERT INTO notes'));
    expect(noteInserts).toHaveLength(STARTER_WORDS.length);
    expect(noteInserts[0].params.slice(2, 5)).toEqual([STARTER_WORDS[0].hanzi, STARTER_WORDS[0].pinyin, STARTER_WORDS[0].english]);
    // the example sentence is part of the insert, not a second write
    expect(noteInserts[0].params).toContain(STARTER_WORDS[0].sentence);
    expect(queries.filter(q => q.sql.includes('INSERT INTO cards'))).toHaveLength(STARTER_WORDS.length * 3);
    // word clip then sentence clip per note (no bg given, so awaited inline)
    expect(generateTTSMock).toHaveBeenCalledTimes(STARTER_WORDS.length * 2);
    expect(generateTTSMock.mock.calls[1][1]).toBe('你好！我叫李华。');
    // and each note's sentence set is queued
    expect(env.SENTENCE_SET_QUEUE.send).toHaveBeenCalledTimes(STARTER_WORDS.length);
  });

  it('is idempotent: returns the existing deck and inserts nothing', async () => {
    db.addResult(Q_FIND, createTestDeck({ id: 'existing', user_id: 'tutor-1', name: STARTER_DECK_NAME }));
    const r = await ensureStarterDeck(envFor(db), 'tutor-1');
    expect(r.created).toBe(false);
    expect(r.deck.id).toBe('existing');
    expect(r.noteIds).toEqual([]);
    expect(db.getQueries().some(q => q.sql.startsWith('INSERT'))).toBe(false);
  });

  it('looks the deck up by the calling user, not globally', async () => {
    db.addResult('SELECT * FROM decks WHERE id = ?', createTestDeck({ id: 'id-1', user_id: 'other' }));
    db.addResult('SELECT * FROM notes WHERE id = ?', { id: 'n', hanzi: '好', audio_url: null });
    db.addAllResult('SELECT * FROM cards WHERE note_id = ?', []);
    await ensureStarterDeck(envFor(db), 'other');
    const find = db.getQueries().find(q => q.sql.includes(Q_FIND));
    expect(find?.params).toEqual(['other', STARTER_DECK_NAME]);
  });
});
