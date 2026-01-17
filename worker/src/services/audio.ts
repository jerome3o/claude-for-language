import { Env } from '../types';

/**
 * Audio service for TTS generation and storage using Google Cloud TTS
 */

/**
 * Store audio data in R2
 */
export async function storeAudio(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer,
  contentType: string = 'audio/webm'
): Promise<string> {
  await bucket.put(key, data, {
    httpMetadata: {
      contentType,
    },
  });
  return key;
}

/**
 * Get audio from R2
 */
export async function getAudio(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

/**
 * Delete audio from R2
 */
export async function deleteAudio(
  bucket: R2Bucket,
  key: string
): Promise<void> {
  await bucket.delete(key);
}

/**
 * Generate a key for note audio (TTS generated)
 */
export function getNoteAudioKey(noteId: string): string {
  return `generated/${noteId}.mp3`;
}

/**
 * Generate a key for user recording
 */
export function getRecordingKey(reviewId: string): string {
  return `recordings/${reviewId}.webm`;
}

/**
 * Generate TTS audio using Google Cloud Text-to-Speech API
 */
export async function generateTTS(
  env: Env,
  text: string,
  noteId: string
): Promise<string | null> {
  console.log('[TTS] generateTTS called:', { text, noteId, hasApiKey: !!env.GOOGLE_TTS_API_KEY });

  if (!env.GOOGLE_TTS_API_KEY) {
    console.log('[TTS] Google TTS API key not configured');
    return null;
  }

  try {
    console.log('[TTS] Calling Google TTS API...');
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'cmn-CN',
            name: 'cmn-CN-Wavenet-C', // Female Mandarin voice
            ssmlGender: 'FEMALE',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 0.9, // Slightly slower for learning
          },
        }),
      }
    );

    console.log('[TTS] Google TTS response status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('[TTS] Google TTS error:', error);
      return null;
    }

    const data = await response.json() as { audioContent: string };
    console.log('[TTS] Got audio content, length:', data.audioContent?.length);

    // Decode base64 audio content
    const audioBytes = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
    console.log('[TTS] Decoded audio bytes:', audioBytes.length);

    // Store in R2
    const key = getNoteAudioKey(noteId);
    await storeAudio(env.AUDIO_BUCKET, key, audioBytes.buffer, 'audio/mpeg');
    console.log('[TTS] Stored audio in R2 with key:', key);

    return key;
  } catch (error) {
    console.error('[TTS] TTS generation failed:', error);
    return null;
  }
}
