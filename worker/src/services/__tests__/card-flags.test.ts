import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1, createTestRelationship, MockD1Database } from './d1-mock';
import {
  createCardFlag,
  replyToCardFlag,
  setCardFlagStatus,
  listCardFlags,
  CardFlagError,
  flagChatMessage,
  replyChatMessage,
} from '../card-flags';

let seq = 0;
vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++seq}` });

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const rel = createTestRelationship({ id: 'rel-1', requester_id: TUTOR, recipient_id: STUDENT, requester_role: 'tutor' });

function flagRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    relationship_id: 'rel-1',
    student_id: STUDENT,
    tutor_id: TUTOR,
    note_id: 'note-1',
    card_id: 'card-1',
    message: '我总是和很行搞混',
    status: 'open',
    tutor_reply: null,
    replied_at: null,
    student_seen_reply_at: null,
    created_at: '2026-09-25 10:00:00',
    resolved_at: null,
    hanzi: '银行',
    pinyin: 'yínháng',
    english: 'bank',
    deck_id: 'deck-1',
    deck_name: '第三周作业',
    card_type: 'meaning_to_hanzi',
    student_name: 'Jerome',
    tutor_name: 'Wang Laoshi',
    ...overrides,
  };
}

describe('createCardFlag', () => {
  let db: MockD1Database;
  beforeEach(() => {
    db = createMockD1();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    db.addResult('SELECT n.id FROM notes n JOIN decks d', { id: 'note-1' });
    db.addResult('SELECT id FROM cards WHERE id = ? AND note_id = ?', { id: 'card-1' });
    db.addResult('SELECT id FROM conversations WHERE relationship_id = ?', { id: 'conv-1' });
    db.addResult('SELECT * FROM conversations WHERE id = ?', { id: 'conv-1', relationship_id: 'rel-1' });
    db.addResult('SELECT id, name, picture_url FROM users WHERE id = ?', { id: STUDENT, name: 'Jerome', picture_url: null });
  });

  it('inserts the flag with the client id and mirrors it into the chat', async () => {
    db.addResultOnce('FROM card_flags f', null); // the idempotency pre-check finds nothing
    db.addResult('FROM card_flags f', flagRow());
    const { flag, created } = await createCardFlag(db, STUDENT, {
      id: 'flag-1',
      relationship_id: 'rel-1',
      note_id: 'note-1',
      card_id: 'card-1',
      message: '  我总是和很行搞混 ',
      created_at: '2026-09-25T10:00:00.000Z',
    });
    expect(created).toBe(true);
    expect(flag.id).toBe('flag-1');
    expect(flag.created_at).toBe('2026-09-25T10:00:00Z');
    const insert = db.getQueries().find((q) => q.sql.includes('INSERT OR IGNORE INTO card_flags'));
    expect(insert?.params).toEqual(['flag-1', 'rel-1', STUDENT, TUTOR, 'note-1', 'card-1', '我总是和很行搞混', '2026-09-25T10:00:00.000Z']);
    const message = db.getQueries().find((q) => q.sql.includes('INSERT INTO messages'));
    expect(message?.params[2]).toBe(STUDENT);
    expect(message?.params[3]).toBe('🚩 Flagged 银行 (yínháng · bank): 我总是和很行搞混');
  });

  it('is idempotent: an existing id returns the row without inserting again', async () => {
    db.addResult('FROM card_flags f', flagRow());
    const { created } = await createCardFlag(db, STUDENT, { id: 'flag-1', relationship_id: 'rel-1', note_id: 'note-1', message: 'x' });
    expect(created).toBe(false);
    expect(db.getQueries().some((q) => q.sql.includes('INSERT'))).toBe(false);
  });

  it('refuses an empty note, the tutor flagging, and a note that is not the student\'s', async () => {
    await expect(createCardFlag(db, STUDENT, { relationship_id: 'rel-1', note_id: 'note-1', message: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(createCardFlag(db, TUTOR, { relationship_id: 'rel-1', note_id: 'note-1', message: 'hi' })).rejects.toBeInstanceOf(CardFlagError);
    db.reset();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    await expect(createCardFlag(db, STUDENT, { relationship_id: 'rel-1', note_id: 'someone-elses', message: 'hi' })).rejects.toMatchObject({ status: 404 });
  });

  it('drops a card id that does not belong to the note', async () => {
    db.reset();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    db.addResult('SELECT n.id FROM notes n JOIN decks d', { id: 'note-1' });
    db.addResult('FROM card_flags f', flagRow({ card_id: null }));
    db.addResult('SELECT id FROM conversations WHERE relationship_id = ?', { id: 'conv-1' });
    db.addResult('SELECT * FROM conversations WHERE id = ?', { id: 'conv-1', relationship_id: 'rel-1' });
    await createCardFlag(db, STUDENT, { relationship_id: 'rel-1', note_id: 'note-1', card_id: 'wrong-card', message: 'hi' });
    const insert = db.getQueries().find((q) => q.sql.includes('INSERT OR IGNORE INTO card_flags'));
    expect(insert?.params[5]).toBeNull();
    expect(insert?.params[0]).toMatch(/^uuid-/);
  });
});

describe('replyToCardFlag / setCardFlagStatus', () => {
  let db: MockD1Database;
  beforeEach(() => {
    db = createMockD1();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    db.addResult('SELECT id FROM conversations WHERE relationship_id = ?', { id: 'conv-1' });
    db.addResult('SELECT * FROM conversations WHERE id = ?', { id: 'conv-1', relationship_id: 'rel-1' });
  });

  it('the tutor\'s reply resolves the flag, clears seen, and goes into the chat', async () => {
    db.addResultOnce('FROM card_flags f', flagRow());
    db.addResult('FROM card_flags f', flagRow({ status: 'resolved', tutor_reply: '银行的银是金属', replied_at: '2026-09-25 11:00:00' }));
    const flag = await replyToCardFlag(db, 'flag-1', TUTOR, ' 银行的银是金属 ');
    expect(flag.status).toBe('resolved');
    expect(flag.replied_at).toBe('2026-09-25T11:00:00Z');
    const update = db.getQueries().find((q) => q.sql.includes('UPDATE card_flags'));
    expect(update?.sql).toContain('student_seen_reply_at = NULL');
    expect(update?.params[0]).toBe('银行的银是金属');
    const message = db.getQueries().find((q) => q.sql.includes('INSERT INTO messages'));
    expect(message?.params[2]).toBe(TUTOR);
    expect(message?.params[3]).toBe('🚩 About 银行: 银行的银是金属');
  });

  it('only the tutor of the flag can reply; either party can resolve', async () => {
    db.addResult('FROM card_flags f', flagRow());
    await expect(replyToCardFlag(db, 'flag-1', STUDENT, 'no')).rejects.toMatchObject({ status: 403 });
    await expect(replyToCardFlag(db, 'flag-1', 'stranger', 'no')).rejects.toMatchObject({ status: 403 });
    await setCardFlagStatus(db, 'flag-1', STUDENT, 'resolved');
    await expect(setCardFlagStatus(db, 'flag-1', 'stranger', 'resolved')).rejects.toMatchObject({ status: 403 });
    const update = db.getQueries().find((q) => q.sql.includes('UPDATE card_flags SET status'));
    expect(update?.params[0]).toBe('resolved');
  });
});

describe('listCardFlags', () => {
  it('filters by status and normalises timestamps', async () => {
    const db = createMockD1();
    db.addResult('SELECT * FROM tutor_relationships WHERE id = ?', rel);
    db.addAllResult('FROM card_flags f', [flagRow()]);
    const flags = await listCardFlags(db, 'rel-1', TUTOR, { status: 'open' });
    expect(flags).toHaveLength(1);
    expect(flags[0].created_at).toBe('2026-09-25T10:00:00Z');
    const q = db.getQueries().find((x) => x.sql.includes('FROM card_flags f'));
    expect(q?.sql).toContain('f.status = ?');
    expect(q?.params).toEqual(['rel-1', 'open', 200]);
  });

  it('rejects a stranger', async () => {
    const db = createMockD1();
    await expect(listCardFlags(db, 'rel-1', 'stranger')).rejects.toMatchObject({ status: 404 });
  });
});

describe('chat wording', () => {
  it('reads as a flag / a reply about the word', () => {
    expect(flagChatMessage({ hanzi: '银行', pinyin: 'yínháng', english: 'bank', message: 'confused' })).toBe('🚩 Flagged 银行 (yínháng · bank): confused');
    expect(replyChatMessage({ hanzi: '银行' }, 'ok')).toBe('🚩 About 银行: ok');
  });
});
