import {
  Conversation,
  ConversationWithLastMessage,
  Message,
  MessageWithSender,
  SharedDeck,
  SharedDeckWithDetails,
  User,
  Deck,
  Note,
  GeneratedNote,
  CreateConversationRequest,
  CLAUDE_AI_USER_ID,
} from '../types';
import { verifyRelationshipAccess, getOtherUserId, getMyRole } from './relationships';
import { generateId, CARD_TYPES } from './cards';

type UserSummary = Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;

// ============ Conversations ============

/**
 * Get all conversations for a relationship
 */
export async function getConversations(
  db: D1Database,
  relationshipId: string,
  userId: string
): Promise<ConversationWithLastMessage[]> {
  // Verify access to relationship
  const rel = await verifyRelationshipAccess(db, relationshipId, userId);
  const otherUserId = getOtherUserId(rel, userId);

  // Get other user's summary
  const otherUser = await db
    .prepare('SELECT id, email, name, picture_url FROM users WHERE id = ?')
    .bind(otherUserId)
    .first<UserSummary>();

  if (!otherUser) {
    throw new Error('Other user not found');
  }

  // Get conversations with last message
  const conversations = await db
    .prepare(`
      SELECT c.*, m.content as last_content, m.sender_id as last_sender_id, m.created_at as last_created_at
      FROM conversations c
      LEFT JOIN messages m ON m.id = (
        SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      )
      WHERE c.relationship_id = ?
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    `)
    .bind(relationshipId)
    .all<Conversation & {
      last_content: string | null;
      last_sender_id: string | null;
      last_created_at: string | null;
    }>();

  return conversations.results.map(conv => ({
    id: conv.id,
    relationship_id: conv.relationship_id,
    title: conv.title,
    created_at: conv.created_at,
    last_message_at: conv.last_message_at,
    scenario: conv.scenario,
    user_role: conv.user_role,
    ai_role: conv.ai_role,
    is_ai_conversation: !!conv.is_ai_conversation,
    voice_id: conv.voice_id,
    voice_speed: conv.voice_speed,
    other_user: otherUser,
    last_message: conv.last_content ? {
      id: '', // Not needed for display
      conversation_id: conv.id,
      sender_id: conv.last_sender_id!,
      content: conv.last_content,
      created_at: conv.last_created_at!,
      check_status: null,
      check_feedback: null,
      recording_url: null,
    } : undefined,
  }));
}

/**
 * Create a new conversation
 */
