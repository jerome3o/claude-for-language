/**
 * "Add to my long-term review" golden vectors (docs/HOMEWORK.md §3a), from the web app's own
 * TypeScript — shared/decks/long-term.ts and the study queue that honours it
 * (shared/decks/study-queue.ts selectStudyQueue(..., longTerm)):
 *   - the pure rules (deckInDailyReview, isLongTerm, prefForToggle, admitsNewCards,
 *     longTermCaps, longTermSummary) over every combination;
 *   - study queues with opted-in / opted-out words: 0 + 0 one-off copies, opt-outs in normal
 *     decks, started words, bonus, one-deck scopes, with and without "new characters first".
 * Writes long-term.json; core LongTermParityTest asserts LongTerm.kt + StudyQueue.kt match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  admitsNewCards,
  deckInDailyReview,
  isLongTerm,
  longTermCaps,
  longTermSummary,
  prefForToggle,
  type LongTermPref,
} from '../../../shared/decks/long-term';
import {
  introducedToday,
  selectStudyQueue,
  countQueue,
  type QueueCardInput,
  type QueueDeckInput,
} from '../../../shared/decks/study-queue';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: long-term <out-dir>');
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
const rand = rng(20261003);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const PREFS: LongTermPref[] = [null, 0, 1];
const BOOLS = [false, true];

const rules: unknown[] = [];
for (const pref of PREFS) for (const inReview of BOOLS) for (const reviewed of BOOLS) {
  rules.push({ pref, inReview, reviewed, isLongTerm: isLongTerm(pref, inReview, reviewed), admits: admitsNewCards(pref, inReview, reviewed) });
}
const toggles: unknown[] = [];
for (const on of BOOLS) for (const inReview of BOOLS) toggles.push({ on, inReview, pref: prefForToggle(on, inReview) });
const caps: unknown[] = [];
for (const p of [0, 1, 3, 20]) for (const s of [0, 2, 6]) caps.push({ p, s, inReview: deckInDailyReview(p, s), caps: longTermCaps(p, s) });
const summaries: unknown[] = [];
for (let i = 0; i < 60; i++) {
  const inReview = rand() < 0.5;
  const words = Array.from({ length: int(0, 12) }, () => ({ pref: pick(PREFS), reviewed: rand() < 0.2 }));
  summaries.push({ inReview, words, summary: longTermSummary(words, inReview) });
}

const H = 3_600_000;
const DAY = 24 * H;
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;
const HANZI = ['你好', '你', '好人', '大学', '大学生', '学生', '咖啡', '喝茶', '中国人', '我是学生。', '刮风', '下雨', '太阳', '月亮', '天气'];

const queues: unknown[] = [];
for (let i = 0; i < 250; i++) {
  const dayStart = Date.parse('2026-10-02T23:00:00.000Z');
  const now = dayStart + int(6, 22) * H;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < int(1, 4); d++) {
    const oneOff = rand() < 0.4;
    decks.push({
      id: `L${i}-${d}`,
      priority: pick([0, 1, 2, 5, 9]),
      created_at: `2026-0${int(1, 9)}-${String(int(10, 28))}T10:00:00.000Z`,
      cap_primary: oneOff ? 0 : pick([0, 1, 3, 5]),
      cap_secondary: oneOff ? 0 : pick([0, 6, 10]),
    });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const noteHanzi: Record<string, string> = {};
  const longTerm: Record<string, 0 | 1> = {};
  for (let n = 0; n < int(0, 18); n++) {
    const noteId = `m${i}-${String(n).padStart(2, '0')}`;
    noteHanzi[noteId] = pick(HANZI);
    const pref = pick([null, null, 0, 1] as const);
    if (pref !== null) longTerm[noteId] = pref;
    const deckId = pick(decks).id;
    const reviewed = rand() < 0.25;
    for (const t of TYPES.slice(0, int(1, 3))) {
      const id = `q${i}-${n}-${t[0]}`;
      const queue = reviewed ? pick([0, 1, 2, 2, 3]) : 0;
      let due: number | null = null;
      if (queue !== 0) {
        due = now + int(-48, 48) * H;
        firstReviewAt[id] = rand() < 0.4 ? dayStart + int(0, 5) * H : dayStart - int(1, 30) * DAY;
      }
      cards.push({ id, note_id: noteId, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  const budget = { new_cards_per_day: pick([1, 3, 5, 10]), secondary_cards_per_day: pick([0, 6]) };
  const bonus = pick([0, 0, 10]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const withText = rand() < 0.5;
  const ltMap = new Map(Object.entries(longTerm)) as Map<string, LongTermPref>;
  const scopes: Array<string | null> = [null, pick(decks).id];
  const out = scopes.map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId,
      withText ? { hanzi: new Map(Object.entries(noteHanzi)) } : null, ltMap);
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      newOrder: q.due.filter(c => c.queue === 0).map(c => c.id),
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
      pools: q.pools.map(p => ({ deckId: p.deckId, totalNew: p.totalNew, totalSecondaryNew: p.totalSecondaryNew, capPrimary: p.capPrimary, capSecondary: p.capSecondary })),
    };
  });
  queues.push({
    now, dayStart, cutoff, decks, cards, firstReviewAt, budget, bonus, longTerm,
    noteHanzi: withText ? noteHanzi : null,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues: out,
  });
}

writeFileSync(join(OUT, 'long-term.json'), JSON.stringify({ rules, toggles, caps, summaries, queues }));
console.log(`long-term: ${rules.length} rules, ${summaries.length} summaries, ${queues.length} queue scenarios`);
