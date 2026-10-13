import { describe, expect, it } from 'vitest';
import {
  callSoundsLabel,
  callSoundsOn,
  chimeLengthMs,
  chimeNeedsTick,
  chimeSample,
  chimeStep,
  EMPTY_CHIME_STATE,
  PEER_LEAVE_GRACE_MS,
  type ChimeEvent,
  type ChimeState,
} from './chime';

const ME = 'jerome';
const ming = (client_id: string) => ({ client_id, user_id: 'ming', name: 'Minghui Li' });

/** Run events (with their times) and collect the alert texts. */
function run(events: Array<[number, ChimeEvent]>, start: ChimeState = EMPTY_CHIME_STATE): { state: ChimeState; texts: string[] } {
  let state = start;
  const texts: string[] = [];
  for (const [at, e] of events) {
    const r = chimeStep(state, e, ME, at);
    state = r.state;
    texts.push(...r.alerts.map((a) => `${a.kind}:${a.text}`));
  }
  return { state, texts };
}

describe('call sounds: who joined / left', () => {
  it('the other person entering chimes; my own join (welcome) never does', () => {
    expect(run([[0, { type: 'welcome', peers: [ming('c1')] }]]).texts).toEqual([]);
    expect(run([[0, { type: 'welcome', peers: [] }], [5, { type: 'joined', peer: ming('c1') }]]).texts).toEqual(['join:Minghui joined']);
    // My own user id (another device of mine) never chimes.
    expect(run([[0, { type: 'joined', peer: { client_id: 'x', user_id: ME, name: 'Jerome' } }]]).texts).toEqual([]);
  });

  it('a reconnect of theirs (left, back within the grace) is silent', () => {
    const r = run([
      [0, { type: 'welcome', peers: [ming('c1')] }],
      [1000, { type: 'left', client_id: 'c1' }],
      [3000, { type: 'tick' }],
      [4000, { type: 'joined', peer: ming('c2') }],
      [20_000, { type: 'tick' }],
    ]);
    expect(r.texts).toEqual([]);
    expect(chimeNeedsTick(r.state)).toBe(false);
  });

  it('a leave is announced after the grace; their return after it is announced again', () => {
    const r = run([
      [0, { type: 'welcome', peers: [ming('c1')] }],
      [1000, { type: 'left', client_id: 'c1' }],
      [1000 + PEER_LEAVE_GRACE_MS - 1, { type: 'tick' }],
      [1000 + PEER_LEAVE_GRACE_MS, { type: 'tick' }],
      [1000 + PEER_LEAVE_GRACE_MS + 5, { type: 'tick' }],
      [60_000, { type: 'joined', peer: ming('c3') }],
    ]);
    expect(r.texts).toEqual(['leave:Minghui left', 'join:Minghui joined']);
  });

  it('a socket replaced while still here (the same person, a new page) is silent', () => {
    expect(run([[0, { type: 'welcome', peers: [ming('c1')] }], [10, { type: 'joined', peer: ming('c2') }]]).texts).toEqual([]);
  });

  it('a left for a socket I never knew, or an old one, changes nothing', () => {
    const r = run([[0, { type: 'welcome', peers: [ming('c1')] }], [10, { type: 'joined', peer: ming('c2') }], [20, { type: 'left', client_id: 'c1' }], [60_000, { type: 'tick' }]]);
    expect(r.texts).toEqual([]);
  });

  it('they left while my own connection was down: my rejoin notices', () => {
    const r = run([[0, { type: 'welcome', peers: [ming('c1')] }], [1000, { type: 'welcome', peers: [] }], [1000 + PEER_LEAVE_GRACE_MS, { type: 'tick' }]]);
    expect(r.texts).toEqual(['leave:Minghui left']);
  });

  it('needs a tick only while a leave is pending', () => {
    let s = run([[0, { type: 'welcome', peers: [ming('c1')] }]]).state;
    expect(chimeNeedsTick(s)).toBe(false);
    s = chimeStep(s, { type: 'left', client_id: 'c1' }, ME, 5).state;
    expect(chimeNeedsTick(s)).toBe(true);
  });
});

describe('call sounds: the tones and the switch', () => {
  it('soft, short, silent outside their notes', () => {
    expect(chimeSample('join', -1)).toBe(0);
    expect(chimeSample('join', chimeLengthMs('join') + 1)).toBe(0);
    expect(chimeLengthMs('join')).toBe(660);
    expect(chimeLengthMs('leave')).toBe(680);
    expect(chimeLengthMs('timer')).toBe(1620);
    for (const kind of ['join', 'leave', 'timer'] as const) {
      let peak = 0;
      for (let t = 0; t < chimeLengthMs(kind); t += 0.5) peak = Math.max(peak, Math.abs(chimeSample(kind, t)));
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThan(0.5);
    }
  });

  it('on unless switched off on this device', () => {
    expect(callSoundsOn(null)).toBe(true);
    expect(callSoundsOn('on')).toBe(true);
    expect(callSoundsOn('off')).toBe(false);
    expect(callSoundsLabel(true)).toBe('🔔 Call sounds: on');
    expect(callSoundsLabel(false)).toBe('🔕 Call sounds: off');
  });
});