export async function createConversation(
  db: D1Database,
  relationshipId: string,
  userId: string,
  options?: CreateConversationRequest
): Promise<Conversation> {
  // Verify access to relationship
  const rel = await verifyRelationshipAccess(db, relationshipId, userId);

  // Check if this is an AI conversation (with Claude)
  const otherUserId = getOtherUserId(rel, userId);
  const isAiConversation = otherUserId === CLAUDE_AI_USER_ID;

  const id = generateId();
  await db
    .prepare(`
      INSERT INTO conversations (id, relationship_id, title, scenario, user_role, ai_role, is_ai_conversation, voice_id, voice_speed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      relationshipId,
      options?.title || null,
      options?.scenario || null,
      options?.user_role || null,
      options?.ai_role || null,
      isAiConversation ? 1 : 0,
      options?.voice_id || 'female-yujie',
      options?.voice_speed || 0.5
    )
    .run();

  const conversation = await db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .bind(id)
    .first<Conversation>();

  if (!conversation) throw new Error('Failed to create conversation');
  return conversation;
}

/**
 * Get a conversation by ID (with access check)
 */
export async function getConversationById(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<Conversation | null> {
  const conv = await db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .bind(conversationId)
    .first<Conversation>();

  if (!conv) return null;

  // Verify user has access to this conversation's relationship
  try {
    await verifyRelationshipAccess(db, conv.relationship_id, userId);
    return conv;
  } catch {
    return null;
  }
}

// ============ Messages ============

/**
 * Get messages for a conversation (supports polling with 'since' parameter)
 */
export async function getMessages(
  db: D1Database,
  conversationId: string,
  userId: string,
  since?: string
): Promise<{ messages: MessageWithSender[]; latest_timestamp: string | null }> {
  // Verify access
  const conv = await getConversationById(db, conversationId, userId);
  if (!conv) {
    throw new Error('Conversation not found');
  }

  let query = `
    SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
           m.check_status, m.check_feedback, m.recording_url,
           u.id as u_id, u.name as u_name, u.picture_url as u_picture
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.conversation_id = ?
  `;
  const params: string[] = [conversationId];

  if (since) {
    query += ` AND m.created_at > ?`;
    params.push(since);
  }

  query += ` ORDER BY m.created_at ASC`;

  const result = await db.prepare(query).bind(...params).all<{
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    check_status: string | null;
    check_feedback: string | null;
    recording_url: string | null;
    u_id: string;
    u_name: string | null;
    u_picture: string | null;
  }>();

  const messages: MessageWithSender[] = result.results.map(row => ({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    created_at: row.created_at,
    check_status: row.check_status as Message['check_status'],
    check_feedback: row.check_feedback,
    recording_url: row.recording_url,
    sender: {
      id: row.u_id,
      name: row.u_name,
      picture_url: row.u_picture,
    },
  }));

  const latest = messages.length > 0 ? messages[messages.length - 1].created_at : null;

  return { messages, latest_timestamp: latest };
}

/**
 * Send a message
 */
export async function sendMessage(
  db: D1Database,
  conversationId: string,
  userId: string,
  content: string
): Promise<MessageWithSender> {
  // Verify access
  const conv = await getConversationById(db, conversationId, userId);
  if (!conv) {
    throw new Error('Conversation not found');
  }

  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(id, conversationId, userId, content, now)
    .run();

  // Update conversation's last_message_at
  await db
    .prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?')
    .bind(now, conversationId)
    .run();

  // Get sender info
  const sender = await db
    .prepare('SELECT id, name, picture_url FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; name: string | null; picture_url: string | null }>();

  return {
    id,
    conversation_id: conversationId,
    sender_id: userId,
    content,
    created_at: now,
    check_status: null,
    check_feedback: null,
    recording_url: null,
    sender: sender || { id: userId, name: null, picture_url: null },
  };
}

// ============ Shared Decks ============

/**
 * Share a deck from tutor to student
 */
export async function shareDeck(
  db: D1Database,
  relationshipId: string,
  tutorId: string,
  sourceDeckId: string
): Promise<SharedDeckWithDetails> {
  // Verify relationship and that user is the tutor
  const rel = await verifyRelationshipAccess(db, relationshipId, tutorId);
  const myRole = getMyRole(rel, tutorId);

  if (myRole !== 'tutor') {
    throw new Error('Only tutors can share decks');
  }

  // Get the source deck
  const sourceDeck = await db
    .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
    .bind(sourceDeckId, tutorId)
    .first<Deck>();

  if (!sourceDeck) {
    throw new Error('Deck not found');
  }

  const studentId = getOtherUserId(rel, tutorId);

  // Create a copy of the deck for the student
  const targetDeckId = generateId();
  const targetDeckName = `${sourceDeck.name} (from tutor)`;

  await db
    .prepare(`
      INSERT INTO decks (id, user_id, name, description, new_cards_per_day, learning_steps,
        graduating_interval, easy_interval, relearning_steps, starting_ease,
        minimum_ease, maximum_ease, interval_modifier, hard_multiplier, easy_bonus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      targetDeckId,
      studentId,
      targetDeckName,
      sourceDeck.description,
      sourceDeck.new_cards_per_day,
      sourceDeck.learning_steps,
      sourceDeck.graduating_interval,
      sourceDeck.easy_interval,
      sourceDeck.relearning_steps,
      sourceDeck.starting_ease,
      sourceDeck.minimum_ease,
      sourceDeck.maximum_ease,
      sourceDeck.interval_modifier,
      sourceDeck.hard_multiplier,
      sourceDeck.easy_bonus
    )
    .run();

  // Get all notes from source deck
  const notes = await db
    .prepare('SELECT * FROM notes WHERE deck_id = ?')
    .bind(sourceDeckId)
    .all<Note>();

  // Copy notes and create cards
  for (const note of notes.results) {
    const newNoteId = generateId();

    await db
      .prepare(`
        INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url, fun_facts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        newNoteId,
        targetDeckId,
        note.hanzi,
        note.pinyin,
        note.english,
        note.audio_url, // Share the same audio file
        note.fun_facts
      )
      .run();

    // Create cards for each type
    for (const cardType of CARD_TYPES) {
      const cardId = generateId();
      await db
        .prepare('INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)')
        .bind(cardId, newNoteId, cardType)
        .run();
    }
  }

  // Record the share
  const shareId = generateId();
  await db
    .prepare(`
      INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id)
      VALUES (?, ?, ?, ?)
    `)
    .bind(shareId, relationshipId, sourceDeckId, targetDeckId)
    .run();

  return {
    id: shareId,
    relationship_id: relationshipId,
    source_deck_id: sourceDeckId,
    target_deck_id: targetDeckId,
    shared_at: new Date().toISOString(),
    source_deck_name: sourceDeck.name,
    target_deck_name: targetDeckName,
  };
}

/**
 * Get shared decks for a relationship
 */
export async function getSharedDecks(
  db: D1Database,
  relationshipId: string,
  userId: string
): Promise<SharedDeckWithDetails[]> {
  // Verify access
  await verifyRelationshipAccess(db, relationshipId, userId);

  const result = await db
    .prepare(`
      SELECT sd.*,
        source.name as source_deck_name,
        target.name as target_deck_name
      FROM shared_decks sd
      LEFT JOIN decks source ON sd.source_deck_id = source.id
      LEFT JOIN decks target ON sd.target_deck_id = target.id
      WHERE sd.relationship_id = ?
      ORDER BY sd.shared_at DESC
    `)
    .bind(relationshipId)
    .all<SharedDeck & { source_deck_name: string | null; target_deck_name: string | null }>();

  return result.results.map(row => ({
    ...row,
    source_deck_name: row.source_deck_name || '(deleted)',
    target_deck_name: row.target_deck_name || '(deleted)',
  }));
}

// ============ Flashcard Generation from Chat ============

/**
 * Get chat context for AI flashcard generation
 */
export async function getChatContext(
  db: D1Database,
  conversationId: string,
  userId: string,
  messageIds?: string[]
): Promise<string> {
  // Verify access
  const conv = await getConversationById(db, conversationId, userId);
  if (!conv) {
    throw new Error('Conversation not found');
  }

  let query = `
    SELECT m.content, u.name as sender_name
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.conversation_id = ?
  `;
  const params: string[] = [conversationId];

  if (messageIds && messageIds.length > 0) {
    const placeholders = messageIds.map(() => '?').join(',');
    query += ` AND m.id IN (${placeholders})`;
    params.push(...messageIds);
  }

  query += ` ORDER BY m.created_at ASC LIMIT 50`;

  const result = await db.prepare(query).bind(...params).all<{
    content: string;
    sender_name: string | null;
  }>();

  // Format as a conversation transcript
  return result.results
    .map(m => `${m.sender_name || 'Unknown'}: ${m.content}`)
    .join('\n');
}

/**
 * Generate flashcard prompt from chat context
 */
export function buildFlashcardPrompt(chatContext: string): string {
  return `Based on this conversation between a tutor and student about Chinese language learning,
identify ONE vocabulary word or phrase that would be valuable for the student to learn.
Focus on words that were explained, corrected, or discussed.

Conversation:
${chatContext}

Generate a flashcard with:
- hanzi: The Chinese characters
- pinyin: The pronunciation with tone marks (NOT tone numbers)
- english: English translation
- fun_facts: A helpful tip or context about this word (optional)

IMPORTANT: Use tone marks (nǐ hǎo) NOT tone numbers (ni3 hao3).

Respond with ONLY a JSON object in this exact format:
{
  "hanzi": "汉字",
  "pinyin": "hànzì",
  "english": "Chinese characters",
  "fun_facts": "Used to refer to the Chinese writing system"
}`;
}

/**
 * Build prompt for generating response options from chat context
 */
export function buildResponseOptionsPrompt(chatContext: string): string {
  return `You are helping a Chinese language student figure out what to say in a conversation with their tutor.
Based on this conversation, generate 3-5 different response options that the student could say next.

Each response should be:
- In Chinese (with pinyin and English translation)
- Appropriate to the conversation context
- At varying difficulty levels (some simpler, some more advanced)
- Natural and conversational

Conversation:
${chatContext}

Generate response options as flashcards the student can study. Each option should be something the student might want to say in response to the latest message(s).

IMPORTANT: Use tone marks (nǐ hǎo) NOT tone numbers (ni3 hao3).

Respond with ONLY a JSON array in this exact format:
[
  {
    "hanzi": "我明白了",
    "pinyin": "wǒ míngbái le",
    "english": "I understand",
    "fun_facts": "A common way to show comprehension"
  },
  {
    "hanzi": "可以再说一遍吗？",
    "pinyin": "kěyǐ zài shuō yī biàn ma?",
    "english": "Can you say that again?",
    "fun_facts": "Useful when you need something repeated"
  }
]`;
}
