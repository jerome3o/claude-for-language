import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockD1,
  createTestUser,
  createTestRelationship,
  createTestConversation,
  createTestDeck,
  createTestNote,
  MockD1Database,
} from './d1-mock';

// We need to mock the dependencies that conversations.ts imports
vi.mock('../relationships', () => ({
  verifyRelationshipAccess: vi.fn(),
  getOtherUserId: vi.fn(),
  getMyRole: vi.fn(),
}));

vi.mock('../cards', () => ({
  generateId: vi.fn(),
  CARD_TYPES: ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'],
}));

import {
  getConversations,
  createConversation,
  getConversationById,
  getMessages,
  sendMessage,
  shareDeck,
  getSharedDecks,
  studentShareDeck,
  getStudentSharedDecks,
  unshareStudentDeck,
  getDeckTutorShares,
  getChatContext,
  buildFlashcardPrompt,
  buildResponseOptionsPrompt,
} from '../conversations';

import { verifyRelationshipAccess, getOtherUserId, getMyRole } from '../relationships';
import { generateId } from '../cards';

const mockVerifyAccess = vi.mocked(verifyRelationshipAccess);
const mockGetOtherUserId = vi.mocked(getOtherUserId);
const mockGetMyRole = vi.mocked(getMyRole);
const mockGenerateId = vi.mocked(generateId);

