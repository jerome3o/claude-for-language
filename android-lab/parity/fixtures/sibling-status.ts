/**
 * The ⋯ menu's other-card tiles, golden vectors from the web app's own TypeScript
 * (shared/decks/sibling-status.ts): every status (not started, new in today's queue, learning,
 * due, review, known, suspended, snoozed, leech), the strength tier, the line, the tone and what
 * the small sheet offers — over seeded notes around the 4 am study-day cutoff, with holds
 * (active / ended), today's-study membership and the homework pass's no-⚡. Writes
 * sibling-status.json; core SiblingStatusParityTest asserts the Kotlin port matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  missingSiblingTypes, nextInLabel, siblingBumpedMessage, siblingBumpLabel, siblingStrength, siblingTileLabel, siblingTiles,
  type SiblingCardInput,
} from '../../../shared/decks/sibling-status';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sibling-status <out-dir>');
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
const rand = rng(20261117);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const subset = <T,>(xs: readonly T[]): T[] => xs.filter(() => rand() < 0.5);

const H = 3_600_000;
const DAY = 24 * H;
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const TODAY = '2026-11-17';
const HOLD_UNTILS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-24', '2026-12-17', '2027-01-03', 'bogus'];

const tiles: unknown[] = [];
for (let i = 0; i < 500; i++) {
  // The study day of 17 Nov ends at 04:00 on the 18th (London, GMT); sometimes "now + 1 h" is later.
  const cutoff = Date.parse('2026-11-18T03:59:59.999Z') + (rand() < 0.2 ? int(1, 3) * H : 0);
  const types = rand() < 0.2 ? subset(TYPES) : [...TYPES];
  if (types.length === 0) types.push(pick(TYPES));
  const cards: SiblingCardInput[] = types.map((t, k) => {
    const queue = pick([0, 0, 1, 2, 2, 2, 3]);
    const due = queue === 0 ? null : rand() < 0.08 ? null : cutoff + int(-3 * 24, 500 * 24) * H + int(-59, 59) * 60_000;
    const stability = queue === 0 ? 0 : pick([0, 0.5, 3, 7, 7.2, 15, 21, 21.01, 40, 200, -1]);
    const lapses = queue === 0 ? 0 : pick([0, 0, 1, 3, 7, 8, 12]);
    return { id: `c${i}-${k}`, card_type: t, queue, due_ms: due, stability: stability < 0 ? null : stability, lapses };
  });
  if (rand() < 0.3) cards.reverse();
  const current = pick(cards).id;
  const holds: Array<{ card_id: string; kind: string; until: string | null }> = [];
  for (const c of cards) {
    if (rand() < 0.2) {
      const kind = rand() < 0.4 ? 'suspend' : 'snooze';
      holds.push({ card_id: c.id, kind, until: kind === 'suspend' || rand() < 0.1 ? null : pick(HOLD_UNTILS) });
    }
  }
  const inToday = subset(cards.map(c => c.id));
  const canBump = rand() < 0.85;
  const inSession = i % 2 === 0;
  const r = siblingTiles(cards, current, {
    cutoffMs: cutoff,
    today: TODAY,
    holds: new Map(holds.map(h => [h.card_id, { kind: h.kind as 'suspend' | 'snooze', until: h.until }])),
    inToday: new Set(inToday),
    canBump,
  });
  tiles.push({
    cutoff, today: TODAY, cards, current, holds, inToday, canBump, in_session: inSession,
    tiles: r.map(t => ({ ...t, label: siblingTileLabel(t), bump_label: siblingBumpLabel(t.bump), message: siblingBumpedMessage(t, inSession) })),
    missing: missingSiblingTypes(cards.map(c => c.card_type), cards.find(c => c.id === current)!.card_type),
  });
}

const next: unknown[] = [];
const base = Date.parse('2026-11-18T03:59:59.999Z');
for (const d of [-DAY, -1, 0, 1, DAY - 1, DAY, DAY + 1, 11 * DAY + 5 * H, 59 * DAY, 59 * DAY + 1, 60 * DAY, 75 * DAY, 364 * DAY, 365 * DAY, 547 * DAY, 900 * DAY]) {
  next.push({ due: base + d, cutoff: base, label: nextInLabel(base + d, base) });
}
const strengths: unknown[] = [];
for (const q of [0, 1, 2, 3]) for (const s of [null, 0, 7, 7.0001, 21, 21.0001, 100]) strengths.push({ queue: q, stability: s, strength: siblingStrength(q, s) });

writeFileSync(join(OUT, 'sibling-status.json'), JSON.stringify({ tiles, next, strengths }));
console.log(`sibling-status: ${tiles.length} notes`);
