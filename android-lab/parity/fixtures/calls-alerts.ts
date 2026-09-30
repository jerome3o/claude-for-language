/**
 * Package J golden vectors: which live call to announce and when to ring
 * (shared/calls/alerts.ts). Writes calls-alerts.json; checked by
 * core/…/calls/CallsAlertsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { callIdFromPath, callToRing, parseCallTime, pickCallBanner, type LiveCallLike } from '../../../shared/calls/alerts';

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
const r = rng(20260929);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const NOW = Date.parse('2026-09-28T10:00:00Z');
const sql = (msAgo: number) => new Date(NOW - msAgo).toISOString().replace('T', ' ').slice(0, 19);
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ages = [0, 5_000, 60_000, 119_000, 121_000, 600_000, 3 * 3600_000, 4 * 3600_000, 4 * 3600_000 + 1000, -30_000, -200_000];

const times = [
  '2026-09-28 10:00:00', '2026-09-28 10:00', '2026-09-28 09:58:30.5', '2026-09-28T10:00:00Z', '2026-09-28T10:00:00.123Z',
  'garbage', '', '2026-13-40 99:99:99',
];
const paths = ['/', '/decks', '/calls/c1', '/calls/c1/', '/calls/c1/review', '/calls', '/connections/rel-1', '/calls/c%2F2'];

function randomCall(i: number): LiveCallLike {
  const age = pick(ages);
  return {
    id: pick(['c1', 'c2', 'c3', `c${i}`, 'a', 'b']),
    relationship_id: pick(['rel-1', 'rel-2', null]),
    created_by: pick(['me', 'tutor', 'student']),
    status: pick(['live', 'live', 'live', 'ended']),
    created_at: r() < 0.05 ? 'garbage' : r() < 0.3 ? iso(age) : sql(age),
    other_user_name: pick(['王老师', 'Minghui', null, '  ', ' Jerome ']),
    // Presence from the room: unknown (older server), nobody, the partner, me, both.
    ...(r() < 0.3 ? {} : { present_user_ids: pick([[], ['tutor'], ['me'], ['me', 'tutor'], ['student'], ['tutor', 'student']]) }),
  };
}

const banners: unknown[] = [];
const rings: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const calls = Array.from({ length: Math.floor(r() * 5) }, (_, k) => randomCall(i * 10 + k));
  const path = pick(paths);
  const dismissed = r() < 0.3 ? [pick(['c1', 'c2', 'a'])] : [];
  const relationshipId = pick([undefined, undefined, 'rel-1', 'rel-2']);
  const includeTest = r() < 0.3;
  banners.push({
    calls, path, dismissed, relationship_id: relationshipId ?? null, include_test: includeTest,
    result: pickCallBanner(calls, { myUserId: 'me', path, now: NOW, dismissed, relationshipId, includeTest }),
  });
  const rung = r() < 0.3 ? [pick(['c1', 'c2', 'b'])] : [];
  const mode = r() < 0.15 ? 'silent' : 'ring';
  const ring = callToRing(calls, { myUserId: 'me', now: NOW, rung, mode, path });
  rings.push({ calls, path, rung, silent: mode === 'silent', result: ring ? ring.id : null });
}

writeFileSync(
  join(OUT, 'calls-alerts.json'),
  JSON.stringify({
    now: NOW,
    times: times.map((t) => ({ value: t, ms: Number.isFinite(parseCallTime(t)) ? parseCallTime(t) : null })),
    paths: paths.map((p) => ({ path: p, id: callIdFromPath(p) })),
    banners,
    rings,
  }),
);
