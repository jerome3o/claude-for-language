import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanClientNote, describeProviderError, TakeTranscriptionError, transcribeTake } from '../take-transcription';

describe('transcribeTake', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const bytes = new Uint8Array([1, 2, 3]);

  it('uses the first provider that answers, in order whisper → soniox → gemini', async () => {
    const soniox = vi.fn(async () => ({ text: '好' }));
    const gemini = vi.fn(async () => ({ text: 'never' }));
    const out = await transcribeTake({ whisper: async () => { throw new Error('5006: invalid input'); }, soniox, gemini }, bytes, 'audio/wav');
    expect(out).toEqual({ text: '好', language: 'zh', provider: 'soniox', failed: [{ provider: 'whisper', error: '5006: invalid input' }] });
    expect(soniox).toHaveBeenCalledWith(bytes, 'audio/wav');
    expect(gemini).not.toHaveBeenCalled();
  });

  it('skips providers that are not configured', async () => {
    expect((await transcribeTake({ gemini: async () => ({ text: '行' }) }, bytes, 'audio/webm')).provider).toBe('gemini');
  });

  it('an empty answer is still an answer (nothing was said), not a failure', async () => {
    expect(await transcribeTake({ whisper: async () => ({ text: '' }) }, bytes, 'audio/wav')).toMatchObject({ text: '', provider: 'whisper' });
  });

  it('all failing lists every provider’s reason', async () => {
    const err = await transcribeTake({
      whisper: async () => { throw new Error('4006: daily free allocation used up'); },
      soniox: async () => { throw new Error('Soniox /files: HTTP 402 balance exhausted'); },
    }, bytes, 'audio/wav').catch((e) => e);
    expect(err).toBeInstanceOf(TakeTranscriptionError);
    expect((err as TakeTranscriptionError).failed.map((f) => f.provider)).toEqual(['whisper', 'soniox']);
    expect((err as Error).message).toBe('whisper: 4006: daily free allocation used up | soniox: Soniox /files: HTTP 402 balance exhausted');
    await expect(transcribeTake({}, bytes, 'audio/wav')).rejects.toThrow('No transcription provider is configured');
  });
});

describe('describeProviderError', () => {
  it('keeps the provider’s message on one line (a Workers AI error logged only its stack before)', () => {
    const e = new Error('3040: Capacity\n temporarily exceeded');
    e.name = 'AiError';
    expect(describeProviderError(e)).toBe('AiError: 3040: Capacity temporarily exceeded');
    expect(describeProviderError(new Error(''))).toBe('Error (no message)');
    expect(describeProviderError('plain')).toBe('plain');
  });
});

describe('cleanClientNote', () => {
  it('flattens, caps and never echoes a temporary key', () => {
    expect(cleanClientNote('Soniox 401:\nIncorrect key temp:abcDEF_123')).toBe('Soniox 401: Incorrect key temp:…');
    expect(cleanClientNote('x'.repeat(500))).toHaveLength(200);
    expect(cleanClientNote('  ')).toBeNull();
    expect(cleanClientNote(null)).toBeNull();
  });
});
