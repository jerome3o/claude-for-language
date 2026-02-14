import Anthropic from '@anthropic-ai/sdk';
import { GeneratedDeck, GeneratedNote, GeneratedNoteWithContext, Note, Conversation, CheckMessageResponse, MessageCheckStatus } from '../types';

const SYSTEM_PROMPT = `You are a Chinese language learning expert. Generate vocabulary cards for Mandarin Chinese learners.

For each vocabulary item, provide:
- hanzi: Chinese characters (simplified)
- pinyin: Romanized pronunciation with tone marks/accents (e.g., "nǐ hǎo" for 你好, "māmā" for 妈妈)
- english: Clear, concise English translation
- fun_facts: Optional cultural context, usage notes, memory aids, or interesting tidbits (can be empty string)

Important guidelines:
- Use simplified Chinese characters
- Use proper pinyin with tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ) - NOT tone numbers
- CRITICAL for pinyin spacing: Put spaces BETWEEN WORDS, not between every syllable. Multi-syllable words should be written as one unit.
  - CORRECT: "wǒ xiǎng mǎi zhège" (我想买这个) - "zhège" is one word
  - CORRECT: "qǐngwèn xǐshǒujiān zài nǎlǐ?" (请问洗手间在哪里?) - compound words stay together
  - WRONG: "wǒ xiǎng mǎi zhè ge" - splits "zhège" incorrectly
  - WRONG: "qǐng wèn xǐ shǒu jiān zài nǎ lǐ" - splits every syllable
- Prefer practical sentences and phrases over single words - things the learner would actually say or hear in real conversations
- Keep fun_facts brief but informative

Always respond with valid JSON.`;

/**
 * Generate a complete deck from a user prompt
 */
