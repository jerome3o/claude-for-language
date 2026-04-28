import Anthropic from '@anthropic-ai/sdk';
import { generateAIConversationOpener, generateAIConversationResponse } from './ai';
import type { Situation } from './situations';

const MODEL = 'claude-opus-4-6';

export interface RoleplayMessage {
  id: string;
  role: 'ai' | 'user';
  hanzi: string;
  pinyin: string | null;
  english: string | null;
  revealed: boolean;
}

const ANNOTATE_TOOL: Anthropic.Tool = {
  name: 'annotate',
  description: 'Provide pinyin and an English translation for a Chinese sentence.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pinyin: { type: 'string', description: 'Tone-mark pinyin for the whole sentence.' },
      english: { type: 'string', description: 'Natural English translation.' },
    },
    required: ['pinyin', 'english'],
  },
};

async function annotate(
  apiKey: string,
  hanzi: string,
): Promise<{ pinyin: string; english: string }> {
  const client = new Anthropic({ apiKey });
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    tools: [ANNOTATE_TOOL],
    tool_choice: { type: 'tool', name: 'annotate' },
    messages: [{ role: 'user', content: `Annotate this Chinese: ${hanzi}` }],
  });
  const tu = r.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!tu) throw new Error('annotate: no tool_use');
  return tu.input as { pinyin: string; english: string };
}

function asConversation(sit: Situation) {
  return {
    scenario: `${sit.scenario} The conversation should stay simple (A2 level) and move toward this goal: ${sit.goal}`,
    ai_role: sit.ai_role,
    user_role: sit.user_role,
  };
}

export async function openRoleplay(
  apiKey: string,
  sit: Situation,
): Promise<{ hanzi: string; pinyin: string; english: string }> {
  const hanzi = await generateAIConversationOpener(apiKey, asConversation(sit) as any);
  const ann = await annotate(apiKey, hanzi);
  return { hanzi, ...ann };
}

export async function replyRoleplay(
  apiKey: string,
  sit: Situation,
  history: RoleplayMessage[],
  userMessage: string,
): Promise<{ hanzi: string; pinyin: string; english: string }> {
  const transcript = history
    .map((m) => `${m.role === 'ai' ? sit.ai_role : sit.user_role}: ${m.hanzi}`)
    .join('\n');
  const hanzi = await generateAIConversationResponse(
    apiKey,
    asConversation(sit) as any,
    transcript,
    userMessage,
  );
  const ann = await annotate(apiKey, hanzi);
  return { hanzi, ...ann };
}
