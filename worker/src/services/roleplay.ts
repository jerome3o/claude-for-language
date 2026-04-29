import Anthropic from '@anthropic-ai/sdk';
import { generateAIConversationOpener, generateAIConversationResponse } from './ai';
import { analyzeSentence } from './sentence';
import type { Situation } from './situations';

const ROLEPLAY_VOICES = [
  { id: 'Chinese (Mandarin)_Gentleman', label: 'male, formal, middle-aged' },
  { id: 'Chinese (Mandarin)_Southern_Young_Man', label: 'male, young, casual' },
  { id: 'Chinese (Mandarin)_Gentle_Youth', label: 'male, young, soft-spoken' },
  { id: 'Chinese (Mandarin)_Sincere_Adult', label: 'male, adult, sincere' },
  { id: 'Chinese (Mandarin)_Humorous_Elder', label: 'male, elderly, warm' },
  { id: 'Chinese (Mandarin)_Mature_Woman', label: 'female, adult, professional' },
  { id: 'Chinese (Mandarin)_Sweet_Lady', label: 'female, young adult, friendly' },
  { id: 'Chinese (Mandarin)_Wise_Women', label: 'female, mature, calm' },
  { id: 'Chinese (Mandarin)_Warm_Bestie', label: 'female, young, casual' },
  { id: 'Chinese (Mandarin)_Kind-hearted_Antie', label: 'female, older, motherly' },
];

export interface Persona {
  name: string;
  voice_id: string;
  appearance: string;
}

export async function generatePersona(apiKey: string, sit: Situation): Promise<Persona> {
  const client = new Anthropic({ apiKey });
  const voiceList = ROLEPLAY_VOICES.map((v) => `- ${v.id} (${v.label})`).join('\n');
  const r = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 600,
    tools: [
      {
        name: 'create_persona',
        description: 'Define a single coherent character for a roleplay scenario.',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: {
              type: 'string',
              description: 'A common Chinese given name in pinyin, e.g. "Li Na" or "Wang Lei".',
            },
            voice_id: {
              type: 'string',
              enum: ROLEPLAY_VOICES.map((v) => v.id),
              description: 'Exact voice id matching the persona age/gender/tone.',
            },
            appearance: {
              type: 'string',
              description:
                'One detailed sentence describing how this person looks (gender, approximate age, hair, clothing, expression) and the immediate setting around them. This will be reused verbatim for every image so it must fully specify the character.',
            },
          },
          required: ['name', 'voice_id', 'appearance'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'create_persona' },
    messages: [
      {
        role: 'user',
        content: `Create one believable character to play "${sit.ai_role}" in this scenario: ${sit.scenario}

Pick the best-matching voice from this list:
${voiceList}

The voice and appearance MUST agree (same gender and rough age). Keep the appearance concrete and visual.`,
      },
    ],
  });
  const tu = r.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!tu) throw new Error('generatePersona: no tool_use');
  return tu.input as Persona;
}

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

export function buildImagePrompt(appearance: string, english: string): string {
  return `Digital illustration, warm friendly style, soft lighting. ${appearance} Same person every time — identical face, hair and clothing. Waist-up, looking toward the viewer, mid-conversation; their expression and body language match the mood of someone who is ${moodHint(english)}. Absolutely no text, captions, speech bubbles, subtitles, or written words anywhere in the image.`;
}

function moodHint(english: string): string {
  const e = english.toLowerCase();
  if (e.includes('?')) return 'asking a question, slightly inquisitive';
  if (e.includes('sorry') || e.includes('unfortunately')) return 'apologetic';
  if (e.includes('welcome') || e.includes('hello') || e.includes('hi'))
    return 'greeting warmly';
  if (e.includes('thank')) return 'appreciative';
  return 'speaking calmly and helpfully';
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
