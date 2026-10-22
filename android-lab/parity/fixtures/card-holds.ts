/**
 * Suspend & snooze golden vectors (shared/decks/holds.ts, docs/STUDY_SESSION.md "Suspend & snooze"):
 *   - `dates`: local-date arithmetic (day numbers, + days / months clamped, snoozeUntil),
 *   - `holds`: isHoldActive / heldCardIds / activeHoldFor / labels / tags / messages,
 *   - `rows`: the management list's search + filter (filterHoldRows),
 *   - `buried`: siblingBuriedCardIds (NEW + REVIEW siblings of a card reviewed today; bumped words exempt),
 *   - `queues`: selectStudyQueue(…, holds) — held cards leave the pools (a held NEW card frees its
 *     budget slot), the due cards, the ⚡ pocket and Up next; sibling burying on / off.
 * Writes card-holds.json; core CardHoldsParityTest asserts CardHolds.kt + StudyQueue.build match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeHoldFor,
  addLocalDays,
  addLocalMonths,
  dateOfDayNumber,
  dayNumber,
  filterHoldRows,
  heldCardIds,
  holdMessage,
  holdStatusLabel,
  holdTag,
  isHoldActive,
  isLocalDate,
  noteHoldTag,
  releaseMessage,
  siblingBuriedCardIds,
  snoozeUntil,
  type CardHold,
  type HoldFilter,
  type SnoozeLength,
} from '../../../shared/decks/holds';
import { countQueue, introducedToday, selectStudyQueue, type QueueCardInput, type QueueDeckInput } from '../../../shared/decks/study-queue';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: card-holds <out-dir>');
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

const H = 3_600_000;
const DAY = 24 * H;
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;
const LENGTHS: SnoozeLength[] = ['tomorrow', 'week', 'month'];

const randomDate = () => dateOfDayNumber(int(dayNumber('1999-11-15'), dayNumber('2101-03-15')));

// ── dates ──
const dates: unknown[] = [];
for (const d of ['1970-01-01', '2000-02-29', '2024-12-31', '2026-01-31', '2026-10-22', '2028-01-31', '2100-02-28', '1969-12-31']) {
  dates.push({ date: d, n: dayNumber(d), plus1: addLocalDays(d, 1), plus7: addLocalDays(d, 7), minus40: addLocalDays(d, -40), month: addLocalMonths(d, 1), year: addLocalMonths(d, 12), tomorrow: snoozeUntil(d, 'tomorrow'), week: snoozeUntil(d, 'week'), monthSnooze: snoozeUntil(d, 'month') });
}
for (let i = 0; i < 300; i++) {
  const d = randomDate();
  const k = int(-400, 400);
  const m = int(-30, 30);
  dates.push({ date: d, n: dayNumber(d), k, plusK: addLocalDays(d, k), m, plusM: addLocalMonths(d, m), tomorrow: snoozeUntil(d, 'tomorrow'), week: snoozeUntil(d, 'week'), monthSnooze: snoozeUntil(d, 'month') });
}
const valid = ['2026-02-29', '2028-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-01-01', '2026-1-01', 'tomorrow', '', '2026-10-22'].map(s => ({ s, ok: isLocalDate(s) }));

// ── holds ──
const holds: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const today = randomDate();
  const list: CardHold[] = [];
  for (let h = 0; h < int(0, 5); h++) {
    const kind = rand() < 0.35 ? 'suspend' : 'snooze';
    const until = kind === 'suspend' ? null : pick([addLocalDays(today, int(-3, 40)), addLocalDays(today, 1), today, addLocalMonths(today, int(1, 14)), 'garbage', '']);
    list.push({ id: `h${i}-${h}`, card_id: `c${int(0, 3)}`, kind, until, created_at: `2026-10-${String(int(10, 28))}T0${int(0, 9)}:00:00.000Z` });
  }
  const length = pick(LENGTHS);
  const count = pick([1, 1, 2, 3, 12]);
  const byCard = new Map(list.map(h => [h.card_id, h] as const));
  const noteCards = ['c0', 'c1', 'c2', 'c3'].slice(0, int(1, 4));
  holds.push({
    today,
    noteCards,
    noteTag: noteHoldTag(noteCards, byCard, today),
    holds: list,
    active: list.map(h => isHoldActive(h, today)),
    held: [...heldCardIds(list, today)],
    best: activeHoldFor(list, today)?.id ?? null,
    labels: list.map(h => holdStatusLabel(h, today)),
    tags: list.map(h => holdTag(h, today)),
    length,
    count,
    suspendMessage: holdMessage('suspend', count),
    snoozeMessage: holdMessage('snooze', count, length),
    releaseMessage: releaseMessage(count),
  });
}

// ── rows ──
const WORDS = [
  ['银行', 'yínháng', 'bank'], ['学生', 'xuéshēng', 'student'], ['苹果', 'píngguǒ', 'apple'], ['女儿', 'nǚ\'ér', 'daughter'],
  ['绿色', 'lǜsè', 'green'], ['你好', 'nǐ hǎo', 'hello'], ['大学生', 'dàxuéshēng', 'university student'], ['行', 'xíng', 'OK'],
];
const QUERIES = ['', 'yin', 'yinhang', 'YÍN', 'ni hao', 'nihao', '学', 'student', '  bank ', 'lü', 'lv', 'xing', 'zzz', '行'];
const rows: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const today = '2026-10-22';
  const list = [];
  for (let r = 0; r < int(0, 8); r++) {
    const [hanzi, pinyin, english] = pick(WORDS);
    const kind = rand() < 0.4 ? 'suspend' : 'snooze';
    list.push({
      card_id: `c${i}-${r}`,
      hold: { kind, until: kind === 'suspend' ? null : addLocalDays(today, int(1, 40)), created_at: `2026-10-${String(int(10, 22))}T1${int(0, 9)}:00:00.000Z` },
      hanzi, pinyin, english,
    });
  }
  const query = pick(QUERIES);
  const filter = pick<HoldFilter>(['all', 'all', 'suspended', 'snoozed']);
  rows.push({ rows: list, query, filter, result: filterHoldRows(list as never, query, filter).map(r => r.card_id) });
}

// ── buried + queues ──
const buried: unknown[] = [];
const queues: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const dayStart = Date.parse('2026-10-21T23:00:00.000Z');
  const now = dayStart + int(1, 22) * H;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);
  const today = '2026-10-22';
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < int(1, 3); d++) {
    decks.push({ id: `q${i}-${d}`, priority: pick([0, 1, 2]), created_at: `2026-0${int(1, 9)}-1${int(0, 9)}T10:00:00.000Z`, cap_primary: pick([1, 3, 5, 20]), cap_secondary: pick([0, 2, 6]) });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const lastReviewAt: Record<string, number> = {};
  for (let n = 0; n < int(0, 12); n++) {
    const deckId = pick(decks).id;
    const reviewedNote = rand() < 0.5;
    for (const t of TYPES.slice(0, int(1, 3))) {
      const id = `c${i}-${n}-${t[0]}`;
      const queue = reviewedNote ? pick([0, 1, 2, 2, 3]) : 0;
      let due: number | null = null;
      if (queue !== 0) {
        due = now + int(-72, 72) * H;
        firstReviewAt[id] = rand() < 0.3 ? dayStart + int(0, 5) * H : dayStart - int(1, 40) * DAY;
        lastReviewAt[id] = rand() < 0.45 ? dayStart + int(0, 8) * H : firstReviewAt[id];
        if (lastReviewAt[id] < firstReviewAt[id]) lastReviewAt[id] = firstReviewAt[id];
      }
      cards.push({ id, note_id: `n${i}-${n}`, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  const holdList: CardHold[] = [];
  for (const c of cards) {
    if (rand() < 0.18) {
      const kind = rand() < 0.5 ? 'suspend' : 'snooze';
      holdList.push({ id: `h-${c.id}`, card_id: c.id, kind, until: kind === 'suspend' ? null : pick([addLocalDays(today, 1), addLocalDays(today, 7), today, addLocalDays(today, -2)]), created_at: '2026-10-20T10:00:00.000Z' });
    }
  }
  const held = heldCardIds(holdList, today);
  const reviewedToday = new Set(Object.entries(lastReviewAt).filter(([, ms]) => ms >= dayStart).map(([id]) => id));
  const noteIds = [...new Set(cards.map(c => c.note_id))];
  const bumps = rand() < 0.4 && noteIds.length
    ? { bumps: [{ note_id: pick(noteIds), created_ms: dayStart + int(0, 3) * H }], lastReviewMs: new Map(Object.entries(lastReviewAt)), firstReviewMs: new Map(Object.entries(firstReviewAt)) }
    : null;
  const upNext = rand() < 0.4 ? noteIds.filter(() => rand() < 0.3) : null;
  const bury = rand() < 0.5;
  const exempt = bumps ? bumps.bumps.map(b => b.note_id) : [];
  buried.push({ cards, reviewedToday: [...reviewedToday], exempt, result: [...siblingBuriedCardIds(cards, reviewedToday, exempt)] });

  const budget = { new_cards_per_day: pick([1, 3, 5]), secondary_cards_per_day: pick([0, 3, 6]) };
  const bonus = pick([0, 0, 10]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const holdsInput = { held, reviewedToday: bury ? reviewedToday : null };
  const out = [null, pick(decks).id].map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId, null, null, bumps, upNext, holdsInput);
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      newOrder: q.due.filter(c => c.queue === 0).map(c => c.id),
      bumped: q.bumped.map(c => c.id),
      upNext: q.upNext.map(c => c.id),
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
    };
  });
  queues.push({
    cutoff, dayStart, decks, cards, firstReviewAt, lastReviewAt, budget, bonus,
    bumps: bumps ? bumps.bumps : null, upNextList: upNext, held: [...held], reviewedToday: bury ? [...reviewedToday] : null,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues: out,
  });
}

writeFileSync(join(OUT, 'card-holds.json'), JSON.stringify({ dates, valid, holds, rows, buried, queues }));
