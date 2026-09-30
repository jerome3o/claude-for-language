/**
 * The bug (30 Sep 2026): on a read card the take's live Soniox stream gave nothing AND the
 * Whisper upload failed (500), so "Transcribing…" disappeared and NOTHING showed. These
 * tests pin every branch, the failing one first; the last one drives the real LiveTranscriber
 * with a Soniox socket that refuses the take.
 */
import { describe, expect, it, vi } from 'vitest';
import { transcribeTakeOutcome } from './takeTranscription';
import { LiveTranscriber } from './liveTranscription';

const online = () => true;
const offline = () => false;

describe('transcribeTakeOutcome', () => {
  it('live failed + upload failed → a visible failure (not nothing), with both reasons', async () => {
    const upload = vi.fn(async () => { throw new Error('Transcription failed'); });
    const out = await transcribeTakeOutcome({ live: Promise.reject(new Error('timeout')), upload, isOnline: online });
    expect(out).toEqual({ kind: 'failed', liveError: 'timeout', reason: 'Transcription failed' });
    // The live reason went up with the upload, so the server logs it.
    expect(upload).toHaveBeenCalledWith('timeout');
  });

  it('live text wins and nothing is uploaded', async () => {
    const upload = vi.fn();
    const out = await transcribeTakeOutcome({ live: Promise.resolve('谢谢'), upload, isOnline: online });
    expect(out).toMatchObject({ kind: 'done', text: '谢谢', via: 'live', liveError: null });
    expect(upload).not.toHaveBeenCalled();
  });

  it('empty live text → the upload, told why', async () => {
    const upload = vi.fn(async () => ({ text: '你好', language: 'zh', provider: 'soniox' }));
    const out = await transcribeTakeOutcome({ live: Promise.resolve('  '), upload, isOnline: online });
    expect(out).toMatchObject({ kind: 'done', text: '你好', via: 'upload', liveError: 'live returned no text' });
    expect(upload).toHaveBeenCalledWith('live returned no text');
  });

  it('not streamed → straight to the upload', async () => {
    const upload = vi.fn(async () => ({ text: '好', language: 'zh' }));
    expect(await transcribeTakeOutcome({ live: null, upload, isOnline: online })).toMatchObject({ kind: 'done', via: 'upload', liveError: null });
    expect(upload).toHaveBeenCalledWith(null);
  });

  it('offline: "will transcribe when online", whether or not live was tried', async () => {
    const upload = vi.fn();
    expect(await transcribeTakeOutcome({ live: null, upload, isOnline: offline })).toEqual({ kind: 'offline', liveError: null });
    expect(await transcribeTakeOutcome({ live: Promise.reject(new Error('socket error')), upload, isOnline: offline })).toEqual({ kind: 'offline', liveError: 'socket error' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('with the real LiveTranscriber: Soniox refuses the take (402), the upload fails → failed with the Soniox reason', async () => {
    type Sock = { readyState: number; onopen: ((e: Event) => unknown) | null; onmessage: ((e: MessageEvent) => unknown) | null; onerror: ((e: Event) => unknown) | null; onclose: ((e: CloseEvent) => unknown) | null; send: (d: unknown) => void; close: () => void };
    let sock!: Sock;
    const session = { provider: 'soniox' as const, api_key: 'temp:1', expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), websocket_url: 'wss://x', model: 'stt-rt-v5', language_hints: ['zh', 'en'] };
    const t = new LiveTranscriber(Promise.resolve(session), {
      createSocket: () => (sock = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null, send: () => {}, close: () => {} }),
    });
    await new Promise((r) => setTimeout(r, 0));
    sock.readyState = 1;
    sock.onopen?.(new Event('open'));
    t.push(new Blob(['audio']));
    sock.onmessage?.({ data: JSON.stringify({ tokens: [], error_code: 402, error_type: 'organization_balance_exhausted', error_message: 'Balance exhausted' }) } as MessageEvent);
    const upload = vi.fn(async () => { throw new Error('Transcription failed'); });
    const out = await transcribeTakeOutcome({ live: t.finish(), upload, isOnline: online });
    expect(out).toEqual({ kind: 'failed', liveError: 'Soniox 402: Balance exhausted', reason: 'Transcription failed' });
  });
});
