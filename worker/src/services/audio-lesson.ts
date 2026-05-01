/**
 * Audio lesson generation service.
 * Generates a downloadable MP3 lesson from deck vocabulary.
 * Format: for each word, say Chinese 3x slowly then English, then a quick review.
 */

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
  speed: number;  // 0.5-1.0
}

const SLOW_SPEED = 0.55;
const NORMAL_SPEED = 0.75;

/** Build ordered list of TTS segments for a vocabulary lesson. */
export function buildLessonScript(notes: LessonNote[], deckName: string): LessonSegment[] {
  const segments: LessonSegment[] = [];

  segments.push({
    text: `Welcome to your Chinese vocabulary lesson for ${deckName}. Today we'll practice ${notes.length} word${notes.length !== 1 ? 's' : ''}. For each word, you'll hear the Chinese pronunciation three times slowly, followed by the English meaning.`,
    language: 'en',
    speed: NORMAL_SPEED,
  });

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    segments.push({ text: `Word ${i + 1}.`, language: 'en', speed: NORMAL_SPEED });

    // Chinese 3 times at slow speed
    segments.push({ text: note.hanzi, language: 'zh', speed: SLOW_SPEED });
    segments.push({ text: note.hanzi, language: 'zh', speed: SLOW_SPEED });
    segments.push({ text: note.hanzi, language: 'zh', speed: SLOW_SPEED });

    // English meaning
    segments.push({ text: note.english, language: 'en', speed: NORMAL_SPEED });

    // Fun facts as context if available
    if (note.fun_facts && note.fun_facts.trim()) {
      segments.push({ text: note.fun_facts.trim(), language: 'en', speed: NORMAL_SPEED });
    }

    // One more Chinese repetition
    segments.push({ text: note.hanzi, language: 'zh', speed: SLOW_SPEED });
  }

  // Quick review
  segments.push({
    text: `Great work! Now let's do a quick review. You'll hear each word once.`,
    language: 'en',
    speed: NORMAL_SPEED,
  });

  for (const note of notes) {
    segments.push({ text: note.hanzi, language: 'zh', speed: NORMAL_SPEED });
    segments.push({ text: note.english, language: 'en', speed: NORMAL_SPEED });
  }

  segments.push({
    text: `That's it for today's lesson. Keep practicing and you'll master these words in no time!`,
    language: 'en',
    speed: NORMAL_SPEED,
  });

  return segments;
}

async function callMiniMaxTTS(env: Env, text: string, speed: number): Promise<Uint8Array | null> {
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
        voice_setting: { voice_id: 'Chinese (Mandarin)_Gentleman', speed },
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
    const mm = await callMiniMaxTTS(env, segment.text, segment.speed);
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
 * Skips segments that fail TTS gracefully.
 */
export async function generateLessonAudio(
  env: Env,
  segments: LessonSegment[],
): Promise<{ audio: Uint8Array; successCount: number }> {
  const chunks: Uint8Array[] = [];
  let successCount = 0;

  for (const segment of segments) {
    const bytes = await generateSegmentAudio(env, segment);
    if (bytes && bytes.length > 0) {
      chunks.push(bytes);
      successCount++;
    }
  }

  return { audio: concatUint8Arrays(chunks), successCount };
}
