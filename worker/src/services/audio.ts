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

export function getUniqueAudioKey(noteId: string): string {
  const id = crypto.randomUUID().split('-')[0];
  return `generated/${noteId}_${id}.mp3`;
}

/**
 * Generate a key for user recording
 */
export function getRecordingKey(reviewId: string): string {
  return `recordings/${reviewId}.webm`;
}

/**
 * Generate TTS audio using MiniMax AI API
 * Uses speech-02-hd model with 0.8x speed (slightly slower for learning)
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
          voice_id: DEFAULT_MINIMAX_VOICE,
          speed: 0.8, // Slightly slower for learning
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

    // Store in R2 (legacy single-audio path, overwrites same key)
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
            sampleRateHertz: 24000, // Higher quality sample rate for Wavenet
            effectsProfileId: ['headphone-class-device'], // Optimize for headphone playback
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

    // Store in R2 (legacy single-audio path, overwrites same key)
    const key = getNoteAudioKey(noteId);
    await storeAudio(env.AUDIO_BUCKET, key, audioBytes.buffer as ArrayBuffer, 'audio/mpeg');
    console.log('[TTS] Stored audio in R2 with key:', key);

    return key;
  } catch (error) {
    console.error('[TTS] TTS generation failed:', error);
    return null;
  }
}

// Default MiniMax voice ID - male voice
export const DEFAULT_MINIMAX_VOICE = 'Chinese (Mandarin)_Gentleman';

export interface TTSOptions {
  speed?: number; // 0.3 - 1.0, default 0.8 for MiniMax, 0.9 for Google
  preferProvider?: AudioProvider; // Prefer a specific provider
  voiceId?: string; // MiniMax voice ID (only used when provider is minimax)
}

/**
 * Generate TTS audio - tries MiniMax first, falls back to Google TTS
 * Returns both the audio key and which provider was used
 */
export async function generateTTS(
  env: Env,
  text: string,
  noteId: string,
  options: TTSOptions = {}
): Promise<TTSResult | null> {
  const { preferProvider } = options;

  // If a specific provider is preferred, try it first
  if (preferProvider === 'gtts') {
    const googleKey = await generateGoogleTTSWithOptions(env, text, noteId, options);
    if (googleKey) {
      return { audioKey: googleKey, provider: 'gtts' };
    }
    // Fall back to MiniMax
    const miniMaxKey = await generateMiniMaxTTSWithOptions(env, text, noteId, options);
    if (miniMaxKey) {
      return { audioKey: miniMaxKey, provider: 'minimax' };
    }
    return null;
  }

  // Default: Try MiniMax first (higher quality)
  const miniMaxKey = await generateMiniMaxTTSWithOptions(env, text, noteId, options);
  if (miniMaxKey) {
    return { audioKey: miniMaxKey, provider: 'minimax' };
  }

  // Fall back to Google TTS
  console.log('[TTS] MiniMax failed, falling back to Google TTS');
  const googleKey = await generateGoogleTTSWithOptions(env, text, noteId, options);
  if (googleKey) {
    return { audioKey: googleKey, provider: 'gtts' };
  }

  return null;
}

/**
 * Generate MiniMax TTS with configurable options
 */
async function generateMiniMaxTTSWithOptions(
  env: Env,
  text: string,
  noteId: string,
  options: TTSOptions
): Promise<string | null> {
  const speed = options.speed ?? 0.8;
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;

  console.log('[TTS] generateMiniMaxTTSWithOptions called:', { text, noteId, speed, voiceId, hasApiKey: !!env.MINIMAX_API_KEY });

  if (!env.MINIMAX_API_KEY) {
    console.log('[TTS] MiniMax API key not configured');
    return null;
  }

  try {
    console.log('[TTS] Calling MiniMax TTS API with speed:', speed, 'voice:', voiceId);
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
          voice_id: voiceId,
          speed: speed,
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

    console.log('[TTS] MiniMax response keys:', Object.keys(data));
    console.log('[TTS] MiniMax base_resp:', data.base_resp);

    const audioData = data.data?.audio;
    if (!audioData) {
      console.error('[TTS] MiniMax TTS: No audio in response', JSON.stringify(data).slice(0, 500));
      return null;
    }

    console.log('[TTS] Got MiniMax audio content, length:', audioData.length);

    // Detect encoding: hex only uses 0-9a-fA-F, base64 uses more chars
    const isLikelyHex = /^[0-9a-fA-F]+$/.test(audioData.slice(0, 100));

    let audioBytes: Uint8Array;
    if (isLikelyHex) {
      console.log('[TTS] Decoding as HEX');
      audioBytes = new Uint8Array(audioData.length / 2);
      for (let i = 0; i < audioData.length; i += 2) {
        audioBytes[i / 2] = parseInt(audioData.substr(i, 2), 16);
      }
    } else {
      console.log('[TTS] Decoding as BASE64');
      audioBytes = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
    }
    console.log('[TTS] Decoded audio bytes:', audioBytes.length);

    // Store in R2 with unique key per recording
    const key = getUniqueAudioKey(noteId);
    await storeAudio(env.AUDIO_BUCKET, key, audioBytes.buffer as ArrayBuffer, 'audio/mpeg');
    console.log('[TTS] Stored MiniMax audio in R2 with key:', key);

    return key;
  } catch (error) {
    console.error('[TTS] MiniMax TTS generation failed:', error);
    return null;
  }
}