export async function generateDeck(
  apiKey: string,
  prompt: string,
  deckName?: string
): Promise<GeneratedDeck> {
  const client = new Anthropic({ apiKey });

  const userPrompt = `Generate a vocabulary deck about: "${prompt}"

Create 8-12 items that would be useful for this topic. Focus on:
- **Practical sentences and phrases** the learner would actually say or hear when interacting around this theme
- Include some key vocabulary words, but prioritize useful phrases and questions
- Think about real conversations: What would someone ask? What would they need to say? What might they hear?
- Mix of difficulty levels

For example, for a "restaurant" deck, prefer phrases like:
- "我想点菜" (wǒ xiǎng diǎncài - I'd like to order)
- "请问有什么推荐的？" (qǐngwèn yǒu shénme tuījiàn de? - What do you recommend?)
Rather than just single words like "menu" or "waiter".

Respond with JSON in this exact format:
{
  "deck_name": "${deckName || 'A short, descriptive deck name'}",
  "deck_description": "A brief description of what this deck covers",
  "notes": [
    {
      "hanzi": "Chinese characters",
      "pinyin": "pīnyīn with tone marks",
      "english": "English meaning",
      "fun_facts": "Optional cultural note or memory aid"
    }
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 4000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: SYSTEM_PROMPT,
  });

  // Extract JSON from response
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in AI response');
  }

  const result = JSON.parse(jsonMatch[0]) as GeneratedDeck;

  // Validate the structure
  if (!result.deck_name || !result.notes || !Array.isArray(result.notes)) {
    throw new Error('Invalid deck structure from AI');
  }

  return result;
}

/**
 * Generate card suggestions based on context
 */
export async function suggestCards(
  apiKey: string,
  context: string,
  count: number = 5
): Promise<GeneratedNote[]> {
  const client = new Anthropic({ apiKey });

  const userPrompt = `Based on this context: "${context}"

Suggest ${count} related Chinese items that would complement this.
Focus on practical sentences and phrases the learner might actually use in real conversations around this topic.
Include some key vocabulary, but prioritize useful phrases and questions.

Respond with JSON in this exact format:
{
  "notes": [
    {
      "hanzi": "Chinese characters",
      "pinyin": "pīnyīn with tone marks",
      "english": "English meaning",
      "fun_facts": "Optional cultural note or memory aid"
    }
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 2000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: SYSTEM_PROMPT,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in AI response');
  }

  const result = JSON.parse(jsonMatch[0]) as { notes: GeneratedNote[] };

  if (!result.notes || !Array.isArray(result.notes)) {
    throw new Error('Invalid notes structure from AI');
  }

  return result.notes;
}

const ASK_SYSTEM_PROMPT = `You are a helpful Chinese language tutor. The user is studying a Chinese vocabulary word and has a question about it.

You'll be given context about the card including its deck, mastery level (card status with queue state, interval, stability, and repetition count), and recent review history. Use this to tailor your responses — e.g., if the user keeps rating "Again", offer extra memory aids; if they're at high stability, challenge them with advanced usage.

Be concise but thorough in your answers. Focus on practical usage and learning. You can explain:
- Grammar patterns and sentence structures
- Cultural context and usage notes
- Related vocabulary or phrases
- Common mistakes to avoid
- Memory aids or mnemonics
- Pronunciation tips

Keep your responses focused and helpful for language learning. Use examples with both Chinese characters and pinyin when relevant.

You have tools to help the user. Read-only tools (search_cards, list_conversations, get_deck_info) are executed automatically. Mutating tools require user approval.

Tool usage guidelines:
- The user points out an error in the card (wrong tone, incorrect translation, etc.) → use edit_current_card
- The user asks for related vocabulary to be added → use create_flashcards
- The user says the card is a duplicate or should be removed → use delete_current_card
- Use search_cards to find related vocabulary, check for duplicates, or answer questions about what cards exist
- Use list_conversations to find past discussions about cards
- Use get_deck_info to understand the deck context

When editing, only change the fields that need fixing. When creating cards, use proper pinyin with tone marks (nǐ hǎo), NOT tone numbers.
After using a tool, briefly confirm what you did in your text response.`;

export interface AskContext {
  userAnswer?: string;
  correctAnswer?: string;
  cardType?: string;
}

export interface ConversationMessage {
  question: string;
  answer: string;
}

/**
 * Answer a question about a vocabulary note
 */
export async function askAboutNote(
  apiKey: string,
  note: Note,
  question: string,
  askContext?: AskContext,
  conversationHistory?: ConversationMessage[]
): Promise<string> {
  const client = new Anthropic({ apiKey });

  // Build the vocabulary context that will be included in the first message
  let vocabContextParts = [
    `The user is studying this vocabulary:`,
    `- Chinese: ${note.hanzi}`,
    `- Pinyin: ${note.pinyin}`,
    `- English: ${note.english}`,
  ];

  if (note.fun_facts) {
    vocabContextParts.push(`- Notes: ${note.fun_facts}`);
  }

  // Add user's answer context if provided
  if (askContext?.userAnswer) {
    vocabContextParts.push('');
    vocabContextParts.push(`The user was asked to write the Chinese characters.`);
    vocabContextParts.push(`User's answer: ${askContext.userAnswer}`);
    vocabContextParts.push(`Correct answer: ${askContext.correctAnswer || note.hanzi}`);
  }

  const vocabContext = vocabContextParts.join('\n');

  // Build messages array with conversation history
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];

  if (conversationHistory && conversationHistory.length > 0) {
    // First message includes vocab context
    messages.push({
      role: 'user',
      content: `${vocabContext}\n\nUser's question: ${conversationHistory[0].question}`
    });
    messages.push({
      role: 'assistant',
      content: conversationHistory[0].answer
    });

    // Add remaining conversation history
    for (let i = 1; i < conversationHistory.length; i++) {
      messages.push({
        role: 'user',
        content: conversationHistory[i].question
      });
      messages.push({
        role: 'assistant',
        content: conversationHistory[i].answer
      });
    }

    // Add current question
    messages.push({
      role: 'user',
      content: question
    });
  } else {
    // No history - just include vocab context with the question
    messages.push({
      role: 'user',
      content: `${vocabContext}\n\nUser's question: ${question}`
    });
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages,
    system: ASK_SYSTEM_PROMPT,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  return textContent.text;
}

// Helper: human-readable time ago string
function getTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

// ============ Ask About Note with Tool Use (Agent Loop) ============

// Read-only tools that are executed during the agent loop
const READ_ONLY_TOOLS = new Set([
  'search_cards', 'list_conversations', 'get_deck_info',
  'get_note_cards', 'get_note_history', 'get_deck_progress',
  'get_due_cards', 'get_overall_stats',
]);

function getAskNoteTools(note: Note) {
  return [
    {
      name: 'edit_current_card',
      description: `Edit the current flashcard's note. The current card has: hanzi="${note.hanzi}", pinyin="${note.pinyin}", english="${note.english}", fun_facts="${note.fun_facts || ''}". Only provide the fields you want to change.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          hanzi: { type: 'string', description: 'Updated Chinese characters (simplified)' },
          pinyin: { type: 'string', description: 'Updated pinyin with tone marks (e.g., nǐ hǎo). Use tone marks, NOT tone numbers.' },
          english: { type: 'string', description: 'Updated English translation' },
          fun_facts: { type: 'string', description: 'Updated cultural context, usage notes, or memory aids' },
        },
      },
    },
    {
      name: 'create_flashcards',
      description: 'Create new flashcards in the same deck as the current card. Use this when the user asks for related vocabulary or wants to add new cards.',
      input_schema: {
        type: 'object' as const,
        properties: {
          flashcards: {
            type: 'array',
            description: 'Array of flashcards to create',
            items: {
              type: 'object',
              properties: {
                hanzi: { type: 'string', description: 'Chinese characters (simplified)' },
                pinyin: { type: 'string', description: 'Pinyin with tone marks (e.g., nǐ hǎo). Use tone marks, NOT tone numbers. Spaces between words, not syllables.' },
                english: { type: 'string', description: 'Clear, concise English translation' },
                fun_facts: { type: 'string', description: 'Optional cultural context, usage notes, or memory aids' },
              },
              required: ['hanzi', 'pinyin', 'english'],
            },
          },
        },
        required: ['flashcards'],
      },
    },
    {
      name: 'delete_current_card',
      description: `Delete the current flashcard's note (hanzi="${note.hanzi}"). Use this only when the user explicitly says the card is a duplicate or should be removed.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          reason: { type: 'string', description: 'Brief reason for deletion' },
        },
      },
    },
    {
      name: 'search_cards',
      description: 'Search through all flashcards across all decks. Use this to find related vocabulary, check for duplicates, or answer questions about what cards exist.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query — matches against hanzi, pinyin, and english fields' },
        },
        required: ['query'],
      },
    },
    {
      name: 'list_conversations',
      description: 'List previous Ask Claude conversations for the current note or all notes. Returns question previews with timestamps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          note_id: { type: 'string', description: 'Optional note ID to filter conversations. If omitted, lists recent conversations across all notes.' },
          limit: { type: 'number', description: 'Max number of conversations to return (default 10)' },
        },
      },
    },
    {
      name: 'get_deck_info',
      description: 'Get information about the current deck including name, description, card count, and settings.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_note_cards',
      description: `Get all cards for a specific note with their current SRS state (ease factor, interval, queue, repetitions). Use this to check detailed card scheduling data or compare cards for a note.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          note_id: { type: 'string', description: 'The note ID to get cards for. Use the current note ID or one found via search_cards.' },
        },
        required: ['note_id'],
      },
    },
    {
      name: 'get_note_history',
      description: 'Get review history for a note including all card types, ratings, and timing. Use this to understand how well the user knows a card.',
      input_schema: {
        type: 'object' as const,
        properties: {
          note_id: { type: 'string', description: 'The note ID to get history for.' },
        },
        required: ['note_id'],
      },
    },
    {
      name: 'get_deck_progress',
      description: 'Get detailed study progress for the current deck including per-note card stats, counts of new/learning/review/mastered cards.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_due_cards',
      description: 'Get cards that are currently due for review in the current deck or across all decks.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number', description: 'Maximum number of cards to return (default 20)' },
        },
      },
    },
    {
      name: 'get_overall_stats',
      description: 'Get overall study statistics: total decks, total cards, cards due today, cards studied today.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ];
}

export type ToolName = 'edit_current_card' | 'create_flashcards' | 'delete_current_card' | 'search_cards' | 'list_conversations' | 'get_deck_info' | 'get_note_cards' | 'get_note_history' | 'get_deck_progress' | 'get_due_cards' | 'get_overall_stats';

export interface ToolAction {
  tool: ToolName;
  input: Record<string, unknown>;
}

export interface ReadOnlyToolCall {
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface AskWithToolsResponse {
  answer: string;
  toolActions: ToolAction[];
  readOnlyToolCalls: ReadOnlyToolCall[];
}

export interface AskDbContext {
  db: D1Database;
  userId: string;
  deckId: string;
}

/**
 * Answer a question about a vocabulary note with tool use (agent loop)
 */
export async function askAboutNoteWithTools(
  apiKey: string,
  note: Note,
  question: string,
  askContext?: AskContext,
  conversationHistory?: ConversationMessage[],
  dbContext?: AskDbContext
): Promise<AskWithToolsResponse> {
  const client = new Anthropic({ apiKey });
  const tools = getAskNoteTools(note);

  // Build vocab context
  let vocabContextParts = [
    `The user is studying this vocabulary:`,
    `- Chinese: ${note.hanzi}`,
    `- Pinyin: ${note.pinyin}`,
    `- English: ${note.english}`,
  ];

  if (note.fun_facts) {
    vocabContextParts.push(`- Notes: ${note.fun_facts}`);
  }

  // Add enhanced context from DB if available
  if (dbContext) {
    try {
      // Fetch deck info
      const deck = await dbContext.db.prepare(
        `SELECT name, description FROM decks WHERE id = ? AND user_id = ?`
      ).bind(dbContext.deckId, dbContext.userId).first<{ name: string; description: string | null }>();

      if (deck) {
        vocabContextParts.push(`- Deck: ${deck.name}${deck.description ? ` — ${deck.description}` : ''}`);
      }

      // Fetch card mastery info (aggregate across all card types for this note)
      const cards = await dbContext.db.prepare(`
        SELECT card_type, queue, ease_factor, interval, repetitions, stability
        FROM cards WHERE note_id = ? AND deck_id = ?
      `).bind(note.id, dbContext.deckId).all<{
        card_type: string; queue: number; ease_factor: number;
        interval: number; repetitions: number; stability: number | null;
      }>();

      if (cards.results && cards.results.length > 0) {
        const queueNames: Record<number, string> = { 0: 'new', 1: 'learning', 2: 'review', 3: 'relearning' };
        const cardSummaries = cards.results.map(c => {
          const q = queueNames[c.queue] || 'unknown';
          const parts = [`${c.card_type}: ${q}`];
          if (c.queue === 2) { // REVIEW
            parts.push(`interval ${c.interval}d`);
            if (c.stability) parts.push(`stability ${Math.round(c.stability)}d`);
          }
          if (c.repetitions > 0) parts.push(`${c.repetitions} reps`);
          return parts.join(', ');
        });
        vocabContextParts.push(`- Card status: ${cardSummaries.join(' | ')}`);
      }

      // Fetch recent review events (last 5)
      const reviews = await dbContext.db.prepare(`
        SELECT re.rating, re.reviewed_at, c.card_type
        FROM review_events re
        JOIN cards c ON re.card_id = c.id
        WHERE c.note_id = ? AND c.deck_id = ?
        ORDER BY re.reviewed_at DESC
        LIMIT 5
      `).bind(note.id, dbContext.deckId).all<{
        rating: number; reviewed_at: string; card_type: string;
      }>();

      if (reviews.results && reviews.results.length > 0) {
        const ratingNames: Record<number, string> = { 0: 'Again', 1: 'Hard', 2: 'Good', 3: 'Easy' };
        const reviewSummary = reviews.results.map(r => {
          const ago = getTimeAgo(r.reviewed_at);
          return `${ratingNames[r.rating] || r.rating} on ${r.card_type} (${ago})`;
        }).join(', ');
        vocabContextParts.push(`- Recent reviews: ${reviewSummary}`);
      }
    } catch (err) {
      console.error('[askAboutNoteWithTools] Failed to fetch enhanced context:', err);
    }
  }

  if (askContext?.userAnswer) {
    vocabContextParts.push('');
    vocabContextParts.push(`The user was asked to write the Chinese characters.`);
    vocabContextParts.push(`User's answer: ${askContext.userAnswer}`);
    vocabContextParts.push(`Correct answer: ${askContext.correctAnswer || note.hanzi}`);
  }

  const vocabContext = vocabContextParts.join('\n');

  // Build messages array
  const messages: Anthropic.MessageParam[] = [];

  if (conversationHistory && conversationHistory.length > 0) {
    messages.push({
      role: 'user',
      content: `${vocabContext}\n\nUser's question: ${conversationHistory[0].question}`
    });
    messages.push({
      role: 'assistant',
      content: conversationHistory[0].answer
    });

    for (let i = 1; i < conversationHistory.length; i++) {
      messages.push({
        role: 'user',
        content: conversationHistory[i].question
      });
      messages.push({
        role: 'assistant',
        content: conversationHistory[i].answer
      });
    }

    messages.push({
      role: 'user',
      content: question
    });
  } else {
    messages.push({
      role: 'user',
      content: `${vocabContext}\n\nUser's question: ${question}`
    });
  }

  // Agent loop: keep calling Claude until it stops using tools
  const collectedToolActions: ToolAction[] = [];
  const collectedReadOnlyToolCalls: ReadOnlyToolCall[] = [];
  const textParts: string[] = [];
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages,
      system: ASK_SYSTEM_PROMPT,
      tools: tools as Anthropic.Tool[],
    });

    // Process response content
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
        // Only collect mutating tool actions for deferred execution
        if (!READ_ONLY_TOOLS.has(block.name)) {
          collectedToolActions.push({
            tool: block.name as ToolAction['tool'],
            input: block.input as Record<string, unknown>,
          });
        }
      }
    }

    // If no tool use, we're done
    if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      break;
    }

    // Add assistant response to messages
    messages.push({ role: 'assistant', content: response.content });

    // Execute read-only tools and return real results; defer mutating tools
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (READ_ONLY_TOOLS.has(block.name) && dbContext) {
        const result = await executeReadOnlyTool(block.name, block.input as Record<string, unknown>, dbContext, note);
        collectedReadOnlyToolCalls.push({
          tool: block.name,
          input: block.input as Record<string, unknown>,
          result,
        });
        toolResults.push({
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } else {
        toolResults.push({
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify({ success: true, message: `Tool ${block.name} will be executed after user approval` }),
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return {
    answer: textParts.join('\n'),
    toolActions: collectedToolActions,
    readOnlyToolCalls: collectedReadOnlyToolCalls,
  };
}

/**
 * Execute a read-only tool and return the result
 */
async function executeReadOnlyTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: AskDbContext,
  currentNote: Note
): Promise<Record<string, unknown>> {
  try {
    switch (toolName) {
      case 'search_cards': {
        const query = (input.query as string || '').toLowerCase();
        // Search across user's notes
        const results = await ctx.db.prepare(`
          SELECT n.id, n.hanzi, n.pinyin, n.english, d.name as deck_name
          FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ?
          AND (LOWER(n.hanzi) LIKE ? OR LOWER(n.pinyin) LIKE ? OR LOWER(n.english) LIKE ?)
          LIMIT 20
        `).bind(ctx.userId, `%${query}%`, `%${query}%`, `%${query}%`).all();
        return { results: results.results || [], count: (results.results || []).length };
      }

      case 'list_conversations': {
        const noteId = input.note_id as string | undefined;
        const limit = Math.min((input.limit as number) || 10, 20);
        let results;
        if (noteId) {
          results = await ctx.db.prepare(`
            SELECT nq.id, nq.note_id, nq.question, nq.answer, nq.asked_at, n.hanzi, n.pinyin
            FROM note_questions nq
            JOIN notes n ON nq.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE nq.note_id = ? AND d.user_id = ?
            ORDER BY nq.asked_at DESC
            LIMIT ?
          `).bind(noteId, ctx.userId, limit).all();
        } else {
          results = await ctx.db.prepare(`
            SELECT nq.id, nq.note_id, nq.question, nq.answer, nq.asked_at, n.hanzi, n.pinyin
            FROM note_questions nq
            JOIN notes n ON nq.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ?
            ORDER BY nq.asked_at DESC
            LIMIT ?
          `).bind(ctx.userId, limit).all();
        }
        // Truncate answers for the listing
        const conversations = (results.results || []).map((r: Record<string, unknown>) => ({
          id: r.id,
          note_id: r.note_id,
          hanzi: r.hanzi,
          pinyin: r.pinyin,
          question: r.question,
          answer_preview: (r.answer as string || '').substring(0, 200),
          asked_at: r.asked_at,
        }));
        return { conversations, count: conversations.length };
      }

      case 'get_deck_info': {
        const deck = await ctx.db.prepare(`
          SELECT d.id, d.name, d.description, d.new_cards_per_day, d.created_at,
            (SELECT COUNT(*) FROM notes WHERE deck_id = d.id) as note_count,
            (SELECT COUNT(*) FROM cards WHERE deck_id = d.id) as card_count
          FROM decks d
          WHERE d.id = ? AND d.user_id = ?
        `).bind(ctx.deckId, ctx.userId).first();
        return deck ? { deck } : { error: 'Deck not found' };
      }

      case 'get_note_cards': {
        const noteId = input.note_id as string;
        const note = await ctx.db.prepare(`
          SELECT n.hanzi, n.pinyin, n.english FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE n.id = ? AND d.user_id = ?
        `).bind(noteId, ctx.userId).first<{ hanzi: string; pinyin: string; english: string }>();
        if (!note) return { error: 'Note not found' };

        const cards = await ctx.db.prepare(`
          SELECT id, card_type, ease_factor, interval, repetitions, queue, next_review_at
          FROM cards WHERE note_id = ?
        `).bind(noteId).all();

        const queueNames: Record<number, string> = { 0: 'new', 1: 'learning', 2: 'review', 3: 'relearning' };
        const cardsWithLabels = (cards.results || []).map((c: Record<string, unknown>) => ({
          ...c,
          queue_name: queueNames[c.queue as number] || 'unknown',
        }));
        return { note: { hanzi: note.hanzi, pinyin: note.pinyin, english: note.english }, cards: cardsWithLabels };
      }

      case 'get_note_history': {
        const noteId = input.note_id as string;
        const noteCheck = await ctx.db.prepare(`
          SELECT n.hanzi, n.pinyin, n.english FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE n.id = ? AND d.user_id = ?
        `).bind(noteId, ctx.userId).first<{ hanzi: string; pinyin: string; english: string }>();
        if (!noteCheck) return { error: 'Note not found' };

        const reviews = await ctx.db.prepare(`
          SELECT re.rating, re.time_spent_ms, re.user_answer, re.reviewed_at, c.card_type
          FROM review_events re
          JOIN cards c ON re.card_id = c.id
          WHERE c.note_id = ?
          ORDER BY re.reviewed_at DESC
          LIMIT 30
        `).bind(noteId).all<{
          rating: number; time_spent_ms: number | null; user_answer: string | null;
          reviewed_at: string; card_type: string;
        }>();

        const ratingLabels = ['Again', 'Hard', 'Good', 'Easy'];
        const byCardType: Record<string, unknown[]> = {};
        for (const review of reviews.results) {
          if (!byCardType[review.card_type]) byCardType[review.card_type] = [];
          byCardType[review.card_type].push({
            reviewed_at: review.reviewed_at,
            rating: ratingLabels[review.rating] || review.rating,
            time_spent_ms: review.time_spent_ms,
            user_answer: review.user_answer,
          });
        }
        return {
          note: { hanzi: noteCheck.hanzi, pinyin: noteCheck.pinyin, english: noteCheck.english },
          total_reviews: reviews.results.length,
          history_by_card_type: byCardType,
        };
      }

      case 'get_deck_progress': {
        const cards = await ctx.db.prepare(`
          SELECT c.interval, c.next_review_at, c.card_type, c.ease_factor, c.repetitions,
                 n.hanzi, n.pinyin, n.english, n.id as note_id
          FROM cards c
          JOIN notes n ON c.note_id = n.id
          WHERE n.deck_id = ? AND n.deck_id IN (SELECT id FROM decks WHERE user_id = ?)
          ORDER BY n.hanzi
        `).bind(ctx.deckId, ctx.userId).all();

        const results = cards.results || [];
        const stats = {
          total_cards: results.length,
          new_cards: results.filter((c: Record<string, unknown>) => c.next_review_at === null).length,
          learning: results.filter((c: Record<string, unknown>) => c.next_review_at !== null && (c.interval as number) <= 1).length,
          reviewing: results.filter((c: Record<string, unknown>) => (c.interval as number) > 1 && (c.interval as number) <= 21).length,
          mastered: results.filter((c: Record<string, unknown>) => (c.interval as number) > 21).length,
          due_now: results.filter((c: Record<string, unknown>) =>
            c.next_review_at === null || new Date(c.next_review_at as string) <= new Date()
          ).length,
        };
        return { stats };
      }

      case 'get_due_cards': {
        const limit = Math.min((input.limit as number) || 20, 30);
        const result = await ctx.db.prepare(`
          SELECT c.card_type, c.ease_factor, c.interval, c.repetitions, c.next_review_at,
                 n.hanzi, n.pinyin, n.english, n.id as note_id
          FROM cards c
          JOIN notes n ON c.note_id = n.id
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ? AND n.deck_id = ?
            AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
          ORDER BY c.next_review_at ASC NULLS LAST
          LIMIT ?
        `).bind(ctx.userId, ctx.deckId, limit).all();
        return { count: (result.results || []).length, cards: result.results || [] };
      }

      case 'get_overall_stats': {
        const [totalCards, cardsDue, studiedToday, totalDecks] = await Promise.all([
          ctx.db.prepare(`
            SELECT COUNT(*) as count FROM cards c
            JOIN notes n ON c.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ?
          `).bind(ctx.userId).first<{ count: number }>(),
          ctx.db.prepare(`
            SELECT COUNT(*) as count FROM cards c
            JOIN notes n ON c.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
          `).bind(ctx.userId).first<{ count: number }>(),
          ctx.db.prepare(`
            SELECT COUNT(*) as count FROM review_events
            WHERE user_id = ? AND date(reviewed_at) = date('now')
          `).bind(ctx.userId).first<{ count: number }>(),
          ctx.db.prepare('SELECT COUNT(*) as count FROM decks WHERE user_id = ?')
            .bind(ctx.userId).first<{ count: number }>(),
        ]);
        return {
          total_decks: totalDecks?.count || 0,
          total_cards: totalCards?.count || 0,
          cards_due_today: cardsDue?.count || 0,
          cards_studied_today: studiedToday?.count || 0,
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`Read-only tool ${toolName} error:`, error);
    return { error: `Failed to execute ${toolName}` };
  }
}

// ============ AI Conversation Functions ============

const AI_CONVERSATION_SYSTEM_PROMPT = `You are a Chinese language conversation partner helping a student practice Chinese.

CRITICAL RULES:
1. ALWAYS respond ONLY in Chinese characters (汉字). Never use English or pinyin in your responses.
2. Keep responses conversational and natural - this is a practice conversation, not a lesson.
3. Stay in character based on the scenario and your assigned role.
4. Adjust your language complexity based on how the student is responding.
5. Ask follow-up questions to keep the conversation flowing.
6. Be encouraging but stay in character.

Remember: Your response should be 100% Chinese characters. No English, no pinyin, no parenthetical translations.`;

/**
 * Generate Claude's response in an AI conversation
 */
export async function generateAIConversationResponse(
  apiKey: string,
  conversation: Conversation,
  chatHistory: string,
  latestUserMessage: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  let scenarioContext = '';
  if (conversation.scenario) {
    scenarioContext = `Scenario: ${conversation.scenario}\n`;
  }
  if (conversation.ai_role) {
    scenarioContext += `Your role: ${conversation.ai_role}\n`;
  }
  if (conversation.user_role) {
    scenarioContext += `The student's role: ${conversation.user_role}\n`;
  }

  const userPrompt = `${scenarioContext}
Conversation history:
${chatHistory}

The student just said: "${latestUserMessage}"

Respond naturally in Chinese, staying in character. Remember: respond ONLY in Chinese characters.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: AI_CONVERSATION_SYSTEM_PROMPT,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  return textContent.text;
}

const CHECK_MESSAGE_SYSTEM_PROMPT = `You are a Chinese language teacher evaluating a student's message.

Your task:
1. Determine if the student's Chinese message is grammatically correct and natural.
2. If there are issues, explain them briefly and suggest corrections.
3. Generate flashcard suggestions for any corrections.

Respond with JSON in this exact format:
{
  "status": "correct" or "needs_improvement",
  "feedback": "Brief feedback in English explaining any issues or confirming correctness",
  "corrections": [  // Only include if status is "needs_improvement"
    {
      "hanzi": "Corrected Chinese",
      "pinyin": "pinyin with tone marks",
      "english": "English meaning",
      "fun_facts": "Brief explanation of the correction"
    }
  ]
}

IMPORTANT: Use tone marks (nǐ hǎo) NOT tone numbers (ni3 hao3).
If the message is correct, set corrections to null.`;

/**
 * Check if a user's Chinese message is correct
 */
export async function checkUserMessage(
  apiKey: string,
  userMessage: string,
  chatContext: string
): Promise<CheckMessageResponse> {
  const client = new Anthropic({ apiKey });

  const userPrompt = `Conversation context:
${chatContext}

The student wrote: "${userMessage}"

Evaluate this message. Is it grammatically correct and natural Chinese for this conversation context?`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: CHECK_MESSAGE_SYSTEM_PROMPT,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in AI response');
  }

  const result = JSON.parse(jsonMatch[0]) as CheckMessageResponse;
  return result;
}

const I_DONT_KNOW_SYSTEM_PROMPT = `You are a Chinese language teacher helping a student who doesn't know what to say next in a conversation.

Based on the conversation context, generate 3-5 different options for what the student could say next.
Each option should:
1. Be appropriate for the conversation
2. Vary in difficulty (some simpler, some more advanced)
3. Include the conversation context for reference

Respond with JSON in this exact format:
{
  "options": [
    {
      "hanzi": "Chinese characters",
      "pinyin": "pinyin with tone marks",
      "english": "English meaning",
      "fun_facts": "Brief note about when to use this phrase",
      "context": "The conversation context that led to this suggestion"
    }
  ]
}

IMPORTANT: Use tone marks (nǐ hǎo) NOT tone numbers (ni3 hao3).`;

/**
 * Generate "I don't know" response options with conversation context
 */
export async function generateIDontKnowOptions(
  apiKey: string,
  chatContext: string
): Promise<GeneratedNoteWithContext[]> {
  const client = new Anthropic({ apiKey });

  const userPrompt = `Conversation so far:
${chatContext}

The student doesn't know what to say next. Generate 3-5 options they could say, with varying difficulty levels.
Include the relevant conversation context with each option.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: I_DONT_KNOW_SYSTEM_PROMPT,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in AI response');
  }

  const result = JSON.parse(jsonMatch[0]) as { options: GeneratedNoteWithContext[] };

  if (!result.options || !Array.isArray(result.options)) {
    throw new Error('Invalid options structure from AI');
  }

  return result.options;
}

// ============ Message Discussion with Flashcard Tool ============

const DISCUSS_MESSAGE_SYSTEM_PROMPT = `You are a helpful Chinese language tutor. The user is looking at a specific message from a conversation and wants to discuss it with you.

Help the user understand the message. You can:
- Explain vocabulary, grammar patterns, and sentence structures
- Provide cultural context and usage notes
- Give related vocabulary or phrases
- Explain pronunciation tips
- Create flashcards when the user asks or when it would be helpful
- Search the user's existing flashcards to find related vocabulary or check for duplicates

You have tools available. Read-only tools (search_cards, list_student_decks) execute automatically. The create_flashcards tool suggests cards for user approval.

Use examples with both Chinese characters and pinyin (with tone marks) when relevant.
Keep your responses concise and focused on language learning.

When you identify vocabulary or phrases worth learning, proactively suggest creating flashcards. Before creating flashcards, consider using search_cards to check if similar cards already exist. Use the create_flashcards tool to create them.`;

const CREATE_FLASHCARDS_TOOL = {
  name: 'create_flashcards',
  description: 'Create flashcards for Chinese vocabulary or phrases that the user should learn. Use this when the user asks to create flashcards, or when you identify vocabulary worth learning from the discussion. Each flashcard should have Chinese characters, pinyin with tone marks, English translation, and optional notes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      flashcards: {
        type: 'array',
        description: 'Array of flashcards to create',
        items: {
          type: 'object',
          properties: {
            hanzi: { type: 'string', description: 'Chinese characters (simplified)' },
            pinyin: { type: 'string', description: 'Pinyin with tone marks (e.g., nǐ hǎo). Use proper tone marks, NOT tone numbers. Put spaces between words, not syllables.' },
            english: { type: 'string', description: 'Clear, concise English translation' },
            fun_facts: { type: 'string', description: 'Optional cultural context, usage notes, memory aids, or grammar tips' },
          },
          required: ['hanzi', 'pinyin', 'english'],
        },
      },
    },
    required: ['flashcards'],
  },
};

export interface DiscussMessageHistory {
  role: 'user' | 'assistant';
  content: string;
}

export interface DiscussMessageResponse {
  response: string;
  flashcards: GeneratedNote[] | null;
}

export interface DiscussDbContext {
  db: D1Database;
  userId: string;
}

const DISCUSS_READ_ONLY_TOOLS = new Set(['search_cards', 'list_student_decks']);

const DISCUSS_SEARCH_CARDS_TOOL = {
  name: 'search_cards',
  description: 'Search through the user\'s existing flashcards across all decks. Use this to find related vocabulary, check for duplicates before creating flashcards, or answer questions about what cards the user already has.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query — matches against hanzi, pinyin, and english fields' },
    },
    required: ['query'],
  },
};

