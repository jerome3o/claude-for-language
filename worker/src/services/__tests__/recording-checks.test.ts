import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  runRecordingCheck,
  enqueueRecordingCheck,
  enqueueMissingChecks,
  RetryLater,
  AZURE_MONTHLY_BUDGET_MS,
  AZURE_REQUESTS_PER_MINUTE,
} from '../recording-checks';
import { AzureError, assessPronunciation, parseAzureResult, assessmentHeader, azureSttEndpoint } from '../pronunciation/azure';
import { toAzureAudio, sniffAudio, opusPacketSamples, AZURE_OGG, AZURE_WAV } from '../pronunciation/audio-convert';
import { buildRecordingQueue } from '../recording-queue';
import type { Env } from '../../types';

const FIX = path.resolve(__dirname, '../pronunciation/__fixtures__');
const WEBM = new Uint8Array(fs.readFileSync(path.join(FIX, 'take-live.webm')));
const WAV = new Uint8Array(fs.readFileSync(path.join(FIX, 'take-22k-stereo.wav')));

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function bucket(objects: Record<string, Uint8Array>): R2Bucket {
  return {
    get: async (key: string) => (objects[key] ? { arrayBuffer: async () => objects[key].slice().buffer } : null),
  } as unknown as R2Bucket;
}

/** An Azure answer for 银行 with 银 off by a tone. */
const AZURE_JSON = {
  RecognitionStatus: 'Success',
  NBest: [
    {
      Display: '银行。',
      AccuracyScore: 71.5,
      FluencyScore: 90,
      CompletenessScore: 100,
      Words: [
        {
          Word: '银行',
          AccuracyScore: 71.5,
          ErrorType: 'Mispronunciation',
          Syllables: [
            { Syllable: 'yin2', Grapheme: '银', AccuracyScore: 48, Offset: 100, Duration: 300 },
            { Syllable: 'hang2', Grapheme: '行', AccuracyScore: 95, Offset: 400, Duration: 300 },
          ],
          Phonemes: [
            { Phoneme: 'y', AccuracyScore: 96, Offset: 100, Duration: 100 },
            { Phoneme: 'in 2', AccuracyScore: 31, Offset: 200, Duration: 200 },
            { Phoneme: 'h', AccuracyScore: 94, Offset: 400, Duration: 100 },
            { Phoneme: 'ang 2', AccuracyScore: 96, Offset: 500, Duration: 200 },
          ],
        },
      ],
    },
  ],
};

describe('audio conversion for Azure', () => {
  it('remuxes a MediaRecorder-style (unknown-size) WebM/Opus take into Ogg/Opus', () => {
    expect(sniffAudio(WEBM)).toBe('webm');
    const out = toAzureAudio(WEBM);
    if ('unsupported' in out) throw new Error(out.unsupported);
    expect(out.contentType).toBe(AZURE_OGG);
    expect(String.fromCharCode(...out.body.subarray(0, 4))).toBe('OggS');
    expect(String.fromCharCode(...out.body.subarray(28, 36))).toBe('OpusHead');
    expect(out.durationMs).toBeGreaterThan(1900);
    expect(out.durationMs).toBeLessThan(2100);
  });
  it('down-mixes and resamples a 22 kHz stereo WAV to 16 kHz mono', () => {
    const out = toAzureAudio(WAV);
    if ('unsupported' in out) throw new Error(out.unsupported);
    expect(out.contentType).toBe(AZURE_WAV);
    const v = new DataView(out.body.buffer);
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(out.durationMs).toBe(400);
  });
  it('refuses MP4 / unknown audio', () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
    expect(toAzureAudio(mp4)).toEqual({ unsupported: 'mp4/aac audio' });
    expect('unsupported' in toAzureAudio(new Uint8Array([1, 2, 3]))).toBe(true);
  });
  it('reads Opus packet durations from the TOC byte', () => {
    expect(opusPacketSamples(new Uint8Array([(31 << 3) | 0]))).toBe(960); // CELT 20 ms, 1 frame
    expect(opusPacketSamples(new Uint8Array([(3 << 3) | 1]))).toBe(5760); // SILK 60 ms ×2
    expect(opusPacketSamples(new Uint8Array([(16 << 3) | 3, 4]))).toBe(480); // CELT 2.5 ms ×4
  });
});

