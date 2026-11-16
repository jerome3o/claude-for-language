/**
 * Home's numbers right after a study session (Nov 2026) — golden vectors from the web app's own
 * TypeScript (shared/study/homeCounts.ts): which numbers Home paints (sessionCountsNewer), a deck
 * row / the total / the ⚡ line after a newer session, and the session's cards counted by deck.
 * Writes home-counts.json; core HomeCountsParityTest asserts the Kotlin port (HomeCounts.kt) matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  bumpedAfterSession,
  countSessionCards,
  deckCountsAfterSession,
  sessionCountsNewer,
  totalAfterSession,
  type SessionCounts,
  type StudyCounts,
} from '../../../shared/study/homeCounts';
import { seededRandom } from '../../../shared/explorer/drill';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: home-counts <out-dir>');
mkdirSync(OUT, { recursive: true });

const rand = seededRandom(9091);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: T[]): T => xs[int(0, xs.length - 1)];
const counts = (max = 12): StudyCounts => ({ new: int(0, max), secondaryNew: int(0, max), learning: int(0, max), review: int(0, max) });
const DAYS = ['2026-11-15', '2026-11-16'];
const DECKS = ['a', 'b', 'c', 'd'];

const newer: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const session: SessionCounts | null = rand() < 0.1 ? null : {
    day: pick(DAYS), at: int(0, 20), deckId: null, remaining: counts(), byDeck: {}, bumpedNotes: 0,
  };
  const computed = rand() < 0.15 ? null : { at: int(0, 20), day: pick(DAYS) };
  const today = pick(DAYS);
  newer.push({ session, computed, today, newer: sessionCountsNewer(session, computed, today) });
}

const after: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const byDeck: Record<string, StudyCounts> = {};
  for (const d of DECKS) if (rand() < 0.6) byDeck[d] = counts(6);
  const session: SessionCounts = {
    day: '2026-11-16', at: 10, deckId: rand() < 0.5 ? null : pick(DECKS),
    remaining: rand() < 0.2 ? { new: 0, secondaryNew: 0, learning: 0, review: 0 } : counts(10),
    byDeck, bumpedNotes: int(0, 4),
  };
  const rows: Record<string, StudyCounts> = {};
  for (const d of DECKS) if (rand() < 0.7) rows[d] = counts(8);
  const total = rand() < 0.1 ? null : counts(30);
  const bumped = int(0, 5);
  after.push({
    session, rows, total, bumped,
    decks: Object.fromEntries(DECKS.map(d => [d, deckCountsAfterSession(rows[d] ?? null, session, d)])),
    total_after: totalAfterSession(total, rows, session),
    bumped_after: bumpedAfterSession(bumped, session),
  });
}

const cards: unknown[] = [];
for (let i = 0; i < 100; i++) {
  const list = Array.from({ length: int(0, 12) }, () => ({ deck_id: pick(DECKS), note_id: `n${int(0, 5)}`, queue: int(0, 3) }));
  const reviewed = Array.from({ length: int(0, 4) }, () => `n${int(0, 5)}`);
  cards.push({ cards: list, reviewed, ...countSessionCards(list, new Set(reviewed)) });
}

writeFileSync(join(OUT, 'home-counts.json'), JSON.stringify({ newer, after, cards }));