const DISCUSS_LIST_DECKS_TOOL = {
  name: 'list_student_decks',
  description: 'List the user\'s flashcard decks with card counts. Use this to understand what the user is studying.',
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

/**
 * Discuss a chat message with Claude, with flashcard creation + read-only tools (agent loop)
 */
export async function discussMessage(
  apiKey: string,
  messageContent: string,
  question: string,
  chatContext: string,
  conversationHistory?: DiscussMessageHistory[],
  dbContext?: DiscussDbContext
): Promise<DiscussMessageResponse> {
  const client = new Anthropic({ apiKey });

  const tools = [CREATE_FLASHCARDS_TOOL, DISCUSS_SEARCH_CARDS_TOOL, DISCUSS_LIST_DECKS_TOOL];

  const contextPreamble = `The user is looking at this message from a conversation:\n\n"${messageContent}"\n\nConversation context:\n${chatContext}\n\n`;

  // Build messages array
  const messages: Anthropic.MessageParam[] = [];

  if (conversationHistory && conversationHistory.length > 0) {
    // First message includes context
    messages.push({
      role: 'user',
      content: `${contextPreamble}User's question: ${conversationHistory[0].content}`
    });

    // Add remaining history
    for (let i = 1; i < conversationHistory.length; i++) {
      messages.push({
        role: conversationHistory[i].role,
        content: conversationHistory[i].content,
      });
    }

    // Add current question
    messages.push({
      role: 'user',
      content: question,
    });
  } else {
    messages.push({
      role: 'user',
      content: `${contextPreamble}User's question: ${question}`
    });
  }

  // Agent loop: keep calling Claude until it stops using tools
  let flashcards: GeneratedNote[] | null = null;
  const textParts: string[] = [];
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages,
      system: DISCUSS_MESSAGE_SYSTEM_PROMPT,
      tools: tools as Anthropic.Tool[],
    });

    // Process response content
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
        // Collect flashcards from create_flashcards tool
        if (block.name === 'create_flashcards') {
          const input = block.input as { flashcards: GeneratedNote[] };
          if (input.flashcards && Array.isArray(input.flashcards)) {
            flashcards = input.flashcards;
          }
        }
      }
    }

    // If no tool use, we're done
    if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      break;
    }

    // Add assistant response to messages
    messages.push({ role: 'assistant', content: response.content });

    // Execute read-only tools and return real results; acknowledge mutating tools
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (DISCUSS_READ_ONLY_TOOLS.has(block.name) && dbContext) {
        const result = await executeDiscussReadOnlyTool(block.name, block.input as Record<string, unknown>, dbContext);
        toolResults.push({
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } else {
        toolResults.push({
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify({ success: true, message: 'Flashcards will be shown to the user for review' }),
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return {
    response: textParts.join('\n'),
    flashcards,
  };
}

/**
 * Execute a read-only tool for discuss message and return the result
 */
async function executeDiscussReadOnlyTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: DiscussDbContext
): Promise<Record<string, unknown>> {
  try {
    switch (toolName) {
      case 'search_cards': {
        const query = (input.query as string || '').toLowerCase();
        const results = await ctx.db.prepare(`
          SELECT n.id, n.hanzi, n.pinyin, n.english, d.name as deck_name
          FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ?
          AND (LOWER(n.hanzi) LIKE ? OR LOWER(n.pinyin) LIKE ? OR LOWER(n.english) LIKE ?)
          LIMIT 20
        `).bind(ctx.userId, `%${query}%`, `%${query}%`, `%${query}%`).all();
        return { results: results.results || [], count: (results.results || []).length };
      }

      case 'list_student_decks': {
        const decks = await ctx.db.prepare(`
          SELECT d.id, d.name, d.description,
            (SELECT COUNT(*) FROM notes WHERE deck_id = d.id) as note_count
          FROM decks d
          WHERE d.user_id = ?
          ORDER BY d.name
        `).bind(ctx.userId).all();
        return { decks: decks.results || [], count: (decks.results || []).length };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`Discuss read-only tool ${toolName} error:`, error);
    return { error: `Failed to execute ${toolName}` };
  }
}
