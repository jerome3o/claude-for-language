/**
 * "Practise this word other ways…" golden vectors, from the web app's own TypeScript
 * (shared/decks/other-card-types.ts + the card-level bump helpers in shared/decks/bumps.ts):
 * the sheet's rows (labels, states, actions, default tick), the copy, the merge of a card-level
 * request into an active bump, and the sibling spacing of pickBumpedCard — over seeded notes in
 * every state (new, learning / review due today or later, no due date, already in today, a
 * whole-note bump). Writes other-card-types.json; core OtherCardTypesParityTest asserts the
 * Kotlin ports match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultOtherCardPicks, dueInLabel, otherCardTypeRows, otherCardsAddedMessage, otherCardsButtonLabel, otherCardTypesProp,
} from '../../../shared/decks/other-card-types';
import { mergeBumpCardTypes, pickBumpedCard } from '../../../shared/decks/bumps';
import type { QueueCardInput } from '../../../shared/decks/study-queue';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: other-card-types <out-dir>');
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
const rand = rng(20261022);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const subset = <T,>(xs: readonly T[]): T[] => xs.filter(() => rand() < 0.5);

const H = 3_600_000;
const DAY = 24 * H;
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];

// The sheet's rows.
const rows: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const cutoff = Date.parse('2026-10-22T22:59:59.999Z') + int(-3, 3) * DAY;
  const types = rand() < 0.15 ? subset(TYPES) : [...TYPES];
  if (types.length === 0) types.push(pick(TYPES));
  const cards: QueueCardInput[] = types.map((t, k) => {
    const queue = pick([0, 0, 1, 2, 2, 3]);
    const due = queue === 0 ? null : rand() < 0.1 ? null : cutoff + int(-5 * 24, 40 * 24) * H + int(0, 59) * 60_000;
    return { id: `c${i}-${k}`, note_id: `n${i}`, deck_id: 'd', card_type: t, queue, due_ms: due };
  });
  if (rand() < 0.3) cards.reverse();
  const current = pick(cards).id;
  const inToday = subset(cards.map(c => c.id));
  const whole = rand() < 0.15;
  const r = otherCardTypeRows(cards, current, cutoff, new Set(inToday), whole);
  rows.push({ cutoff, cards, current, inToday, whole, rows: r, picks: defaultOtherCardPicks(r) });
}

// Due labels at the day boundaries.
const due: unknown[] = [];
const base = Date.parse('2026-10-22T22:59:59.999Z');
for (const d of [-DAY, -1, 0, 1, DAY - 1, DAY, DAY + 1, 2 * DAY, 11 * DAY + 5 * H, 40 * DAY]) {
  due.push({ due: base + d, cutoff: base, label: dueInLabel(base + d, base) });
}

// Copy.
const LABELS = ['Read → meaning', 'English → 汉字', 'Listen → 汉字'];
const copy: unknown[] = [];
for (let n = 0; n <= 3; n++) {
  const labels = LABELS.slice(0, n);
  copy.push({ count: n, button: otherCardsButtonLabel(n), labels, message: otherCardsAddedMessage(labels) });
}
const props: unknown[] = [];
for (let i = 0; i < 40; i++) {
  const t = subset(TYPES).sort(() => rand() - 0.5);
  props.push({ types: t, prop: otherCardTypesProp(t) });
}

// The merge of a request into the note's active bump.
const merges: unknown[] = [];
const typeLists: Array<string[] | null> = [null, [], ['bogus'], ...TYPES.map(t => [t]), [TYPES[2], TYPES[0]], [...TYPES]];
for (let i = 0; i < 300; i++) {
  const hasExisting = rand() < 0.75;
  const existing = hasExisting ? pick(typeLists) : null;
  const stillOpen = subset(TYPES);
  const incoming = pick(typeLists);
  merges.push({ hasExisting, existing, stillOpen, incoming, result: mergeBumpCardTypes(hasExisting ? existing : undefined, stillOpen, incoming) });
}

// The sibling spacing.
const spacing: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const notes = Array.from({ length: int(1, 6) }, (_, k) => `n${k}`);
  const candidates = Array.from({ length: int(0, 8) }, (_, k) => ({ id: `c${i}-${k}`, note_id: pick(notes) }));
  const bumped = subset(candidates.map(c => c.id));
  if (rand() < 0.2) bumped.push('elsewhere');
  const recent = Array.from({ length: int(0, 5) }, () => pick(notes));
  const none = rand() < 0.05;
  const got = pickBumpedCard(candidates, none ? null : new Set(bumped), recent);
  spacing.push({ candidates, bumped: none ? null : bumped, recent, pick: got?.id ?? null });
}

writeFileSync(join(OUT, 'other-card-types.json'), JSON.stringify({ rows, due, copy, props, merges, spacing }));
console.log(`other-card-types: ${rows.length} sheets, ${merges.length} merges, ${spacing.length} spacing cases`);
