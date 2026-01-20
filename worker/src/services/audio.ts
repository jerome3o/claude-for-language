import { Env } from '../types';

/**
 * Audio service for TTS generation and storage using MiniMax and Google Cloud TTS
 */

export type AudioProvider = 'minimax' | 'gtts';

export interface TTSResult {
  audioKey: string;
  provider: AudioProvider;
}

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
 * Generate TTS audio using MiniMax AI API
 * Uses speech-02-hd model with 0.8x speed for better learning
 */
export async function generateMiniMaxTTS(
  env: Env,
  text: string,
  noteId: string
): Promise<string | null> {
  console.log('[TTS] generateMiniMaxTTS called:', { text, noteId, hasApiKey: !!env.MINIMAX_API_KEY });

  if (!env.MINIMAX_API_KEY) {
    console.log('[TTS] MiniMax API key not configured');
    return null;
  }

  try {
    console.log('[TTS] Calling MiniMax TTS API...');
    const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-02-hd',
        text: text,
        stream: false,
        voice_setting: {
          voice_id: 'female-tianmei',
          speed: 0.8, // Slower for learning
        },
        audio_setting: {
          format: 'mp3',
          sample_rate: 32000,
        },
      }),
    });

    console.log('[TTS] MiniMax TTS response status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('[TTS] MiniMax TTS error:', error);
      return null;
    }

    const data = await response.json() as {
      audio_file?: string;
      data?: { audio?: string };
      base_resp?: { status_code: number; status_msg: string };
    };

    // Log the full response structure for debugging
    console.log('[TTS] MiniMax response keys:', Object.keys(data));
    console.log('[TTS] MiniMax base_resp:', data.base_resp);

    // MiniMax returns audio in data.audio - need to detect encoding (hex vs base64)
    const audioData = data.data?.audio;
    if (!audioData) {
      console.error('[TTS] MiniMax TTS: No audio in response', JSON.stringify(data).slice(0, 500));
      return null;
    }

    console.log('[TTS] Got MiniMax audio content, length:', audioData.length);
    console.log('[TTS] First 20 chars:', audioData.slice(0, 20));

    // Detect encoding: hex only uses 0-9a-fA-F, base64 uses more chars
    const isLikelyHex = /^[0-9a-fA-F]+$/.test(audioData.slice(0, 100));
    console.log('[TTS] Encoding detection - isLikelyHex:', isLikelyHex);

    let audioBytes: Uint8Array;
    if (isLikelyHex) {
      // Decode hex to bytes
      console.log('[TTS] Decoding as HEX');
      audioBytes = new Uint8Array(audioData.length / 2);
      for (let i = 0; i < audioData.length; i += 2) {
        audioBytes[i / 2] = parseInt(audioData.substr(i, 2), 16);
      }
    } else {
      // Decode base64 to bytes
      console.log('[TTS] Decoding as BASE64');
      audioBytes = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
    }
    console.log('[TTS] Decoded audio bytes:', audioBytes.length);

    // Log first few bytes to verify it's MP3 (should start with ID3 or 0xFF 0xFB)
    const header = Array.from(audioBytes.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log('[TTS] Audio header bytes:', header);

    // Verify MP3 magic bytes
    const isID3 = audioBytes[0] === 0x49 && audioBytes[1] === 0x44 && audioBytes[2] === 0x33; // "ID3"
    const isMP3Frame = audioBytes[0] === 0xFF && (audioBytes[1] & 0xE0) === 0xE0; // MP3 frame sync
    console.log('[TTS] Audio format check:', { isID3, isMP3Frame });

    if (!isID3 && !isMP3Frame) {
      console.error('[TTS] Warning: Audio does not appear to be valid MP3, first bytes:', header);
    }

    // Store in R2
    const key = getNoteAudioKey(noteId);
    await storeAudio(env.AUDIO_BUCKET, key, audioBytes.buffer as ArrayBuffer, 'audio/mpeg');
    console.log('[TTS] Stored MiniMax audio in R2 with key:', key);

    return key;
  } catch (error) {
    console.error('[TTS] MiniMax TTS generation failed:', error);
    return null;
  }
}

/**
 * Generate TTS audio using Google Cloud Text-to-Speech API
 */
export async function generateGoogleTTS(
  env: Env,
  text: string,
  noteId: string
): Promise<string | null> {
  console.log('[TTS] generateGoogleTTS called:', { text, noteId, hasApiKey: !!env.GOOGLE_TTS_API_KEY });

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
    await storeAudio(env.AUDIO_BUCKET, key, audioBytes.buffer as ArrayBuffer, 'audio/mpeg');
    console.log('[TTS] Stored audio in R2 with key:', key);

    return key;
  } catch (error) {
    console.error('[TTS] TTS generation failed:', error);
    return null;
  }
}

/**
 * Generate TTS audio - tries MiniMax first, falls back to Google TTS
 * Returns both the audio key and which provider was used
 */
export async function generateTTS(
  env: Env,
  text: string,
  noteId: string
): Promise<TTSResult | null> {
  // Try MiniMax first (higher quality)
  const miniMaxKey = await generateMiniMaxTTS(env, text, noteId);
  if (miniMaxKey) {
    return { audioKey: miniMaxKey, provider: 'minimax' };
  }

  // Fall back to Google TTS
  console.log('[TTS] MiniMax failed, falling back to Google TTS');
  const googleKey = await generateGoogleTTS(env, text, noteId);
  if (googleKey) {
    return { audioKey: googleKey, provider: 'gtts' };
  }

  return null;
}
