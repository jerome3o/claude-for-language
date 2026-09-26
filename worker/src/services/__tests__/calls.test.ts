import { describe, it, expect } from 'vitest';
import { createJoinTicket, verifyJoinTicket } from '../calls/ticket';
import { parseGeminiSegments, parseWhisperSegments, pickTranscriber, sonioxTokensToSegments } from '../calls/transcribe';
import { normalizeReport } from '../calls/report';
import { baseMime, chunkKey, pieceAudioKey } from '../calls/recording';

const env = { SESSION_SECRET: 'test-secret' };

describe('join tickets', () => {
  it('round-trips for the right call and expires after a minute', async () => {
    const now = 1_700_000_000_000;
    const ticket = await createJoinTicket(env, 'call-1', 'user-1', now);
    expect(await verifyJoinTicket(env, ticket, 'call-1', now + 1000)).toMatchObject({ callId: 'call-1', userId: 'user-1' });
    expect(await verifyJoinTicket(env, ticket, 'call-2', now + 1000)).toBeNull();
    expect(await verifyJoinTicket(env, ticket, 'call-1', now + 61_000)).toBeNull();
  });

  it('rejects a tampered ticket or another secret', async () => {
    const ticket = await createJoinTicket(env, 'call-1', 'user-1');
    const [payload, sig] = ticket.split('.');
    const forged = btoa(JSON.stringify({ callId: 'call-1', userId: 'someone-else', exp: Date.now() + 60_000 })).replace(/=+$/, '');
    expect(await verifyJoinTicket(env, `${forged}.${sig}`, 'call-1')).toBeNull();
    expect(await verifyJoinTicket({ SESSION_SECRET: 'other' }, `${payload}.${sig}`, 'call-1')).toBeNull();
    expect(await verifyJoinTicket(env, 'garbage', 'call-1')).toBeNull();
    expect(await verifyJoinTicket(env, null, 'call-1')).toBeNull();
  });

  it('falls back to the OAuth secret, a dev key only under E2E_TEST_MODE, else refuses', async () => {
    const viaGoogle = await createJoinTicket({ GOOGLE_CLIENT_SECRET: 'g' }, 'c', 'u');
    expect(await verifyJoinTicket({ GOOGLE_CLIENT_SECRET: 'g' }, viaGoogle, 'c')).not.toBeNull();
    expect(await verifyJoinTicket({ E2E_TEST_MODE: 'true' }, viaGoogle, 'c')).toBeNull();
    expect(await createJoinTicket({ E2E_TEST_MODE: 'true' }, 'c', 'u')).toContain('.');
    await expect(createJoinTicket({}, 'c', 'u')).rejects.toThrow(/SESSION_SECRET/);
  });
});

describe('pickTranscriber', () => {
  it('prefers soniox, then gemini, then whisper; honours an override', () => {
    expect(pickTranscriber({ GEMINI_API_KEY: '', SONIOX_API_KEY: '' })).toBe('whisper');
    expect(pickTranscriber({ GEMINI_API_KEY: 'g' })).toBe('gemini');
    expect(pickTranscriber({ GEMINI_API_KEY: 'g', SONIOX_API_KEY: 's' })).toBe('soniox');
    expect(pickTranscriber({ GEMINI_API_KEY: 'g', SONIOX_API_KEY: 's', CALL_TRANSCRIBE_PROVIDER: 'gemini' })).toBe('gemini');
    expect(pickTranscriber({ GEMINI_API_KEY: 'g', CALL_TRANSCRIBE_PROVIDER: 'whisper' })).toBe('whisper');
    // An override for a provider without a key falls back to the best configured.
    expect(pickTranscriber({ GEMINI_API_KEY: 'g', CALL_TRANSCRIBE_PROVIDER: 'soniox' })).toBe('gemini');
  });
});

