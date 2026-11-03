import Anthropic from '@anthropic-ai/sdk';
import { GeneratedDeck, GeneratedNote, GeneratedNoteWithContext, Conversation, CheckMessageResponse, MessageCheckStatus } from '../types';
import { CARD_STANDARD } from '@shared/cards';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import type { AskLanguage } from '@shared/study/askClaude';
import { OPUS_MODEL, withEffort } from './models';
import { discussTurns, proposedFlashcards, runClaudeTurn, type ChatTurn, type ReadOnlyToolCall, type ToolAction } from './claude-agent';

const SYSTEM_PROMPT = `You are a Chinese language learning expert. Generate vocabulary cards for Mandarin Chinese learners.

For each vocabulary item, provide:
- hanzi: Chinese characters (simplified)
- pinyin: Romanized pronunciation with tone marks/accents (e.g., "nǐ hǎo" for 你好, "māma" for 妈妈)
- english: Clear, concise English translation
- fun_facts: Substantive learning note — explain grammar patterns, cultural context, common mistakes, disambiguation from similar-sounding words, or what makes this word/phrase distinctive. Focus on what helps the learner understand and remember correctly. NOT trivial trivia. (can be empty string)

Important guidelines:
- Use simplified Chinese characters
- Use proper pinyin with tone marks (ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ) - NOT tone numbers
- CRITICAL for pinyin spacing: Put spaces BETWEEN WORDS, not between every syllable. Multi-syllable words should be written as one unit.
  - CORRECT: "wǒ xiǎng mǎi zhège" (我想买这个) - "zhège" is one word
  - CORRECT: "qǐngwèn xǐshǒujiān zài nǎlǐ?" (请问洗手间在哪里?) - compound words stay together
  - WRONG: "wǒ xiǎng mǎi zhè ge" - splits "zhège" incorrectly
  - WRONG: "qǐng wèn xǐ shǒu jiān zài nǎ lǐ" - splits every syllable
- Prefer practical sentences and phrases over single words - things the learner would actually say or hear in real conversations
- In fun_facts, prioritize: grammar explanations, cultural nuance, common errors learners make, and disambiguation — not amusing trivia

${CARD_STANDARD}

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
      "fun_facts": "Grammar explanation, cultural context, common mistakes, or disambiguation note"
    }
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
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
      "fun_facts": "Grammar explanation, cultural context, common mistakes, or disambiguation note"
    }
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
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

  // The 一 / 不 tone changes of the card standard, whatever Claude wrote (shared/pinyin).
  return result.notes.map(n => ({
    ...n,
    pinyin: typeof n.pinyin === 'string' ? applyYiBuToneChanges(n.hanzi ?? '', n.pinyin) : n.pinyin,
  }));
}

// ============ Claude chats: moved into the agent harness ============
//
// Ask Claude on a card, Coach follow-ups and Discuss with Claude run through
// services/claude-agent (`runClaudeTurn`; CLAUDE.md "Claude agent harness"): the prompts in
// claude-agent/persona.ts, the tools in claude-agent/tools/registry.ts, the loop in claude-agent/run.ts.
// What stays here: re-exports for older imports, and thin wrappers with the old signatures for the
// Coach follow-up and Discuss with Claude (production calls `runClaudeTurn` directly).

export {
  FLASHCARD_ITEM_SCHEMA,
  BUMP_CARDS_TOOL,
  executeBumpCardsTool,
  type ToolAction,
  type ReadOnlyToolCall,
  type ToolName,
  type ChatTurn as CoachChatTurn,
} from './claude-agent';
export { BUMP_PROMPT_RULE } from './claude-agent/persona';
export { knownWordsSeed, knownWordsStatement, sampleKnownWords } from './claude-agent/learner';
export { askTurns, loadAskNoteContext, type AskDbContext, type AskNoteContext } from './claude-agent/contexts/card';
export { discussTurns, proposedFlashcards } from './claude-agent/contexts/chat_message';

export interface AskWithToolsResponse {
  answer: string;
  language?: AskLanguage;
  toolActions: ToolAction[];
  readOnlyToolCalls: ReadOnlyToolCall[];
}

/**
 * A Sentence Coach follow-up — a thin wrapper over `runClaudeTurn(env, { kind: 'coach' }, …)`.
 * `history` already includes the analysis context as its first turns.
 */
export async function coachChatWithTools(
  apiKey: string,
  history: ChatTurn[],
  dbContext: { db: D1Database; userId: string },
  opts: { client?: Pick<Anthropic, 'messages'> } = {}
): Promise<AskWithToolsResponse> {
  const r = await runClaudeTurn({ DB: dbContext.db, ANTHROPIC_API_KEY: apiKey }, { kind: 'coach' }, { userId: dbContext.userId, turns: history }, { client: opts.client });
  return { answer: r.answer, toolActions: r.toolActions, readOnlyToolCalls: r.readOnlyToolCalls };
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
 * Generate Claude's opening message for an AI conversation.
 * Used when a conversation is initiated from a study card — Claude starts the conversation
 * using the vocabulary word in a natural context.
 */
export async function generateAIConversationOpener(
  apiKey: string,
  conversation: Conversation,
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
This is a NEW conversation. You are starting it. Send the first message to the student in Chinese.
Your message should naturally use the vocabulary from the scenario to give the student practice.
Keep it short (1-2 sentences) and conversational — invite a response from the student.
Remember: respond ONLY in Chinese characters. No English, no pinyin.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
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
    model: 'claude-haiku-4-5-20251001',
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
      "fun_facts": "Explanation of the grammatical rule or usage pattern behind this correction"
    }
  ]
}

IMPORTANT: Use tone marks (nǐ hǎo) NOT tone numbers (ni3 hao3).
If the message is correct, set corrections to null.

Whenever you write or edit a flashcard (any tool or JSON with hanzi / pinyin / english / fun_facts), follow this:
${CARD_STANDARD}`;

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

  const response = await client.messages.create(withEffort({
    model: OPUS_MODEL,
    // A short JSON verdict + room for the thinking (always on, counted in max_tokens).
    max_tokens: 4000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: CHECK_MESSAGE_SYSTEM_PROMPT,
  }, 'low'));

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

