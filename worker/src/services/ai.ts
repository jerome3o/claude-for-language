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

Be concise but thorough in your answers. Focus on practical usage and learning. You can explain:
- Grammar patterns and sentence structures
- Cultural context and usage notes
- Related vocabulary or phrases
- Common mistakes to avoid
- Memory aids or mnemonics
- Pronunciation tips

Keep your responses focused and helpful for language learning. Use examples with both Chinese characters and pinyin when relevant.`;

export interface AskContext {
  userAnswer?: string;
  correctAnswer?: string;
  cardType?: string;
}

/**
 * Answer a question about a vocabulary note
 */
export async function askAboutNote(
  apiKey: string,
  note: Note,
  question: string,
  askContext?: AskContext
): Promise<string> {
  const client = new Anthropic({ apiKey });

  let contextParts = [
    `The user is studying this vocabulary:`,
    `- Chinese: ${note.hanzi}`,
    `- Pinyin: ${note.pinyin}`,
    `- English: ${note.english}`,
  ];

  if (note.fun_facts) {
    contextParts.push(`- Notes: ${note.fun_facts}`);
  }

  // Add user's answer context if provided
  if (askContext?.userAnswer) {
    contextParts.push('');
    contextParts.push(`The user was asked to write the Chinese characters.`);
    contextParts.push(`User's answer: ${askContext.userAnswer}`);
    contextParts.push(`Correct answer: ${askContext.correctAnswer || note.hanzi}`);
  }

  contextParts.push('');
  contextParts.push(`User's question: ${question}`);

  const context = contextParts.join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      { role: 'user', content: context }
    ],
    system: ASK_SYSTEM_PROMPT,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  return textContent.text;
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