describe('parseGeminiSegments', () => {
  it('reads MM:SS timestamps, code-switched text, pinyin and translation', () => {
    const segs = parseGeminiSegments(JSON.stringify([
      { start: '00:12.5', end: '00:15', text: '我想 order 一个 coffee', language: 'mixed', pinyin: 'wǒ xiǎng yí gè', translation: 'I want to order a coffee' },
      { start: '00:02', end: '00:04', text: '你好', language: 'zh', pinyin: 'nǐ hǎo', translation: 'Hello' },
      { start: 'bad', end: '00:05', text: 'dropped' },
      { start: '00:20', end: '00:19', text: 'end before start', language: 'en', pinyin: '', translation: '' },
    ]));
    expect(segs.map((s) => s.text)).toEqual(['你好', '我想 order 一个 coffee', 'end before start']);
    expect(segs[1]).toMatchObject({ start: 12.5, end: 15, language: 'mixed', translation: 'I want to order a coffee' });
    expect(segs[2]).toMatchObject({ start: 20, end: 22, pinyin: null, translation: null });
  });

  it('tolerates a code fence and an empty list; throws on junk', () => {
    expect(parseGeminiSegments('```json\n[]\n```')).toEqual([]);
    expect(parseGeminiSegments('')).toEqual([]);
    expect(() => parseGeminiSegments('not json')).toThrow();
  });
});

describe('parseWhisperSegments', () => {
  it('uses segments, falls back to the whole text', () => {
    expect(parseWhisperSegments({ segments: [{ start: 0, end: 2.4, text: ' 你好 ' }, { start: 3, end: 4, text: '' }] }))
      .toEqual([{ start: 0, end: 2.4, text: '你好' }]);
    expect(parseWhisperSegments({ text: '谢谢' })).toEqual([{ start: 0, end: 0, text: '谢谢' }]);
    expect(parseWhisperSegments({})).toEqual([]);
  });
});

describe('sonioxTokensToSegments', () => {
  it('joins sub-word tokens, splits at pauses, labels mixed language', () => {
    const segs = sonioxTokensToSegments([
      { text: '我', start_ms: 0, end_ms: 200, language: 'zh' },
      { text: '想', start_ms: 200, end_ms: 400, language: 'zh' },
      { text: ' or', start_ms: 450, end_ms: 600, language: 'en' },
      { text: 'der', start_ms: 600, end_ms: 800, language: 'en' },
      { text: '咖啡', start_ms: 3000, end_ms: 3500, language: 'zh' },
    ]);
    expect(segs).toEqual([
      { start: 0, end: 0.8, text: '我想 order', language: 'mixed' },
      { start: 3, end: 3.5, text: '咖啡', language: 'zh' },
    ]);
  });
});

describe('normalizeReport', () => {
  it('keeps well-formed words, drops broken hanzi and duplicates, strips a bad sentence', () => {
    const report = normalizeReport({
      summary: ' You practised ordering food. ',
      topics: ['food', ''],
      vocabulary: [
        { hanzi: '点菜', pinyin: 'diǎn cài', english: 'to order food', sentence_clue: '我们先点菜吧。' },
        { hanzi: '点菜', pinyin: 'diǎn cài', english: 'dup' },
        { hanzi: '你好/您好', pinyin: 'nǐ hǎo', english: 'hello' },
        { hanzi: '服务员', pinyin: 'fúwùyuán', english: 'waiter', sentence_clue: '服务员（先生）你好', sentence_clue_pinyin: 'x' },
        { hanzi: '', pinyin: 'x', english: 'y' },
      ],
      corrections: [{ said: '我要一个咖啡', better: '我要一杯咖啡', explanation: 'Coffee takes 杯.' }, { said: '', better: 'x', explanation: '' }],
      follow_ups: ['Practise measure words'],
    } as never, 'm', new Date('2026-09-26T00:00:00Z'));
    expect(report.summary).toBe('You practised ordering food.');
    expect(report.topics).toEqual(['food']);
    expect(report.vocabulary.map((w) => w.hanzi)).toEqual(['点菜', '服务员']);
    expect(report.vocabulary[0].sentence_clue).toBe('我们先点菜吧。');
    expect(report.vocabulary[1].sentence_clue).toBeUndefined();
    expect(report.vocabulary[1].sentence_clue_pinyin).toBeUndefined();
    expect(report.corrections).toHaveLength(1);
    expect(report.generated_at).toBe('2026-09-26T00:00:00.000Z');
  });
});

describe('recording keys', () => {
  it('names chunks and assembled pieces', () => {
    expect(chunkKey('c', 'p', 7)).toBe('calls/c/chunks/p/0007');
    expect(pieceAudioKey('c', 'p', 'audio/webm;codecs=opus')).toBe('calls/c/p.webm');
    expect(pieceAudioKey('c', 'p', 'audio/mp4')).toBe('calls/c/p.m4a');
    expect(baseMime('Audio/WebM; codecs=opus')).toBe('audio/webm');
  });
});
