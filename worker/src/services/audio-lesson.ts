/**
 * Audio lesson generation service.
 * Generates a downloadable MP3 lesson from deck vocabulary.
 *
 * Format:
 *   1. Intro
 *   2. Dialogue using the vocabulary words (played 2x)
 *   3. Sentence-by-sentence: Chinese then English translation
 *   4. Individual vocabulary words (Chinese × 2 slow, then English)
 *   5. Outro
 *
 * Chinese TTS: MiniMax (two voices for dialogue), fallback Google.
 * English TTS: Google at 1x speed.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Env } from '../types';

interface LessonNote {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string | null;
}

interface LessonSegment {
  text: string;
  language: 'zh' | 'en';
  speed: number;
  voiceId?: string;  // minimax voice override
}

interface DialogueLine {
  hanzi: string;
  pinyin: string;
  english: string;
  speaker: 'a' | 'b';
}

const SLOW_SPEED = 0.55;
const NORMAL_ZH_SPEED = 0.75;
const NORMAL_EN_SPEED = 1.0;

// Two distinct MiniMax voices for dialogue speakers
const VOICE_A = 'Chinese (Mandarin)_Jingqiang';  // male voice
const VOICE_B = 'Mandarin_woman';                  // female voice
const VOICE_DEFAULT = 'Chinese (Mandarin)_Gentleman';

/** Ask Claude to generate a short conversational dialogue using the vocabulary. */
export async function generateDialogueScript(
  apiKey: string,
  notes: LessonNote[],
): Promise<DialogueLine[]> {
  const client = new Anthropic({ apiKey });

  const wordList = notes.map((n) => `${n.hanzi} (${n.pinyin}) — ${n.english}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    tools: [
      {
        name: 'create_dialogue',
        description: 'Create a short conversational dialogue in Mandarin Chinese using the given vocabulary.',
        input_schema: {
          type: 'object' as const,
          properties: {
            lines: {
              type: 'array',
              description: '8-14 dialogue lines alternating between two speakers (A and B).',
              items: {
                type: 'object',
                properties: {
                  hanzi: { type: 'string', description: 'The Chinese text for this line' },
                  pinyin: { type: 'string', description: 'Pinyin with tone marks' },
                  english: { type: 'string', description: 'Natural idiomatic English translation of this line' },
                  speaker: { type: 'string', enum: ['a', 'b'], description: 'Which speaker says this line' },
                },
                required: ['hanzi', 'pinyin', 'english', 'speaker'],
              },
            },
          },
          required: ['lines'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'create_dialogue' },
    messages: [
      {
        role: 'user',
        content: `Create a natural, conversational Mandarin dialogue between two people (Person A and Person B) that uses as many of the following vocabulary words as possible. The dialogue should be realistic and flow naturally — like a real conversation. Keep sentences short (4-12 characters each). Use tone marks in pinyin (nǐ hǎo, not ni3 hao3).

Vocabulary to include:
${wordList}

Make the conversation feel natural and idiomatic. Person A and Person B should alternate speaking. Try to use each vocabulary word at least once across the dialogue.`,
      },
    ],
  });

  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!toolUse) {
    // Fallback: return empty dialogue on failure
    return [];
  }
  const input = toolUse.input as { lines: DialogueLine[] };
  return input.lines ?? [];
}

/** Build ordered list of TTS segments for a vocabulary lesson. */
export function buildLessonScript(
  notes: LessonNote[],
  deckName: string,
  dialogue: DialogueLine[],
): LessonSegment[] {
  const segments: LessonSegment[] = [];

  // ── Intro ──
  segments.push({
    text: `Welcome to your Chinese vocabulary lesson for ${deckName}. Today we have ${notes.length} word${notes.length !== 1 ? 's' : ''}. First, listen to a conversation that uses these words. Then we'll go through each sentence, and finally drill the individual words.`,
    language: 'en',
    speed: NORMAL_EN_SPEED,
  });

  if (dialogue.length > 0) {
    // ── Full dialogue — play twice ──
    for (let round = 1; round <= 2; round++) {
      segments.push({
        text: round === 1 ? 'Here is the conversation.' : 'Listen again.',
        language: 'en',
        speed: NORMAL_EN_SPEED,
      });

      for (const line of dialogue) {
        segments.push({
          text: line.hanzi,
          language: 'zh',
          speed: NORMAL_ZH_SPEED,
          voiceId: line.speaker === 'a' ? VOICE_A : VOICE_B,
        });
      }
    }

    // ── Sentence-by-sentence translation ──
    segments.push({
      text: "Now let's go through the conversation line by line. You'll hear each Chinese sentence, then the English translation.",
      language: 'en',
      speed: NORMAL_EN_SPEED,
    });

    for (const line of dialogue) {
      segments.push({
        text: line.hanzi,
        language: 'zh',
        speed: NORMAL_ZH_SPEED,
        voiceId: line.speaker === 'a' ? VOICE_A : VOICE_B,
      });
      segments.push({
        text: line.english,
        language: 'en',
        speed: NORMAL_EN_SPEED,
      });
    }
  }

  // ── Individual vocabulary words ──
  segments.push({
    text: `Now let's go through each vocabulary word individually.`,
    language: 'en',
    speed: NORMAL_EN_SPEED,
  });

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    segments.push({ text: `Word ${i + 1}.`, language: 'en', speed: NORMAL_EN_SPEED });

    // Chinese twice slowly
    segments.push({ text: note.hanzi, language: 'zh', speed: SLOW_SPEED, voiceId: VOICE_A });
    segments.push({ text: note.hanzi, language: 'zh', speed: SLOW_SPEED, voiceId: VOICE_A });

    // English meaning
    segments.push({ text: note.english, language: 'en', speed: NORMAL_EN_SPEED });

    // Fun facts if available
    if (note.fun_facts && note.fun_facts.trim()) {
      segments.push({ text: note.fun_facts.trim(), language: 'en', speed: NORMAL_EN_SPEED });
    }

    // One more at normal speed
    segments.push({ text: note.hanzi, language: 'zh', speed: NORMAL_ZH_SPEED, voiceId: VOICE_A });
  }

  // ── Outro ──
  segments.push({
    text: `That's it for today's lesson. Great work! Keep practicing and you'll master these words in no time.`,
    language: 'en',
    speed: NORMAL_EN_SPEED,
  });

  return segments;
}

