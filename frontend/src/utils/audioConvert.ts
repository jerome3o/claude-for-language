/**
 * Convert an audio Blob (e.g. WebM/Opus) to WAV PCM 16kHz mono
 * using the Web Audio API for decoding and manual WAV encoding.
 */
export async function convertToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 16000 });

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // Get mono channel data (use first channel)
    const channelData = audioBuffer.getChannelData(0);

    // Resample to 16kHz if needed
    let samples: Float32Array;
    if (audioBuffer.sampleRate !== 16000) {
      const ratio = audioBuffer.sampleRate / 16000;
      const newLength = Math.round(channelData.length / ratio);
      samples = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        samples[i] = channelData[Math.round(i * ratio)] || 0;
      }
    } else {
      samples = channelData;
    }

    // Encode as 16-bit PCM WAV
    const wavBuffer = encodeWav(samples, 16000);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  } finally {
    await audioCtx.close();
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