The student will tell you what they're trying to express (in English) and may also provide their best guess in Chinese.

Your response has TWO parts:

1. **Explanation** (required): First, provide a brief teaching explanation. If the student provided a guess, explain what they got right and wrong, and why. If no guess was provided, briefly explain what vocabulary/grammar patterns would be useful for expressing their intended meaning. Keep this concise (2-4 sentences) and encouraging.

2. **Options**: Then generate 3-5 different ways to express their intended meaning in Chinese. Each option should:
   - Help the student express what they're trying to say
   - Vary in difficulty (some simpler, some more advanced)
   - Include the conversation context for reference

Respond with JSON in this exact format:
{
  "explanation": "Your teaching explanation here. Use markdown for emphasis. Include pinyin with tone marks for any Chinese mentioned.",
  "options": [
    {
      "hanzi": "Chinese characters",
      "pinyin": "pinyin with tone marks",
      "english": "English meaning",
      "fun_facts": "Explanation of grammar patterns, cultural context, when/how to use this phrase, or common mistakes to avoid",
      "context": "The conversation context that led to this suggestion"
    }
  ]
}

IMPORTANT: Use tone marks (nǐ hǎo) NOT tone numbers (ni3 hao3).

Whenever you write or edit a flashcard (any tool or JSON with hanzi / pinyin / english / fun_facts), follow this:
${CARD_STANDARD}`;

/**
 * Generate "I don't know" response options with conversation context
 */
export async function generateIDontKnowOptions(
  apiKey: string,
  chatContext: string,
  intendedMeaning?: string,
  guess?: string,
): Promise<{ explanation?: string; options: GeneratedNoteWithContext[] }> {
  const client = new Anthropic({ apiKey });

  let userPrompt = `Conversation so far:
${chatContext}

`;
  if (intendedMeaning) {
    userPrompt += `The student wants to express: "${intendedMeaning}"\n`;
    if (guess) {
      userPrompt += `Their attempt in Chinese: "${guess}"\n`;
    }
    userPrompt += `\nGenerate 3-5 ways to express this in Chinese, with varying difficulty levels. If the student provided a guess, explain in the fun_facts field what they got right/wrong and the grammar rule involved.\nInclude the relevant conversation context with each option.`;
  } else {
    userPrompt += `The student doesn't know what to say next. Generate 3-5 options they could say, with varying difficulty levels.\nInclude the relevant conversation context with each option.`;
  }

  const response = await client.messages.create(withEffort({
    model: OPUS_MODEL,
    // 3–5 options as JSON + the thinking (always on, counted in max_tokens).
    max_tokens: 6000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: I_DONT_KNOW_SYSTEM_PROMPT,
  }, 'low'));

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in AI response');
  }

  const result = JSON.parse(jsonMatch[0]) as { explanation?: string; options: GeneratedNoteWithContext[] };

  if (!result.options || !Array.isArray(result.options)) {
    throw new Error('Invalid options structure from AI');
  }

  return { explanation: result.explanation, options: result.options };
}

// ============ Message Discussion (Discuss with Claude) ============

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

/**
 * Discuss a chat message with Claude — a thin wrapper over `runClaudeTurn(env, { kind: 'chat_message' }, …)`
 * for a message already loaded (the route passes the message id and lets the context check access).
 */
export async function discussMessage(
  apiKey: string,
  messageContent: string,
  question: string,
  chatContext: string,
  conversationHistory: DiscussMessageHistory[] | undefined,
  dbContext: DiscussDbContext,
  opts: { client?: Pick<Anthropic, 'messages'> } = {}
): Promise<DiscussMessageResponse> {
  const r = await runClaudeTurn(
    { DB: dbContext.db, ANTHROPIC_API_KEY: apiKey },
    { kind: 'chat_message', message_id: '', message: { content: messageContent, chat_context: chatContext } },
    { userId: dbContext.userId, turns: discussTurns(question, conversationHistory) },
    { client: opts.client },
  );
  return { response: r.answer, flashcards: proposedFlashcards(r.toolActions) };
}
