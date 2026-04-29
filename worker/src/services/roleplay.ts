import { generateAIConversationOpener, generateAIConversationResponse } from './ai';
import { analyzeSentence } from './sentence';
import type { Situation } from './situations';

export interface RoleplayChunk {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface RoleplayMessage {
  id: string;
  role: 'ai' | 'user';
  hanzi: string;
  pinyin: string | null;
  english: string | null;
  chunks: RoleplayChunk[] | null;
  image_url: string | null;
  revealed: boolean;
}

export interface AnnotatedReply {
  hanzi: string;
  pinyin: string;
  english: string;
  chunks: RoleplayChunk[];
}

async function annotate(apiKey: string, hanzi: string): Promise<AnnotatedReply> {
  const breakdown = await analyzeSentence(apiKey, hanzi);
  return {
    hanzi,
    pinyin: breakdown.pinyin,
    english: breakdown.english,
    chunks: breakdown.chunks.map((c) => ({
      hanzi: c.hanzi,
      pinyin: c.pinyin,
      english: c.english,
    })),
  };
}

export function buildCharacterPrompt(sit: Situation): string {
  return `Digital illustration, warm friendly style, soft lighting. A ${sit.ai_role}, Chinese, in the setting: ${sit.scenario} Same character appearance in every frame — consistent face, hair, clothing.`;
}

export function buildImagePrompt(characterPrompt: string, english: string): string {
  return `${characterPrompt} In this frame they are mid-conversation, expression matching what they are saying: "${english}". Waist-up shot, looking toward the viewer.`;
}

function asConversation(sit: Situation, lessonNotes?: string) {
  const bias = lessonNotes
    ? ` Where natural, weave in vocabulary the learner's tutor recently covered:\n${lessonNotes}`
    : '';
  return {
    scenario: `${sit.scenario} The conversation should stay simple (A2 level) and move toward this goal: ${sit.goal}.${bias}`,
    ai_role: sit.ai_role,
    user_role: sit.user_role,
  };
}

export async function openRoleplay(
  apiKey: string,
  sit: Situation,
  lessonNotes?: string,
): Promise<AnnotatedReply> {
  const hanzi = await generateAIConversationOpener(apiKey, asConversation(sit, lessonNotes) as any);
  return annotate(apiKey, hanzi);
}

export async function replyRoleplay(
  apiKey: string,
  sit: Situation,
  history: RoleplayMessage[],
  userMessage: string,
): Promise<AnnotatedReply> {
  const transcript = history
    .map((m) => `${m.role === 'ai' ? sit.ai_role : sit.user_role}: ${m.hanzi}`)
    .join('\n');
  const hanzi = await generateAIConversationResponse(
    apiKey,
    asConversation(sit) as any,
    transcript,
    userMessage,
  );
  return annotate(apiKey, hanzi);
}
