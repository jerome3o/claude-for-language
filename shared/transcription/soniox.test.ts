import { describe, expect, it } from 'vitest';
import { applySonioxMessage, buildSonioxConfig, EMPTY_TRANSCRIPT, isWebSocketProtocolToken, liveErrorKind, liveFailureInvalidatesKey, liveKeyUsable, SONIOX_API_KEY_PROTOCOL, SONIOX_END_OF_AUDIO, sonioxAuthorizationHeader, sonioxBrowserAuth, transcriptText } from './soniox';

describe('SONIOX_END_OF_AUDIO', () => {
  // Soniox ends the stream only on an EMPTY TEXT frame; an empty binary frame is an empty audio
  // chunk. The Lab app sent the binary one, so every take timed out after 4 s (Oct 2026).
  it('is an empty string (a text frame), never an empty byte array', () => {
    expect(SONIOX_END_OF_AUDIO).toBe('');
    expect(typeof SONIOX_END_OF_AUDIO).toBe('string');
  });
});

describe('liveErrorKind', () => {
  it('turns a live failure reason into an analytics enum (same vectors as the Lab port)', () => {
    expect(liveErrorKind(null)).toBe('none');
    expect(liveErrorKind('  ')).toBe('none');
    expect(liveErrorKind('Timed out waiting for 4000 ms')).toBe('timeout');
    expect(liveErrorKind('timeout')).toBe('timeout');
    expect(liveErrorKind('Soniox 402: Balance exhausted')).toBe('soniox_402');
    expect(liveErrorKind('Soniox 401: Invalid API key')).toBe('soniox_401');
    expect(liveErrorKind('Soniox : error')).toBe('soniox_error');
    expect(liveErrorKind('live returned no text')).toBe('empty');
    expect(liveErrorKind('closed early')).toBe('closed');
    expect(liveErrorKind('aborted')).toBe('aborted');
    expect(liveErrorKind('no live session')).toBe('no_session');
    expect(liveErrorKind('socket error')).toBe('socket');
  });
});

describe('buildSonioxConfig', () => {
  it('streams webm with auto-detection and zh + en hints — and no key (it goes with the connection)', () => {
    expect(buildSonioxConfig({ kind: 'auto' })).toEqual({
      model: 'stt-rt-v5',
      language_hints: ['zh', 'en'],
      audio_format: 'auto',
    });
  });

  it('a legacy key that cannot be a subprotocol still rides in the frame', () => {
    expect(buildSonioxConfig({ kind: 'auto' }, 'stt-rt-v5', ['zh'], 'temp:abc')).toMatchObject({ api_key: 'temp:abc' });
  });

  it('declares rate and channels for raw PCM (the Lab app)', () => {
    expect(buildSonioxConfig({ kind: 'pcm_s16le', sampleRate: 16000, channels: 1 })).toMatchObject({
      audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
    });
  });

  it('never passes the expected word as context', () => {
    expect(buildSonioxConfig({ kind: 'auto' })).not.toHaveProperty('context');
  });
});

describe('WebSocket authentication (key with the connection)', () => {
  it('browser: subprotocols soniox-api-key + the key, nothing in the config frame', () => {
    expect(SONIOX_API_KEY_PROTOCOL).toBe('soniox-api-key');
    expect(sonioxBrowserAuth('snx_temp_AbC-1.2')).toEqual({ protocols: ['soniox-api-key', 'snx_temp_AbC-1.2'], configApiKey: null });
  });

  it('browser: an old temp: key is not a valid subprotocol, so it stays in the config frame', () => {
    expect(isWebSocketProtocolToken('temp:abc')).toBe(false);
    expect(isWebSocketProtocolToken('')).toBe(false);
    expect(isWebSocketProtocolToken('a b')).toBe(false);
    expect(sonioxBrowserAuth('temp:abc')).toEqual({ protocols: null, configApiKey: 'temp:abc' });
  });

  it('server / native: a Bearer header', () => {
    expect(sonioxAuthorizationHeader('snx_temp_x')).toBe('Bearer snx_temp_x');
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

  it('a null error_code next to tokens is a normal response, not an error', () => {
    const s = applySonioxMessage(EMPTY_TRANSCRIPT, JSON.stringify({ tokens: [{ text: '好', is_final: true }], error_code: null, error_message: null }));
    expect(s.error).toBeNull();
    expect(transcriptText(s)).toBe('好');
  });

  it('out of credit (402) is reported with its code', () => {
    const s = applySonioxMessage(EMPTY_TRANSCRIPT, JSON.stringify({ tokens: [], error_code: 402, error_type: 'organization_balance_exhausted', error_message: 'Balance exhausted' }));
    expect(s.error).toBe('Soniox 402: Balance exhausted');
  });
});

describe('liveFailureInvalidatesKey', () => {
  it('drops the cached key only when Soniox refused the key itself', () => {
    expect(liveFailureInvalidatesKey('Soniox 401: Incorrect API key provided.')).toBe(true);
    expect(liveFailureInvalidatesKey('Soniox 403: temp_api_key_session_expired')).toBe(true);
    expect(liveFailureInvalidatesKey('Soniox 402: Balance exhausted')).toBe(false);
    expect(liveFailureInvalidatesKey('timeout')).toBe(false);
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