describe('conversations service', () => {
  let db: MockD1Database;

  const tutor = createTestUser({ id: 'tutor-1', email: 'tutor@test.com', name: 'Tutor' });
  const student = createTestUser({ id: 'student-1', email: 'student@test.com', name: 'Student' });
  const rel = createTestRelationship({
    id: 'rel-1',
    requester_id: tutor.id,
    recipient_id: student.id,
    requester_role: 'tutor',
    status: 'active',
  });

  beforeEach(() => {
    db = createMockD1();
    vi.clearAllMocks();

    // Default mock implementations
    mockVerifyAccess.mockResolvedValue(rel as any);
    mockGetOtherUserId.mockImplementation((r: any, myId: string) =>
      r.requester_id === myId ? r.recipient_id : r.requester_id
    );
    mockGetMyRole.mockImplementation((r: any, myId: string) => {
      if (r.requester_id === myId) return r.requester_role;
      return r.requester_role === 'tutor' ? 'student' : 'tutor';
    });

    let idCounter = 0;
    mockGenerateId.mockImplementation(() => `generated-id-${++idCounter}`);
  });

  // ==================== getConversations ====================

  describe('getConversations', () => {
    it('returns conversations with last message and other user', async () => {
      const otherUser = { id: student.id, email: student.email, name: student.name, picture_url: null };
      db.addResult('SELECT id, email, name, picture_url FROM users', otherUser);

      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addAllResult('FROM conversations c', [{
        ...conv,
        last_content: 'Hello!',
        last_sender_id: tutor.id,
        last_created_at: '2026-01-02T00:00:00Z',
      }]);

      const result = await getConversations(db as any, 'rel-1', tutor.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('conv-1');
      expect(result[0].other_user).toEqual(otherUser);
      expect(result[0].last_message).toBeDefined();
      expect(result[0].last_message!.content).toBe('Hello!');
      expect(result[0].last_message!.sender_id).toBe(tutor.id);
    });

    it('returns conversations without last message when none exist', async () => {
      const otherUser = { id: student.id, email: student.email, name: student.name, picture_url: null };
      db.addResult('SELECT id, email, name, picture_url FROM users', otherUser);

      const conv = createTestConversation({ id: 'conv-1' });
      db.addAllResult('FROM conversations c', [{
        ...conv,
        last_content: null,
        last_sender_id: null,
        last_created_at: null,
      }]);

      const result = await getConversations(db as any, 'rel-1', tutor.id);

      expect(result).toHaveLength(1);
      expect(result[0].last_message).toBeUndefined();
    });

    it('throws when other user is not found', async () => {
      // No user result configured → returns null
      db.addAllResult('FROM conversations c', []);

      await expect(getConversations(db as any, 'rel-1', tutor.id))
        .rejects.toThrow('Other user not found');
    });

    it('returns empty array when no conversations exist', async () => {
      const otherUser = { id: student.id, email: student.email, name: student.name, picture_url: null };
      db.addResult('SELECT id, email, name, picture_url FROM users', otherUser);
      db.addAllResult('FROM conversations c', []);

      const result = await getConversations(db as any, 'rel-1', tutor.id);

      expect(result).toEqual([]);
    });

    it('sets is_ai_conversation to boolean', async () => {
      const otherUser = { id: student.id, email: student.email, name: student.name, picture_url: null };
      db.addResult('SELECT id, email, name, picture_url FROM users', otherUser);

      db.addAllResult('FROM conversations c', [{
        ...createTestConversation({ is_ai_conversation: 1 }),
        last_content: null,
        last_sender_id: null,
        last_created_at: null,
      }]);

      const result = await getConversations(db as any, 'rel-1', tutor.id);
      expect(result[0].is_ai_conversation).toBe(true);
    });
  });

  // ==================== createConversation ====================

  describe('createConversation', () => {
    it('creates a basic conversation', async () => {
      const newConv = createTestConversation({ id: 'generated-id-1' });
      db.addResult('SELECT * FROM conversations WHERE id', newConv);

      const result = await createConversation(db as any, 'rel-1', tutor.id);

      expect(result.id).toBe('generated-id-1');
      expect(mockVerifyAccess).toHaveBeenCalledWith(db, 'rel-1', tutor.id);
    });

    it('creates a conversation with AI options when other user is Claude', async () => {
      const claudeRel = createTestRelationship({
        id: 'rel-ai',
        requester_id: student.id,
        recipient_id: 'claude-ai',
        requester_role: 'student',
      });
      mockVerifyAccess.mockResolvedValue(claudeRel as any);
      mockGetOtherUserId.mockReturnValue('claude-ai');

      const newConv = createTestConversation({
        id: 'generated-id-1',
        is_ai_conversation: 1,
        scenario: 'ordering food',
      });
      db.addResult('SELECT * FROM conversations WHERE id', newConv);

      const result = await createConversation(db as any, 'rel-ai', student.id, {
        title: 'Food ordering practice',
        scenario: 'ordering food',
        user_role: 'customer',
        ai_role: 'waiter',
      });

      expect(result).toBeDefined();
      // Verify the INSERT was called
      const queries = db.getQueries();
      const insertQuery = queries.find(q => q.sql.includes('INSERT INTO conversations'));
      expect(insertQuery).toBeDefined();
    });

    it('uses default voice settings when not provided', async () => {
      const newConv = createTestConversation({ id: 'generated-id-1' });
      db.addResult('SELECT * FROM conversations WHERE id', newConv);

      await createConversation(db as any, 'rel-1', tutor.id);

      const queries = db.getQueries();
      const insertQuery = queries.find(q => q.sql.includes('INSERT INTO conversations'));
      // The last two params should be the voice defaults
      expect(insertQuery!.params).toContain('Chinese (Mandarin)_Gentleman');
      expect(insertQuery!.params).toContain(0.8);
    });

    it('throws when conversation creation fails', async () => {
      // No SELECT result configured after INSERT → returns null
      await expect(createConversation(db as any, 'rel-1', tutor.id))
        .rejects.toThrow('Failed to create conversation');
    });
  });

  // ==================== getConversationById ====================

  describe('getConversationById', () => {
    it('returns conversation when user has access', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);

      const result = await getConversationById(db as any, 'conv-1', tutor.id);

      expect(result).toEqual(conv);
      expect(mockVerifyAccess).toHaveBeenCalledWith(db, 'rel-1', tutor.id);
    });

    it('returns null when conversation does not exist', async () => {
      const result = await getConversationById(db as any, 'nonexistent', tutor.id);
      expect(result).toBeNull();
    });

    it('returns null when user does not have relationship access', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);
      mockVerifyAccess.mockRejectedValue(new Error('Not authorized'));

      const result = await getConversationById(db as any, 'conv-1', 'stranger-id');

      expect(result).toBeNull();
    });
  });

  // ==================== getMessages ====================

  describe('getMessages', () => {
    it('returns messages with sender info', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);

      db.addAllResult('FROM messages m', [{
        id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: tutor.id,
        content: 'Hello!',
        created_at: '2026-01-01T10:00:00Z',
        check_status: null,
        check_feedback: null,
        recording_url: null,
        u_id: tutor.id,
        u_name: 'Tutor',
        u_picture: null,
      }]);

      const result = await getMessages(db as any, 'conv-1', tutor.id);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello!');
      expect(result.messages[0].sender.id).toBe(tutor.id);
      expect(result.messages[0].sender.name).toBe('Tutor');
      expect(result.latest_timestamp).toBe('2026-01-01T10:00:00Z');
    });

    it('returns empty messages and null timestamp for empty conversation', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);
      db.addAllResult('FROM messages m', []);

      const result = await getMessages(db as any, 'conv-1', tutor.id);

      expect(result.messages).toEqual([]);
      expect(result.latest_timestamp).toBeNull();
    });

    it('filters messages by since parameter', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);
      db.addAllResult('FROM messages m', [{
        id: 'msg-2',
        conversation_id: 'conv-1',
        sender_id: student.id,
        content: 'New message',
        created_at: '2026-01-01T12:00:00Z',
        check_status: null,
        check_feedback: null,
        recording_url: null,
        u_id: student.id,
        u_name: 'Student',
        u_picture: null,
      }]);

      const result = await getMessages(db as any, 'conv-1', tutor.id, '2026-01-01T11:00:00Z');

      // Verify the SQL includes the since filter
      const queries = db.getQueries();
      const msgQuery = queries.find(q => q.sql.includes('FROM messages m'));
      expect(msgQuery!.sql).toContain('m.created_at > ?');
      expect(msgQuery!.params).toContain('2026-01-01T11:00:00Z');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('New message');
    });

    it('throws when conversation is not found', async () => {
      // No conversation result → getConversationById returns null
      await expect(getMessages(db as any, 'nonexistent', tutor.id))
        .rejects.toThrow('Conversation not found');
    });
  });

  // ==================== sendMessage ====================

  describe('sendMessage', () => {
    it('sends a message and updates conversation timestamp', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);

      const sender = { id: tutor.id, name: 'Tutor', picture_url: null };
      db.addResult('SELECT id, name, picture_url FROM users', sender);

      const result = await sendMessage(db as any, 'conv-1', tutor.id, 'Hello student!');

      expect(result.id).toBe('generated-id-1');
      expect(result.content).toBe('Hello student!');
      expect(result.sender_id).toBe(tutor.id);
      expect(result.sender.name).toBe('Tutor');
      expect(result.check_status).toBeNull();
      expect(result.recording_url).toBeNull();

      // Verify INSERT and UPDATE were called
      const queries = db.getQueries();
      expect(queries.some(q => q.sql.includes('INSERT INTO messages'))).toBe(true);
      expect(queries.some(q => q.sql.includes('UPDATE conversations SET last_message_at'))).toBe(true);
    });

    it('throws when conversation is not found', async () => {
      await expect(sendMessage(db as any, 'nonexistent', tutor.id, 'Hello'))
        .rejects.toThrow('Conversation not found');
    });

    it('returns fallback sender when user not found', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);
      // No user result → sender falls back to { id, name: null, picture_url: null }

      const result = await sendMessage(db as any, 'conv-1', tutor.id, 'Hi');

      expect(result.sender.id).toBe(tutor.id);
      expect(result.sender.name).toBeNull();
    });
  });

  // ==================== shareDeck (tutor → student) ====================

  describe('shareDeck', () => {
    it('copies deck, notes, and cards from tutor to student', async () => {
      mockGetMyRole.mockReturnValue('tutor');

      const deck = createTestDeck({ id: 'deck-1', user_id: tutor.id, name: 'HSK1' });
      db.addResult('SELECT * FROM decks WHERE id', deck);

      const note1 = createTestNote({ id: 'note-1', deck_id: 'deck-1', hanzi: '你好' });
      const note2 = createTestNote({ id: 'note-2', deck_id: 'deck-1', hanzi: '谢谢', pinyin: 'xièxiè', english: 'thanks' });
      db.addAllResult('SELECT * FROM notes WHERE deck_id', [note1, note2]);

      const result = await shareDeck(db as any, 'rel-1', tutor.id, 'deck-1');

      expect(result.source_deck_id).toBe('deck-1');
      expect(result.source_deck_name).toBe('HSK1');
      expect(result.target_deck_name).toBe('HSK1 (from tutor)');

      // Verify deck was created for student
      const queries = db.getQueries();
      const deckInserts = queries.filter(q => q.sql.includes('INSERT INTO decks'));
      expect(deckInserts).toHaveLength(1);
      expect(deckInserts[0].params).toContain(student.id); // Target deck belongs to student

      // Verify notes were copied
      const noteInserts = queries.filter(q => q.sql.includes('INSERT INTO notes'));
      expect(noteInserts).toHaveLength(2);

      // Verify cards were created (3 per note = 6 total)
      const cardInserts = queries.filter(q => q.sql.includes('INSERT INTO cards'));
      expect(cardInserts).toHaveLength(6);

      // Verify share record was created
      const shareInsert = queries.find(q => q.sql.includes('INSERT INTO shared_decks'));
      expect(shareInsert).toBeDefined();
    });

    it('throws when user is not a tutor', async () => {
      mockGetMyRole.mockReturnValue('student');

      await expect(shareDeck(db as any, 'rel-1', student.id, 'deck-1'))
        .rejects.toThrow('Only tutors can share decks');
    });

    it('throws when deck is not found', async () => {
      mockGetMyRole.mockReturnValue('tutor');
      // No deck result → returns null

      await expect(shareDeck(db as any, 'rel-1', tutor.id, 'nonexistent'))
        .rejects.toThrow('Deck not found');
    });

    it('handles decks with no notes', async () => {
      mockGetMyRole.mockReturnValue('tutor');

      const deck = createTestDeck({ id: 'deck-empty', user_id: tutor.id, name: 'Empty Deck' });
      db.addResult('SELECT * FROM decks WHERE id', deck);
      db.addAllResult('SELECT * FROM notes WHERE deck_id', []);

      const result = await shareDeck(db as any, 'rel-1', tutor.id, 'deck-empty');

      expect(result.source_deck_name).toBe('Empty Deck');

      // No note or card inserts
      const queries = db.getQueries();
      expect(queries.filter(q => q.sql.includes('INSERT INTO notes'))).toHaveLength(0);
      expect(queries.filter(q => q.sql.includes('INSERT INTO cards'))).toHaveLength(0);
    });
  });

  // ==================== getSharedDecks ====================

  describe('getSharedDecks', () => {
    it('returns shared decks with details', async () => {
      db.addAllResult('FROM shared_decks sd', [{
        id: 'share-1',
        relationship_id: 'rel-1',
        source_deck_id: 'deck-1',
        target_deck_id: 'deck-2',
        shared_at: '2026-01-01T00:00:00Z',
        source_deck_name: 'HSK1',
        target_deck_name: 'HSK1 (from tutor)',
      }]);

      const result = await getSharedDecks(db as any, 'rel-1', tutor.id);

      expect(result).toHaveLength(1);
      expect(result[0].source_deck_name).toBe('HSK1');
      expect(result[0].target_deck_name).toBe('HSK1 (from tutor)');
    });

    it('uses (deleted) for missing deck names', async () => {
      db.addAllResult('FROM shared_decks sd', [{
        id: 'share-1',
        relationship_id: 'rel-1',
        source_deck_id: 'deck-1',
        target_deck_id: 'deck-2',
        shared_at: '2026-01-01T00:00:00Z',
        source_deck_name: null,
        target_deck_name: null,
      }]);

      const result = await getSharedDecks(db as any, 'rel-1', tutor.id);

      expect(result[0].source_deck_name).toBe('(deleted)');
      expect(result[0].target_deck_name).toBe('(deleted)');
    });

    it('returns empty array when no shared decks', async () => {
      db.addAllResult('FROM shared_decks sd', []);

      const result = await getSharedDecks(db as any, 'rel-1', tutor.id);
      expect(result).toEqual([]);
    });
  });

  // ==================== studentShareDeck ====================

  describe('studentShareDeck', () => {
    it('creates a share record for student deck', async () => {
      mockGetMyRole.mockReturnValue('student');

      const deck = createTestDeck({ id: 'deck-1', user_id: student.id, name: 'My Deck' });
      db.addResult('SELECT * FROM decks WHERE id', deck);
      // No existing share
      // Note count
      db.addResult('SELECT COUNT(*) as count FROM notes', { count: 5 });

      const result = await studentShareDeck(db as any, 'rel-1', student.id, 'deck-1');

      expect(result.deck_id).toBe('deck-1');
      expect(result.deck_name).toBe('My Deck');
      expect(result.note_count).toBe(5);

      const queries = db.getQueries();
      expect(queries.some(q => q.sql.includes('INSERT INTO student_shared_decks'))).toBe(true);
    });

    it('throws when user is not a student', async () => {
      mockGetMyRole.mockReturnValue('tutor');

      await expect(studentShareDeck(db as any, 'rel-1', tutor.id, 'deck-1'))
        .rejects.toThrow('Only students can share their decks with tutors');
    });

    it('throws when deck does not belong to the student', async () => {
      mockGetMyRole.mockReturnValue('student');
      // No deck result → null

      await expect(studentShareDeck(db as any, 'rel-1', student.id, 'other-deck'))
        .rejects.toThrow('Deck not found or does not belong to you');
    });

    it('throws when deck is already shared', async () => {
      mockGetMyRole.mockReturnValue('student');

      const deck = createTestDeck({ id: 'deck-1', user_id: student.id });
      db.addResult('SELECT * FROM decks WHERE id', deck);
      db.addResult('SELECT id FROM student_shared_decks', { id: 'existing-share' });

      await expect(studentShareDeck(db as any, 'rel-1', student.id, 'deck-1'))
        .rejects.toThrow('Deck is already shared with this tutor');
    });
  });

  // ==================== getStudentSharedDecks ====================

  describe('getStudentSharedDecks', () => {
    it('returns student shared decks, filtering deleted ones', async () => {
      db.addAllResult('FROM student_shared_decks ssd', [
        {
          id: 'ssd-1',
          relationship_id: 'rel-1',
          deck_id: 'deck-1',
          shared_at: '2026-01-01T00:00:00Z',
          deck_name: 'My Deck',
          deck_description: 'A deck',
          note_count: 10,
        },
        {
          id: 'ssd-2',
          relationship_id: 'rel-1',
          deck_id: 'deck-deleted',
          shared_at: '2026-01-02T00:00:00Z',
          deck_name: null, // Deleted deck
          deck_description: null,
          note_count: 0,
        },
      ]);

      const result = await getStudentSharedDecks(db as any, 'rel-1', tutor.id);

      // Should filter out the deleted deck
      expect(result).toHaveLength(1);
      expect(result[0].deck_name).toBe('My Deck');
    });
  });

  // ==================== unshareStudentDeck ====================

  describe('unshareStudentDeck', () => {
    it('removes a student deck share', async () => {
      mockGetMyRole.mockReturnValue('student');

      db.addResult('SELECT id FROM decks WHERE id', { id: 'deck-1' });

      await unshareStudentDeck(db as any, 'rel-1', student.id, 'deck-1');

      const queries = db.getQueries();
      expect(queries.some(q => q.sql.includes('DELETE FROM student_shared_decks'))).toBe(true);
    });

    it('throws when user is not a student', async () => {
      mockGetMyRole.mockReturnValue('tutor');

      await expect(unshareStudentDeck(db as any, 'rel-1', tutor.id, 'deck-1'))
        .rejects.toThrow('Only students can unshare their decks');
    });

    it('throws when deck does not belong to the student', async () => {
      mockGetMyRole.mockReturnValue('student');

      await expect(unshareStudentDeck(db as any, 'rel-1', student.id, 'other-deck'))
        .rejects.toThrow('Deck not found or does not belong to you');
    });
  });

  // ==================== getDeckTutorShares ====================

  describe('getDeckTutorShares', () => {
    it('returns tutors that a deck has been shared with', async () => {
      db.addResult('SELECT id FROM decks WHERE id', { id: 'deck-1' });

      db.addAllResult('FROM student_shared_decks ssd', [{
        shared_deck_id: 'ssd-1',
        relationship_id: 'rel-1',
        shared_at: '2026-01-01T00:00:00Z',
        tutor_id: tutor.id,
        tutor_email: tutor.email,
        tutor_name: tutor.name,
        tutor_picture_url: null,
      }]);

      const result = await getDeckTutorShares(db as any, 'deck-1', student.id);

      expect(result).toHaveLength(1);
      expect(result[0].tutor.id).toBe(tutor.id);
      expect(result[0].tutor.name).toBe('Tutor');
      expect(result[0].relationship_id).toBe('rel-1');
    });

    it('throws when deck does not belong to student', async () => {
      await expect(getDeckTutorShares(db as any, 'other-deck', student.id))
        .rejects.toThrow('Deck not found or does not belong to you');
    });

    it('returns empty array when deck has no shares', async () => {
      db.addResult('SELECT id FROM decks WHERE id', { id: 'deck-1' });
      db.addAllResult('FROM student_shared_decks ssd', []);

      const result = await getDeckTutorShares(db as any, 'deck-1', student.id);
      expect(result).toEqual([]);
    });
  });

  // ==================== getChatContext ====================

  describe('getChatContext', () => {
    it('returns formatted chat transcript', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);

      db.addAllResult('FROM messages m', [
        { content: '你好', sender_name: 'Tutor' },
        { content: 'Hello!', sender_name: 'Student' },
      ]);

      const result = await getChatContext(db as any, 'conv-1', tutor.id);

      expect(result).toBe('Tutor: 你好\nStudent: Hello!');
    });

    it('uses Unknown for messages without sender name', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);

      db.addAllResult('FROM messages m', [
        { content: 'Test message', sender_name: null },
      ]);

      const result = await getChatContext(db as any, 'conv-1', tutor.id);
      expect(result).toBe('Unknown: Test message');
    });

    it('filters by message IDs when provided', async () => {
      const conv = createTestConversation({ id: 'conv-1', relationship_id: 'rel-1' });
      db.addResult('SELECT * FROM conversations WHERE id', conv);
      db.addAllResult('FROM messages m', [{ content: 'Filtered', sender_name: 'T' }]);

      await getChatContext(db as any, 'conv-1', tutor.id, ['msg-1', 'msg-2']);

      const queries = db.getQueries();
      const msgQuery = queries.find(q => q.sql.includes('FROM messages m') && q.sql.includes('m.id IN'));
      expect(msgQuery).toBeDefined();
      expect(msgQuery!.params).toContain('msg-1');
      expect(msgQuery!.params).toContain('msg-2');
    });

    it('throws when conversation is not found', async () => {
      await expect(getChatContext(db as any, 'nonexistent', tutor.id))
        .rejects.toThrow('Conversation not found');
    });
  });

  // ==================== Pure functions ====================

  describe('buildFlashcardPrompt', () => {
    it('includes chat context in the prompt', () => {
      const context = 'Tutor: 你好\nStudent: Hello!';
      const prompt = buildFlashcardPrompt(context);

      expect(prompt).toContain(context);
      expect(prompt).toContain('flashcard');
      expect(prompt).toContain('hanzi');
      expect(prompt).toContain('pinyin');
      expect(prompt).toContain('english');
      expect(prompt).toContain('tone marks');
    });

    it('specifies JSON output format', () => {
      const prompt = buildFlashcardPrompt('test');
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('"hanzi"');
      expect(prompt).toContain('"pinyin"');
      expect(prompt).toContain('"english"');
    });
  });

  describe('buildResponseOptionsPrompt', () => {
    it('includes chat context in the prompt', () => {
      const context = 'Tutor: 你好吗？';
      const prompt = buildResponseOptionsPrompt(context);

      expect(prompt).toContain(context);
      expect(prompt).toContain('response options');
      expect(prompt).toContain('3-5');
    });

    it('requests varying difficulty levels', () => {
      const prompt = buildResponseOptionsPrompt('test');
      expect(prompt).toContain('difficulty');
      expect(prompt).toContain('JSON array');
    });
  });
});