async function callMiniMaxTTS(env: Env, text: string, speed: number, voiceId: string): Promise<Uint8Array | null> {
  if (!env.MINIMAX_API_KEY) return null;
  try {
    const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-02-hd',
        text,
        stream: false,
        voice_setting: { voice_id: voiceId, speed },
        audio_setting: { format: 'mp3', sample_rate: 32000 },
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { data?: { audio?: string } };
    const audioData = data.data?.audio;
    if (!audioData) return null;
    const isHex = /^[0-9a-fA-F]+$/.test(audioData.slice(0, 100));
    if (isHex) {
      const bytes = new Uint8Array(audioData.length / 2);
      for (let i = 0; i < audioData.length; i += 2) {
        bytes[i / 2] = parseInt(audioData.substr(i, 2), 16);
      }
      return bytes;
    }
    return Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function callGoogleChineseTTS(env: Env, text: string, speed: number): Promise<Uint8Array | null> {
  if (!env.GOOGLE_TTS_API_KEY) return null;
  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-C', ssmlGender: 'FEMALE' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: speed, sampleRateHertz: 24000 },
        }),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { audioContent: string };
    return Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function callGoogleEnglishTTS(env: Env, text: string, speed: number): Promise<Uint8Array | null> {
  if (!env.GOOGLE_TTS_API_KEY) return null;
  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D', ssmlGender: 'MALE' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: speed, sampleRateHertz: 24000 },
        }),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { audioContent: string };
    return Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function generateSegmentAudio(env: Env, segment: LessonSegment): Promise<Uint8Array | null> {
  if (segment.language === 'zh') {
    const voiceId = segment.voiceId ?? VOICE_DEFAULT;
    const mm = await callMiniMaxTTS(env, segment.text, segment.speed, voiceId);
    if (mm) return mm;
    return callGoogleChineseTTS(env, segment.text, segment.speed);
  } else {
    return callGoogleEnglishTTS(env, segment.text, segment.speed);
  }
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Generate the full lesson audio, concatenate all segments, and return as Uint8Array.
 * Generates segments in parallel batches to stay within Cloudflare Worker time limits.
 * Skips segments that fail TTS gracefully.
 */
export async function generateLessonAudio(
  env: Env,
  segments: LessonSegment[],
  concurrency = 8,
): Promise<{ audio: Uint8Array; successCount: number }> {
  const results: (Uint8Array | null)[] = new Array(segments.length).fill(null);

  for (let i = 0; i < segments.length; i += concurrency) {
    const batch = segments.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map((seg) => generateSegmentAudio(env, seg)));
    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      results[i + j] = r.status === 'fulfilled' ? r.value : null;
    }
  }

  const chunks: Uint8Array[] = [];
  let successCount = 0;
  for (const bytes of results) {
    if (bytes && bytes.length > 0) {
      chunks.push(bytes);
      successCount++;
    }
  }

  return { audio: concatUint8Arrays(chunks), successCount };
}