/**
 * Generate Google TTS with configurable options
 */
async function generateGoogleTTSWithOptions(
  env: Env,
  text: string,
  noteId: string,
  options: TTSOptions
): Promise<string | null> {
  const speed = options.speed ?? 0.9;

  console.log('[TTS] generateGoogleTTSWithOptions called:', { text, noteId, speed, hasApiKey: !!env.GOOGLE_TTS_API_KEY });

  if (!env.GOOGLE_TTS_API_KEY) {
    console.log('[TTS] Google TTS API key not configured');
    return null;
  }

  try {
    console.log('[TTS] Calling Google TTS API with speed:', speed);
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
            name: 'cmn-CN-Wavenet-C',
            ssmlGender: 'FEMALE',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: speed,
            sampleRateHertz: 24000, // Higher quality sample rate for Wavenet
            effectsProfileId: ['headphone-class-device'], // Optimize for headphone playback
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

    const audioBytes = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
    console.log('[TTS] Decoded audio bytes:', audioBytes.length);

    const key = getUniqueAudioKey(noteId);
    await storeAudio(env.AUDIO_BUCKET, key, audioBytes.buffer as ArrayBuffer, 'audio/mpeg');
    console.log('[TTS] Stored audio in R2 with key:', key);

    return key;
  } catch (error) {
    console.error('[TTS] TTS generation failed:', error);
    return null;
  }
}

export interface ConversationTTSOptions {
  voiceId?: string;
  speed?: number;
}

export interface ConversationTTSResult {
  audioBase64: string;
  contentType: string;
  provider: AudioProvider;
}

/**
 * Generate TTS audio for conversation messages (no storage, returns base64)
 * Supports configurable voice settings per conversation
 */
export async function generateConversationTTS(
  env: Env,
  text: string,
  options: ConversationTTSOptions = {}
): Promise<ConversationTTSResult | null> {
  const voiceId = options.voiceId || DEFAULT_MINIMAX_VOICE;
  const speed = options.speed || 0.8;

  // Try MiniMax first
  if (env.MINIMAX_API_KEY) {
    try {
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
            voice_id: voiceId,
            speed: speed,
          },
          audio_setting: {
            format: 'mp3',
            sample_rate: 32000,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json() as {
          data?: { audio?: string };
          base_resp?: { status_code: number; status_msg: string };
        };

        const audioData = data.data?.audio;
        if (audioData) {
          // Detect encoding: hex only uses 0-9a-fA-F, base64 uses more chars
          const isLikelyHex = /^[0-9a-fA-F]+$/.test(audioData.slice(0, 100));

          let audioBase64: string;
          if (isLikelyHex) {
            // Convert hex to base64
            const bytes = new Uint8Array(audioData.length / 2);
            for (let i = 0; i < audioData.length; i += 2) {
              bytes[i / 2] = parseInt(audioData.substr(i, 2), 16);
            }
            audioBase64 = btoa(String.fromCharCode(...bytes));
          } else {
            audioBase64 = audioData;
          }

          return {
            audioBase64,
            contentType: 'audio/mpeg',
            provider: 'minimax',
          };
        }
      }
    } catch (error) {
      console.error('[TTS] MiniMax conversation TTS failed:', error);
    }
  }

  // Fall back to Google TTS
  if (env.GOOGLE_TTS_API_KEY) {
    try {
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
              name: 'cmn-CN-Wavenet-C',
              ssmlGender: 'FEMALE',
            },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: speed,
              sampleRateHertz: 24000,
              effectsProfileId: ['headphone-class-device'],
            },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json() as { audioContent: string };
        return {
          audioBase64: data.audioContent,
          contentType: 'audio/mpeg',
          provider: 'gtts',
        };
      }
    } catch (error) {
      console.error('[TTS] Google conversation TTS failed:', error);
    }
  }

  return null;
}
