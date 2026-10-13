/**
 * Video calls: call sounds (shared/calls/chime.ts) — who joined / left from seeded presence event
 * sequences, the tones (sampled), the switch and the words.
 * Writes calls-chime.json; checked by core/…/calls/CallsChimeParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  callSoundsLabel,
  callSoundsOn,
  chimeLengthMs,
  chimeNeedsTick,
  chimeSample,
  chimeStep,
  joinedText,
  leftText,
  CALL_SOUNDS_KEY,
  CHIME_ATTACK_MS,
  CHIME_TONES,
  EMPTY_CHIME_STATE,
  PEER_LEAVE_GRACE_MS,
  type ChimeEvent,
  type ChimeKind,
  type ChimeState,
} from '../../../shared/calls/chime';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261012);
const int = (n: number) => Math.floor(r() * n);

const ME = 'me';
const people = [
  { user_id: 'ming', name: 'Minghui Li' },
  { user_id: 'jerome', name: '  Jerome  ' },
  { user_id: ME, name: 'Me' },
  { user_id: 'x', name: '' },
];

const runs: unknown[] = [];
for (let k = 0; k < 60; k++) {
  let state: ChimeState = EMPTY_CHIME_STATE;
  let now = int(10_000);
  let clients = 0;
  const live: Record<string, string> = {}; // user → current client id
  const steps: unknown[] = [];
  for (let i = 0; i < 16; i++) {
    now += [0, 500, 3000, 7999, 8000, 12_000, 60_000][int(7)];
    const roll = int(10);
    let event: ChimeEvent;
    if (roll === 0) {
      const here = people.filter(() => r() < 0.5).map((p) => {
        live[p.user_id] = live[p.user_id] ?? `c${++clients}`;
        return { client_id: live[p.user_id], ...p };
      });
      event = { type: 'welcome', peers: here };
    } else if (roll <= 4) {
      const p = people[int(people.length)];
      live[p.user_id] = `c${++clients}`;
      event = { type: 'joined', peer: { client_id: live[p.user_id], ...p } };
    } else if (roll <= 7) {
      const ids = Object.values(live);
      event = { type: 'left', client_id: ids.length && r() < 0.85 ? ids[int(ids.length)] : 'nobody' };
    } else {
      event = { type: 'tick' };
    }
    const res = chimeStep(state, event, ME, now);
    state = res.state;
    steps.push({ now, event, alerts: res.alerts, state, needs_tick: chimeNeedsTick(state) });
  }
  runs.push({ steps });
}

const kinds: ChimeKind[] = ['join', 'leave', 'timer'];
const samples = kinds.map((kind) => ({
  kind,
  length: chimeLengthMs(kind),
  at: [-1, 0, 0.5, 5, 11.9, 12, 13, 100, 139.9, 140, 141, 300, 379.9, 380, 500, 659, 660, 700, 1000, 1619, 1620, 2000].map((t) => ({ t, v: chimeSample(kind, t) })),
}));

writeFileSync(
  join(OUT, 'calls-chime.json'),
  JSON.stringify({
    constants: { PEER_LEAVE_GRACE_MS, CHIME_ATTACK_MS, CALL_SOUNDS_KEY, CHIME_TONES },
    runs,
    samples,
    sounds: [null, 'on', 'off', 'OFF', ''].map((stored) => ({ stored, on: callSoundsOn(stored) })),
    labels: [true, false].map((on) => ({ on, label: callSoundsLabel(on) })),
    texts: ['Minghui Li', '  明慧 ', '', 'a\tb'].map((name) => ({ name, joined: joinedText(name), left: leftText(name) })),
  }, null, 1),
);
