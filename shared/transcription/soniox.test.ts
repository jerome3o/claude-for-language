import { describe, expect, it } from 'vitest';
import { applySonioxMessage, buildSonioxConfig, EMPTY_TRANSCRIPT, liveKeyUsable, transcriptText } from './soniox';

describe('buildSonioxConfig', () => {
  it('streams webm with auto-detection and zh + en hints', () => {
    expect(buildSonioxConfig('tmp-key', { kind: 'auto' })).toEqual({
      api_key: 'tmp-key',
      model: 'stt-rt-v5',
      language_hints: ['zh', 'en'],
      audio_format: 'auto',
    });
  });

  it('declares rate and channels for raw PCM (the Lab app)', () => {
    expect(buildSonioxConfig('k', { kind: 'pcm_s16le', sampleRate: 16000, channels: 1 })).toMatchObject({
      audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
    });
  });

  it('never passes the expected word as context', () => {
    expect(buildSonioxConfig('k', { kind: 'auto' })).not.toHaveProperty('context');
  });
});

describe('applySonioxMessage', () => {
  it('keeps final tokens, replaces the provisional tail each message', () => {
    let s = applySonioxMessage(EMPTY_TRANSCRIPT, JSON.stringify({ tokens: [{ text: '我', is_final: true }, { text: '打', is_final: false }] }));
    expect(s).toMatchObject({ finalText: '我', partialText: '打', finished: false });
    s = applySonioxMessage(s, JSON.stringify({ tokens: [{ text: '打算', is_final: true }, { text: '明', is_final: false }] }));
    expect(s).toMatchObject({ finalText: '我打算', partialText: '明' });
    expect(transcriptText(s)).toBe('我打算明');
  });

  it('drops <fin> / <end> markers and notes finished', () => {
    let s = applySonioxMessage(EMPTY_TRANSCRIPT, JSON.stringify({ tokens: [{ text: '你好', is_final: true }, { text: '<fin>', is_final: true }] }));
    s = applySonioxMessage(s, JSON.stringify({ tokens: [], finished: true }));
    expect(s).toEqual({ finalText: '你好', partialText: '', finished: true, error: null });
  });

  it('mixed Chinese and English stays as spoken', () => {
    const s = applySonioxMessage(EMPTY_TRANSCRIPT, JSON.stringify({ tokens: [
      { text: '我想', is_final: true }, { text: ' order', is_final: true }, { text: ' 一个', is_final: true },
    ] }));
    expect(transcriptText(s)).toBe('我想 order 一个');
  });

  it('reports errors and ignores garbage', () => {
    expect(applySonioxMessage(EMPTY_TRANSCRIPT, 'not json')).toBe(EMPTY_TRANSCRIPT);
    const s = applySonioxMessage(EMPTY_TRANSCRIPT, JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    expect(s.error).toBe('Soniox 401: Invalid API key');
  });
});

describe('liveKeyUsable', () => {
  const now = Date.parse('2026-09-27T10:00:00Z');
  const session = { provider: 'soniox' as const, api_key: 'k', expires_at: '2026-09-27T10:30:00Z', websocket_url: 'wss://x', model: 'stt-rt-v5', language_hints: ['zh'] };
  it('reuses a key until a minute before expiry', () => {
    expect(liveKeyUsable(session, now)).toBe(true);
    expect(liveKeyUsable(session, Date.parse('2026-09-27T10:29:30Z'))).toBe(false);
  });
  it('upload / missing sessions are never usable', () => {
    expect(liveKeyUsable({ provider: 'upload' }, now)).toBe(false);
    expect(liveKeyUsable(null, now)).toBe(false);
  });
});