describe('Azure pronunciation assessment client', () => {
  it('sends the scripted zh-CN request and parses per-character scores, tone suspected', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(AZURE_JSON), { status: 200 }));
    const audio = toAzureAudio(WEBM);
    if ('unsupported' in audio) throw new Error('fixture');
    const res = await assessPronunciation({ key: 'k-123', region: 'uksouth' }, audio, '银行', fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(azureSttEndpoint('uksouth'));
    expect(url).toContain('uksouth.stt.speech.microsoft.com');
    expect(url).toContain('language=zh-CN');
    const headers = init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('k-123');
    expect(headers['Content-Type']).toBe(AZURE_OGG);
    const params = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(headers['Pronunciation-Assessment']), (c) => c.charCodeAt(0))));
    expect(params).toMatchObject({ ReferenceText: '银行', GradingSystem: 'HundredMark', EnableMiscue: 'True' });
    expect(res.score).toBe(71.5);
    expect(res.char_scores).toEqual([
      { char: '银', score: 48, error: 'Mispronunciation', tone_suspect: true },
      { char: '行', score: 95, error: 'None' },
    ]);
  });
  it('maps HTTP errors to kinds', async () => {
    const audio = toAzureAudio(WAV);
    if ('unsupported' in audio) throw new Error('fixture');
    for (const [status, kind] of [[401, 'auth'], [429, 'rate_limited'], [400, 'bad_audio'], [503, 'server']] as const) {
      const fetcher = async () => new Response('nope', { status });
      await expect(assessPronunciation({ key: 'k', region: 'r' }, audio, '你好', fetcher as unknown as typeof fetch)).rejects.toMatchObject({ kind });
    }
  });
  it('reads nested (SDK-style) scores, omissions and silence', () => {
    const nested = parseAzureResult(
      { RecognitionStatus: 'Success', NBest: [{ PronunciationAssessment: { AccuracyScore: 80 }, Words: [
        { Word: '你', PronunciationAssessment: { AccuracyScore: 90, ErrorType: 'None' } },
        { Word: '好', PronunciationAssessment: { ErrorType: 'Omission' } },
      ] }] },
      '你好'
    );
    expect(nested.score).toBe(80);
    expect(nested.char_scores).toEqual([{ char: '你', score: 90, error: 'None' }, { char: '好', score: null, error: 'Omission' }]);
    const silent = parseAzureResult({ RecognitionStatus: 'InitialSilenceTimeout' }, '你好。');
    expect(silent.score).toBe(0);
    expect(silent.char_scores.map((c) => c.error)).toEqual(['Omission', 'Omission']);
  });
  it('base64-encodes UTF-8 reference text', () => {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(assessmentHeader('银行')), (c) => c.charCodeAt(0)));
    expect(JSON.parse(decoded).ReferenceText).toBe('银行');
  });
});

