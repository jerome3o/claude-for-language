/**
 * Video calls round 2: keeping a call alive through a bad connection (shared/calls/connection.ts).
 * Writes calls-connection.json; checked by core/…/calls/CallsConnectionParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAMERA_HALF_BELOW_BPS,
  CAMERA_MAX_BITRATE,
  CAMERA_QUARTER_BELOW_BPS,
  DISCONNECT_GRACE_MS,
  MAX_COMPOSE_CHARS,
  MAX_DIAG_EVENTS,
  MAX_DIAG_EVENTS_PER_MESSAGE,
  MAX_RESTART_BACKOFF_MS,
  PEER_AWAY_GRACE_MS,
  ROOM_PING_MS,
  ROOM_PONG_TIMEOUT_MS,
  SCREEN_MAX_BITRATE,
  appendDiag,
  initialLinkHealth,
  linkHealthOn,
  nextIceRestartAt,
  newInstanceId,
  restartBackoffMs,
  sanitizeCompose,
  sanitizeDiagEvents,
  sanitizeInstance,
  shouldAdoptPeer,
  linkSignalAction,
  linkWorthKeeping,
  newLinkId,
  tileStatus,
  videoEncodingFor,
  type CallDiagEntry,
  type LinkEvent,
  type PcState,
} from '../../../shared/calls/connection';

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
const r = rng(20260930);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const constants = {
  DISCONNECT_GRACE_MS, PEER_AWAY_GRACE_MS, MAX_RESTART_BACKOFF_MS, ROOM_PING_MS, ROOM_PONG_TIMEOUT_MS,
  CAMERA_MAX_BITRATE, SCREEN_MAX_BITRATE, CAMERA_HALF_BELOW_BPS, CAMERA_QUARTER_BELOW_BPS,
  MAX_DIAG_EVENTS_PER_MESSAGE, MAX_DIAG_EVENTS, MAX_COMPOSE_CHARS,
};

// ---- link health: sequences of events, the state and decisions after each
const states: PcState[] = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'];
const sequences: unknown[] = [];
const scripted: LinkEvent[][] = [
  // connect, drop, heal
  [{ type: 'pc', state: 'connecting', at: 1000 }, { type: 'pc', state: 'connected', at: 1800 }, { type: 'pc', state: 'disconnected', at: 60_000 }, { type: 'pc', state: 'connected', at: 61_000 }],
  // drop → restart → stuck connecting → restart again → failed → connected
  [
    { type: 'pc', state: 'connected', at: 500 }, { type: 'pc', state: 'disconnected', at: 10_000 }, { type: 'restarted', at: 12_500 },
    { type: 'pc', state: 'connecting', at: 12_600 }, { type: 'restarted', at: 17_000 }, { type: 'pc', state: 'failed', at: 20_000 },
    { type: 'restarted', at: 20_000 }, { type: 'restarted', at: 28_000 }, { type: 'restarted', at: 44_000 }, { type: 'pc', state: 'connected', at: 45_000 },
  ],
  // never connects
  [{ type: 'pc', state: 'connecting', at: 10 }, { type: 'pc', state: 'failed', at: 30_000 }, { type: 'restarted', at: 30_000 }, { type: 'pc', state: 'disconnected', at: 31_000 }],
  // repeated identical states are no-ops
  [{ type: 'pc', state: 'new', at: 5 }, { type: 'pc', state: 'disconnected', at: 7 }, { type: 'pc', state: 'disconnected', at: 99 }],
];
for (let i = 0; i < 120; i++) {
  const n = 1 + Math.floor(r() * 14);
  let at = Math.floor(r() * 5000);
  const evs: LinkEvent[] = [];
  for (let k = 0; k < n; k++) {
    at += Math.floor(r() * pick([100, 3000, 20_000]));
    evs.push(r() < 0.25 ? { type: 'restarted', at } : { type: 'pc', state: pick(states), at });
  }
  scripted.push(evs);
}
for (const evs of scripted) {
  const start = 0;
  let h = initialLinkHealth(start);
  const steps: unknown[] = [];
  for (const e of evs) {
    h = linkHealthOn(h, e);
    steps.push({
      event: e,
      health: h,
      next_open: nextIceRestartAt(h, true),
      next_closed: nextIceRestartAt(h, false),
      tile: tileStatus(h, false),
      tile_away: tileStatus(h, true),
    });
  }
  sequences.push({ start, initial: initialLinkHealth(start), steps });
}

const backoff = Array.from({ length: 44 }, (_, i) => i - 3).map((n) => ({ n, ms: restartBackoffMs(n) }));

// ---- adopt
const adopt: unknown[] = [];
const currents = [null, { user_id: 'u1' }, { user_id: 'u1', instance: 'abc123' }, { user_id: 'u2', instance: 'abc123' }, { user_id: 'u1', instance: '' }];
const incomings = [{ user_id: 'u1' }, { user_id: 'u1', instance: 'abc123' }, { user_id: 'u1', instance: 'zzz999' }, { user_id: 'u2', instance: 'abc123' }, { user_id: 'u1', instance: '' }];
for (const c of currents) for (const i of incomings) adopt.push({ current: c, incoming: i, adopt: shouldAdoptPeer(c, i) });
// Round 4: a failed / closed / never-started link is never adopted (renegotiated instead).
const adoptPc: unknown[] = [];
for (const c of currents) for (const i of incomings) for (const pc of states) adoptPc.push({ current: c, incoming: i, pc, adopt: shouldAdoptPeer(c, i, pc) });
const worth = states.map((pc) => ({ pc, keep: linkWorthKeeping(pc) }));

// ---- round 4: link ids on signals
const linkIds = [undefined, 'L1', 'L2', 'L3', ''];
const bounds = [null, 'L1', 'L2'];
const retireds = [[], ['L1'], ['L1', 'L3'], ['L2']];
const linkActions: unknown[] = [];
for (const bound of bounds) for (const retired of retireds) for (const incoming of linkIds) {
  linkActions.push({ bound, retired, incoming: incoming ?? null, action: linkSignalAction(bound, retired, incoming) });
}
const linkGenerated = Array.from({ length: 20 }, () => newLinkId());

// ---- instances
const instanceInputs: unknown[] = ['abc1', 'abc', 'ABCdef123', 'a'.repeat(32), 'a'.repeat(33), 'ab-12', 'ab 12', '', 'κλμν', '１２３４', 12345, null, true];
const instances = instanceInputs.map((raw) => ({ raw, out: sanitizeInstance(raw) ?? null }));
const generated = Array.from({ length: 20 }, () => newInstanceId());

// ---- encodings
const bitrates: (number | null)[] = [null, 0, 50_000, 179_999, 180_000, 180_001, 269_999, 270_000, 300_000, 349_999, 350_000, 400_000, 524_999, 525_000, 900_000, 2_500_000];
const scales = [1, 2, 3, 4, 0.5, 8];
const encodings: unknown[] = [];
for (const source of ['camera', 'screen'] as const) {
  for (const bps of bitrates) for (const scale of scales) encodings.push({ source, bps, scale, enc: videoEncodingFor(source, bps, scale) });
  encodings.push({ source, bps: 200_000, scale: null, enc: videoEncodingFor(source, 200_000) });
}
for (let i = 0; i < 200; i++) {
  const bps = r() < 0.1 ? null : Math.round(r() * 1_000_000 * 10) / 10;
  const scale = pick([1, 2, 4]);
  encodings.push({ source: 'camera', bps, scale, enc: videoEncodingFor('camera', bps, scale) });
}

// ---- diag sanitising
const long = 'x'.repeat(250);
const diagInputs: unknown[] = [
  null, 'nope', 42, {},
  [],
  [{ t: 1_790_000_000_000, kind: 'pc', detail: 'connected' }],
  [
    { t: 1_790_000_000_000.4, kind: 'ice', detail: 'checking\r\n→ connected' },
    { t: 1_790_000_000_000.5, kind: 'room', detail: 'open' },
    { t: '1790000000123', kind: 'route', detail: 'relay/udp via turn' },
    { t: ' 17 ', kind: 'media', detail: 'mic denied' },
    { t: '0x1F', kind: 'peer', detail: 'away' },
    { t: '', kind: 'pc', detail: 'empty t' },
    { t: 'soon', kind: 'pc', detail: 'NaN t' },
    { t: 0, kind: 'pc' },
    { t: -5, kind: 'pc' },
    { t: true, kind: 'join', detail: 'bool t' },
    { t: null, kind: 'pc' },
    { kind: 'pc', detail: 'no t' },
    { t: 5, kind: 'bogus', detail: 'unknown kind' },
    { t: 5, kind: 'PC' },
    { t: 5, kind: 3 },
    { t: 5, kind: 'restart', detail: 17 },
    { t: 5, kind: 'restart', detail: long },
    { t: 5, kind: 'restart', detail: '𝒳'.repeat(150) },
    { t: [7], kind: 'pc', detail: 'array t' },
    { t: [], kind: 'pc', detail: 'empty array t' },
    { t: 1e3, kind: 'pc', detail: 'exp' },
    { t: '1e3', kind: 'pc', detail: 'exp string' },
    'string event', null, 7,
  ],
  Array.from({ length: 70 }, (_, i) => ({ t: 1000 + i, kind: pick(['pc', 'ice', 'room', 'restart', 'route', 'media', 'join', 'peer']), detail: `event ${i}` })),
];
const diag = diagInputs.map((raw) => ({ raw, out: sanitizeDiagEvents(raw) }));

// ---- appendDiag
const append: unknown[] = [];
const entry = (t: number, i: number): CallDiagEntry => ({ t, kind: 'pc', detail: `d${i}`, user_id: `u${i % 2}`, name: `N${i % 2}` });
for (let c = 0; c < 12; c++) {
  const a = Array.from({ length: Math.floor(r() * pick([5, 400, 700])) }, (_, i) => entry(Math.floor(r() * 1000), i));
  const b = Array.from({ length: Math.floor(r() * pick([3, 50, 300])) }, (_, i) => entry(Math.floor(r() * 1000), 10_000 + i));
  append.push({ log: a, add: b, out: appendDiag(a, b) });
}

// ---- compose
const composeInputs: unknown[] = [
  'ni', 'nihao', '你hao', '  ', '', '\t\n', 'a\r\nb\tc', 'x'.repeat(50), '你'.repeat(45), '😀'.repeat(45), ' 你 ', '　', '﻿', 'a　b',
  null, 12, true,
];
const compose = composeInputs.map((raw) => ({ raw, out: sanitizeCompose(raw) }));

writeFileSync(
  join(OUT, 'calls-connection.json'),
  JSON.stringify({ constants, sequences, backoff, adopt, adoptPc, worth, linkActions, linkGenerated, instances, generated, encodings, diag, append, compose }),
);
