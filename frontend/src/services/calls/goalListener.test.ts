import { describe, expect, it } from 'vitest';
import { CallGoalListener, MAX_FAILURES, ROTATE_BEFORE_EXPIRY_MS } from './goalListener';

class FakeSocket {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  constructor(public url: string, public protocols?: string[]) {}
  send(d: unknown) { this.sent.push(d); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  msg(tokens: Array<[string, boolean]>, finished = false) {
    this.onmessage?.({ data: JSON.stringify({ tokens: tokens.map(([text, is_final]) => ({ text, is_final })), ...(finished ? { finished: true } : {}) }) } as MessageEvent);
  }
}
class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((ev: BlobEvent) => unknown) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  chunk() { this.ondataavailable?.({ data: new Blob(['x']) } as BlobEvent); }
}

function harness(session: () => unknown = () => ({ provider: 'soniox', api_key: 'snx_temp_k', expires_at: new Date(1_000_000 + 30 * 60_000).toISOString(), websocket_url: 'wss://x', model: 'm', language_hints: ['zh', 'en'] })) {
  const sockets: FakeSocket[] = [];
  const recorders: FakeRecorder[] = [];
  const timers: Array<{ fn: () => void; ms: number; done: boolean }> = [];
  const heard: string[] = [];
  const states: string[] = [];
  const l = new CallGoalListener({
    getSession: async () => session() as never,
    onUtterance: (t) => heard.push(t),
    onState: (s) => states.push(s),
    createSocket: (url, protocols) => { const s = new FakeSocket(url, protocols); sockets.push(s); return s as never; },
    createRecorder: () => { const r = new FakeRecorder(); recorders.push(r); return r as never; },
    now: () => 1_000_000,
    setTimer: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { done: boolean }).done = true; },
  });
  const fire = (ms?: number) => {
    const t = timers.find((x) => !x.done && (ms === undefined || x.ms === ms));
    if (!t) throw new Error(`no timer ${ms}`);
    t.done = true;
    t.fn();
  };
  return { l, sockets, recorders, timers, heard, states, fire };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('CallGoalListener', () => {
  it('streams with endpoint detection and hands back finished utterances', async () => {
    const h = harness();
    h.l.start({} as MediaStreamTrack);
    await tick();
    const s = h.sockets[0];
    expect(s.protocols).toEqual(['soniox-api-key', 'snx_temp_k']);
    h.recorders[0].chunk(); // queued until open
    s.open();
    expect(JSON.parse(s.sent[0] as string)).toMatchObject({ enable_endpoint_detection: true, audio_format: 'auto' });
    expect(s.sent).toHaveLength(2);
    expect(h.states.at(-1)).toBe('listening');
    s.msg([['除了中文', true], ['我还学', false]]);
    s.msg([['我还学日语', true], ['<end>', true]]);
    expect(h.heard).toEqual(['除了中文我还学日语']);
  });

  it('rotates to a fresh key before the old one runs out, ending the old segment once the new one streams', async () => {
    const h = harness();
    h.l.start({} as MediaStreamTrack);
    await tick();
    h.sockets[0].open();
    h.sockets[0].msg([['一到家', true]]);
    const rotate = h.timers.find((t) => !t.done)!;
    expect(rotate.ms).toBe(Math.min(25 * 60_000, 30 * 60_000 - ROTATE_BEFORE_EXPIRY_MS));
    h.fire(rotate.ms);
    await tick();
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[0].closed).toBe(false); // still streaming until the new one opens
    h.sockets[1].open();
    expect(h.sockets[0].sent.at(-1)).toBe(''); // end of audio
    expect(h.recorders[0].state).toBe('inactive');
    h.sockets[0].msg([['就睡觉了', true]], true);
    expect(h.sockets[0].closed).toBe(true);
    expect(h.heard).toEqual(['一到家就睡觉了']);
  });

  it('reconnects after a drop and gives up for a while after too many', async () => {
    const h = harness();
    h.l.start({} as MediaStreamTrack);
    await tick();
    for (let i = 0; i < MAX_FAILURES; i++) {
      h.sockets.at(-1)!.onclose?.({} as CloseEvent);
      if (i < MAX_FAILURES - 1) {
        h.fire();
        await tick();
      }
    }
    expect(h.states.at(-1)).toBe('unavailable');
  });

  it('no live provider → unavailable; stop → idle and nothing streams', async () => {
    const h = harness(() => ({ provider: 'upload' }));
    h.l.start({} as MediaStreamTrack);
    await tick();
    expect(h.states.at(-1)).toBe('unavailable');
    expect(h.sockets).toHaveLength(0);
    h.l.stop();
    expect(h.l.current).toBe('idle');
  });
});