describe('runRecordingCheck', () => {
  let db: SqliteD1;
  let env: Env;
  const sent: unknown[] = [];

  beforeEach(async () => {
    db = await createSqliteD1();
    sent.length = 0;
    exec(db, "INSERT INTO users (id, email, name) VALUES ('stu', 's@example.com', 'S')");
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d', 'stu', 'Deck')");
    exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n', 'd', '银行', 'yínháng', 'bank')");
    exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('c', 'n', 'hanzi_to_meaning')");
    exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES ('ev', 'c', 'stu', 2, '2026-10-01T10:00:00Z', 'recordings/ev.webm')");
    env = {
      DB: db,
      AUDIO_BUCKET: bucket({ 'recordings/ev.webm': WEBM }),
      AZURE_SPEECH_KEY: 'k',
      AZURE_SPEECH_REGION: 'uksouth',
      RECORDING_CHECK_QUEUE: { send: async (m: unknown) => void sent.push(m) },
    } as unknown as Env;
  });

  const row = () => db.rows<Record<string, unknown>>('SELECT * FROM recording_checks WHERE review_event_id = ?', ['ev'])[0];
  const transcribe = (text: string) => async () => ({ text, language: 'zh', provider: 'whisper' as const, failed: [] });
  const assess = async () => parseAzureResult(AZURE_JSON, '银行');

  it('enqueues once, writing a pending row', async () => {
    await enqueueRecordingCheck(env, 'ev', 'stu');
    expect(sent).toEqual([{ eventId: 'ev' }]);
    expect(row().status).toBe('pending');
  });

  it('stores the transcript verdict and the Azure scores', async () => {
    expect(await runRecordingCheck(env, 'ev', { transcribe: transcribe('音行'), assess })).toBe('done');
    const r = row();
    expect(r.status).toBe('done');
    expect(r.transcript).toBe('音行');
    expect(r.transcript_match).toBe(0); // yīn ≠ yín
    expect(r.score).toBe(71.5);
    expect(JSON.parse(String(r.char_scores))[0]).toMatchObject({ char: '银', tone_suspect: true });
    expect(Number(r.audio_ms)).toBeGreaterThan(1900);
    expect(await runRecordingCheck(env, 'ev', { transcribe: transcribe('x'), assess })).toBe('already_done');
  });

  it('without Azure it still records the transcript, noting why there is no score', async () => {
    env = { ...env, AZURE_SPEECH_KEY: undefined } as Env;
    expect(await runRecordingCheck(env, 'ev', { transcribe: transcribe('银行') })).toBe('done');
    expect(row()).toMatchObject({ transcript_match: 1, score: null, score_note: 'not_configured' });
  });

  it('waits when the minute is full, and stops scoring when the month is spent', async () => {
    const now = new Date('2026-10-05T12:00:00Z');
    db.raw.exec('PRAGMA foreign_keys = OFF'); // rows for other recordings: no review events needed here
    for (let i = 0; i < AZURE_REQUESTS_PER_MINUTE; i++) {
      exec(db, "INSERT INTO recording_checks (review_event_id, user_id, status, scored_at, audio_ms) VALUES (?, 'stu', 'done', ?, 1000)", `other-${i}`, '2026-10-05T11:59:30.000Z');
    }
    await expect(runRecordingCheck(env, 'ev', { transcribe: transcribe('银行'), assess, now: () => now })).rejects.toBeInstanceOf(RetryLater);
    exec(db, 'UPDATE recording_checks SET scored_at = ? WHERE review_event_id != ?', '2026-10-02T00:00:00.000Z', 'ev');
    exec(db, 'UPDATE recording_checks SET audio_ms = ? WHERE review_event_id = ?', AZURE_MONTHLY_BUDGET_MS, 'other-0');
    expect(await runRecordingCheck(env, 'ev', { transcribe: transcribe('银行'), assess, now: () => now })).toBe('done');
    expect(row()).toMatchObject({ score: null, score_note: 'over_budget' });
  });

  it('an Azure 429 frees the slot and retries later; a bad key is noted, not retried', async () => {
    const limited = async () => { throw new AzureError('rate_limited', 'azure http 429'); };
    await expect(runRecordingCheck(env, 'ev', { transcribe: transcribe('银行'), assess: limited })).rejects.toBeInstanceOf(RetryLater);
    expect(row()).toMatchObject({ status: 'pending', scored_at: null, transcript: '银行' });
    const auth = async () => { throw new AzureError('auth', 'azure http 401'); };
    expect(await runRecordingCheck(env, 'ev', { transcribe: transcribe('不会用'), assess: auth })).toBe('done');
    expect(row()).toMatchObject({ status: 'done', score_note: 'azure_auth', transcript: '银行' }); // transcript kept from the first try
  });

  it('a deleted recording drops the row; missing checks are found in a range', async () => {
    expect(await enqueueMissingChecks(env, 'stu', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')).toBe(1);
    expect(await enqueueMissingChecks(env, 'stu', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')).toBe(0);
    exec(db, 'UPDATE review_events SET recording_url = NULL');
    expect(await runRecordingCheck(env, 'ev', {})).toBe('gone');
    expect(row()).toBeUndefined();
  });
});

describe('buildRecordingQueue', () => {
  const base = {
    card_id: 'c', card_type: 'hanzi_to_meaning', note_id: 'n', hanzi: '银行', pinyin: 'yínháng', english: 'bank',
    note_audio_url: 'generated/n.mp3', deck_name: 'D', reviewed_at: '2026-10-01T10:00:00Z', recording_url: 'recordings/e.webm',
    user_answer: null, mark_status: null, mark_comment: null, mark_updated_at: null, check_status: 'done',
    transcript: '银行', transcript_match: 1, score: 95, char_scores: '[]', score_note: null,
  } as const;
  it('splits the queue from the rest and explains each item', () => {
    const items = buildRecordingQueue(
      [
        { ...base, event_id: 'clean', rating: 2 },
        { ...base, event_id: 'heard', rating: 2, transcript: '音响', transcript_match: 0 },
        { ...base, event_id: 'marked', rating: 0, mark_status: 'listened', mark_updated_at: 'x' },
        { ...base, event_id: 'flagged', rating: 3, note_id: 'n2' },
        { ...base, event_id: 'unchecked', rating: 1, check_status: null },
      ],
      [{ id: 'f', note_id: 'n2', card_id: null, message: 'tones?', created_at: 'x' }]
    );
    expect(items.filter((i) => i.in_queue).map((i) => i.event_id)).toEqual(['heard', 'flagged', 'unchecked']);
    expect(items.find((i) => i.event_id === 'heard')!.labels).toEqual(['Heard: 音响']);
    expect(items.find((i) => i.event_id === 'flagged')!.flag?.message).toBe('tones?');
    expect(items.find((i) => i.event_id === 'unchecked')!.check).toBeNull();
  });
});
