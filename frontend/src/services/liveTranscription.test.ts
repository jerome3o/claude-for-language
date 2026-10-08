import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLiveSession, LiveTranscriber, resetLiveSessionCache } from './liveTranscription';

const session = {
  provider: 'soniox' as const,
  api_key: 'temp:1',
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  websocket_url: 'wss://stt-rt.soniox.com/transcribe-websocket',
  model: 'stt-rt-v5',
  language_hints: ['zh', 'en'],
};

class FakeSocket {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  send(d: unknown) { this.sent.push(d); }
  close() { this.closed = true; }
  open() { this.readyState = 1; this.onopen?.(new Event('open')); }
  reply(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('LiveTranscriber', () => {
  it('queues audio until open, sends config first, ends with an empty frame, resolves on finished', async () => {
    let sock!: FakeSocket;
    const t = new LiveTranscriber(Promise.resolve(session), { createSocket: () => (sock = new FakeSocket()) });
    await tick();
    const a = new Blob(['a']);
    const b = new Blob(['b']);
    t.push(a);
    sock.open();
    t.push(b);
    sock.reply({ tokens: [{ text: '我', is_final: true }, { text: '打', is_final: false }] });
    const done = t.finish();
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ api_key: 'temp:1', model: 'stt-rt-v5', audio_format: 'auto', language_hints: ['zh', 'en'] });
    expect(sock.sent.slice(1)).toEqual([a, b, '']);
    sock.reply({ tokens: [{ text: '打算', is_final: true }, { text: '<fin>', is_final: true }] });
    sock.reply({ tokens: [], finished: true });
    await expect(done).resolves.toBe('我打算');
    expect(sock.closed).toBe(true);
  });

  it('onUpdate reports the confirmed text and the provisional tail as they arrive (the spoken answer box)', async () => {
    let sock!: FakeSocket;
    const seen: Array<[string, string]> = [];
    const t = new LiveTranscriber(Promise.resolve(session), {
      createSocket: () => (sock = new FakeSocket()),
      onUpdate: (tr) => seen.push([tr.finalText, tr.partialText]),
    });
    await tick();
    sock.open();
    sock.reply({ tokens: [{ text: '由', is_final: false }] });
    sock.reply({ tokens: [{ text: '由', is_final: true }, { text: '于', is_final: false }] });
    const done = t.finish();
    sock.reply({ tokens: [{ text: '于', is_final: true }], finished: true });
    await expect(done).resolves.toBe('由于');
    expect(seen).toEqual([['', '由'], ['由', '于'], ['由于', '']]);
  });

  it('finish before the socket opens still flushes and ends', async () => {
    let sock!: FakeSocket;
    const t = new LiveTranscriber(Promise.resolve(session), { createSocket: () => (sock = new FakeSocket()) });
    await tick();
    t.push(new Blob(['x']));
    const done = t.finish();
    sock.open();
    expect(sock.sent.at(-1)).toBe('');
    sock.reply({ tokens: [{ text: '你好', is_final: true }], finished: true });
    await expect(done).resolves.toBe('你好');
  });

  it('rejects (→ upload fallback) on a server error, no session, or a timeout', async () => {
    let sock!: FakeSocket;
    const t = new LiveTranscriber(Promise.resolve(session), { createSocket: () => (sock = new FakeSocket()) });
    await tick();
    sock.open();
    sock.reply({ error_code: 401, error_message: 'Invalid API key' });
    await expect(t.finish()).rejects.toThrow('Soniox 401');

    const none = new LiveTranscriber(Promise.resolve(null));
    await tick();
    await expect(none.finish()).rejects.toThrow('no live session');

    vi.useFakeTimers();
    const slow = new LiveTranscriber(Promise.resolve(session), { createSocket: () => new FakeSocket(), finishTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(1);
    const p = slow.finish();
    const check = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(150);
    await check;
    vi.useRealTimers();
  });

  it('a socket closing after end-of-audio yields what was final', async () => {
    let sock!: FakeSocket;
    const t = new LiveTranscriber(Promise.resolve(session), { createSocket: () => (sock = new FakeSocket()) });
    await tick();
    sock.open();
    sock.reply({ tokens: [{ text: '谢谢', is_final: true }] });
    const done = t.finish();
    sock.onclose?.({} as CloseEvent);
    await expect(done).resolves.toBe('谢谢');
  });
});

describe('getLiveSession', () => {
  beforeEach(() => resetLiveSessionCache());

  it('mints once and reuses the key', async () => {
    const fetchSession = vi.fn(async () => session);
    expect(await getLiveSession(fetchSession)).toEqual(session);
    expect(await getLiveSession(fetchSession)).toEqual(session);
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it('no provider configured → null (upload path), remembered', async () => {
    const fetchSession = vi.fn(async () => ({ provider: 'upload' as const }));
    expect(await getLiveSession(fetchSession)).toBeNull();
    expect(await getLiveSession(fetchSession)).toBeNull();
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it('a failed mint backs off instead of retrying every take', async () => {
    const fetchSession = vi.fn(async () => { throw new Error('502'); });
    expect(await getLiveSession(fetchSession)).toBeNull();
    expect(await getLiveSession(fetchSession)).toBeNull();
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });
});
