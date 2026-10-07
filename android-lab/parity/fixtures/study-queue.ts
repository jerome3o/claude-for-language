/**
 * Study queue golden vectors (the due-count parity fix, 27 Sep 2026), from the
 * web app's own TypeScript — shared/decks/study-queue.ts, which the web's
 * getStudyQueue, Home and deck counts all go through:
 *   - introducedToday(cards, firstReviewAt, dayStart)   (new cards introduced today, primary / secondary)
 *   - selectStudyQueue(...)                             (the cards a session gets: learning / review due
 *                                                         by the cutoff + the budget's new cards)
 *   - countQueue(...)                                   (the four numbers Home shows)
 *   - selectStudyQueue(..., noteText)                   ("new characters first": which brand-new
 *                                                         notes, in pick order — shared/decks/novelty.ts;
 *                                                         `globalNovelty`: across ALL decks first, caps,
 *                                                         one-off decks and long-term choices)
 *   - selectStudyQueue(..., bumps) + bumpPocket(...)    ("⚡ Study it today": the bump pocket heads the
 *                                                         queue, NEW over the budget, one early review,
 *                                                         carry-over, done after review — shared/decks/bumps.ts)
 *   - selectStudyQueue(..., { order, frequency })      (`ordered`: "Order new cards by" — every combination
 *                                                         of the four switches, with / without the shipped
 *                                                         word-frequency list — shared/decks/new-card-order.ts)
 * Writes study-queue.json; core StudyQueueParityTest asserts StudyQueue.kt reproduces them.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseFrequencyList } from '../../../shared/decks/frequency';
import type { NewCardOrder } from '../../../shared/decks/new-card-order';
import {
  introducedToday,
  selectStudyQueue,
  countQueue,
  type QueueCardInput,
  type QueueDeckInput,
} from '../../../shared/decks/study-queue';
import { bumpPocket, type QueueBumps } from '../../../shared/decks/bumps';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: study-queue <out-dir>');
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
const rand = rng(20260927);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const H = 3_600_000;
const DAY = 24 * H;
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

const cases: unknown[] = [];
for (let i = 0; i < 250; i++) {
  const dayStart = Date.parse('2026-09-26T23:00:00.000Z') + int(-3, 3) * DAY;
  const now = dayStart + int(0, 23) * H + int(0, 59) * 60_000;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);

  const deckCount = int(1, 5);
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < deckCount; d++) {
    decks.push({
      id: `d${i}-${d}`,
      priority: pick([0, 0, 1, 2, 5, -1]),
      created_at: `2026-0${int(1, 9)}-${String(int(10, 28))}T${String(int(10, 23))}:00:00.000Z`,
      cap_primary: pick([0, 1, 3, 5, 20]),
      cap_secondary: pick([0, 2, 6, 10]),
    });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const noteCount = int(0, 14);
  for (let n = 0; n < noteCount; n++) {
    // A few cards belong to a deck the device doesn't know (dropped / ghost deck).
    const deckId = rand() < 0.05 ? `gone-${i}` : pick(decks).id;
    const types = TYPES.slice(0, int(1, 3));
    for (const t of types) {
      const id = `c${i}-${n}-${t[0]}`;
      const queue = pick([0, 0, 0, 1, 2, 2, 2, 3]);
      let due: number | null = null;
      if (queue !== 0) {
        due = rand() < 0.05 ? null : now + int(-4 * 24, 4 * 24) * H + int(-30, 30) * 60_000;
        // first review: often today, sometimes earlier
        firstReviewAt[id] = rand() < 0.4 ? dayStart + int(0, 20) * H : dayStart - int(1, 40) * DAY;
        if (rand() < 0.05) firstReviewAt[id] = dayStart; // exactly at the day start
      }
      cards.push({ id, note_id: `n${i}-${n}`, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  const budget = { new_cards_per_day: pick([0, 3, 5, 10]), secondary_cards_per_day: pick([0, 6, 10]) };
  const bonus = pick([0, 0, 0, 10, 20]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const scopes: Array<string | null> = [null, pick(decks).id];
  const queues = scopes.map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId);
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      newOrder: q.due.filter(c => c.queue === 0).map(c => c.id),
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
    };
  });
  cases.push({
    now,
    dayStart,
    cutoff,
    decks,
    cards,
    firstReviewAt,
    budget,
    bonus,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues,
  });
}

// "New characters first": notes with hanzi drawn from a pool with shared characters, words
// inside other words, sentences (with punctuation), non-Han text, repeats and rare
// characters, so the greedy pick (earlier picks make characters seen) is exercised.
const HANZI = [
  '你好', '你', '好', '你们', '我们', '人', '好人', '大人', '大学', '大学生', '学生', '学',
  '咖啡', '喝咖啡', '喝茶', '茶', '中国', '中国人', '我是学生。', '你好吗？', '我喜欢喝咖啡，你呢？',
  '老师', '老师您好', '他是王老师的儿子。', 'T恤', '卡拉OK', 'OK', '', ' 你好 ', '𠮷野家',
  '高高兴兴', '一', '二', '三', '一二三', '谢谢', '不客气', 'ひらがな', '豈', '我们明天去北京看长城。',
];
const novelty: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const dayStart = Date.parse('2026-09-26T23:00:00.000Z');
  const now = dayStart + int(6, 22) * H;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < int(1, 4); d++) {
    decks.push({
      id: `v${i}-${d}`,
      priority: pick([0, 1, 2, 5]),
      created_at: `2026-0${int(1, 9)}-${String(int(10, 28))}T10:00:00.000Z`,
      cap_primary: pick([1, 3, 5, 20]),
      cap_secondary: pick([0, 6, 10]),
    });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const noteHanzi: Record<string, string> = {};
  for (let n = 0; n < int(0, 24); n++) {
    const noteId = `w${i}-${String(n).padStart(2, '0')}`;
    noteHanzi[noteId] = pick(HANZI);
    const deckId = rand() < 0.05 ? `gone-${i}` : pick(decks).id;
    const reviewed = rand() < 0.35;
    const types = rand() < 0.1 ? TYPES.slice(1, 3) : TYPES.slice(0, int(1, 3));
    for (const t of types) {
      const id = `k${i}-${n}-${t[0]}-${int(0, 9)}`;
      const queue = reviewed ? pick([0, 1, 2, 2, 3]) : 0;
      let due: number | null = null;
      if (queue !== 0) {
        due = now + int(-48, 48) * H;
        firstReviewAt[id] = rand() < 0.3 ? dayStart + int(0, 5) * H : dayStart - int(1, 40) * DAY;
      }
      cards.push({ id, note_id: noteId, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  // A note the device knows only by its hanzi (reviewed elsewhere) and one with no hanzi entry.
  noteHanzi[`elsewhere-${i}`] = pick(HANZI);
  const budget = { new_cards_per_day: pick([1, 3, 5, 10]), secondary_cards_per_day: pick([0, 6]) };
  const bonus = pick([0, 0, 10]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const reviewedIds = [...new Set(cards.filter(c => c.queue !== 0).map(c => c.note_id))];
  const seenNoteIds = rand() < 0.3 ? [...reviewedIds, `elsewhere-${i}`, `missing-${i}`] : null;
  const hanziMap = new Map(Object.entries(noteHanzi));
  const scopes: Array<string | null> = [null, pick(decks).id];
  const queues = scopes.map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId,
      { hanzi: hanziMap, ...(seenNoteIds ? { reviewedNoteIds: seenNoteIds } : {}) });
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      newOrder: q.due.filter(c => c.queue === 0).map(c => c.id),
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
    };
  });
  novelty.push({
    now, dayStart, cutoff, decks, cards, firstReviewAt, budget, bonus, noteHanzi, seenNoteIds,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues,
  });
}

// "⚡ Study it today": bumped notes in every state — brand new (over a spent budget), in review
// and not due (early review), already due, half reviewed since the bump, reviewed before the
// bump (carry-over from yesterday), done, in another deck, unknown to the device.
const bumped: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const dayStart = Date.parse('2026-10-03T23:00:00.000Z') + int(-2, 2) * DAY;
  const now = dayStart + int(6, 22) * H + int(0, 59) * 60_000;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < int(1, 3); d++) {
    decks.push({
      id: `b${i}-${d}`,
      priority: pick([0, 1, 2]),
      created_at: `2026-0${int(1, 9)}-${String(int(10, 28))}T10:00:00.000Z`,
      cap_primary: pick([0, 1, 3, 5]),
      cap_secondary: pick([0, 2, 6]),
    });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const lastReviewAt: Record<string, number> = {};
  const noteIds: string[] = [];
  for (let n = 0; n < int(1, 12); n++) {
    const noteId = `bn${i}-${String(n).padStart(2, '0')}`;
    noteIds.push(noteId);
    const deckId = rand() < 0.05 ? `gone-${i}` : pick(decks).id;
    const started = rand() < 0.6;
    const types = rand() < 0.15 ? TYPES.slice(1, 3) : TYPES.slice(0, int(1, 3));
    for (const t of types) {
      const id = `bc${i}-${n}-${t[0]}`;
      const queue = started ? pick([0, 1, 2, 2, 2, 3]) : 0;
      let due: number | null = null;
      if (queue !== 0) {
        due = rand() < 0.05 ? null : now + int(-3 * 24, 6 * 24) * H;
        firstReviewAt[id] = rand() < 0.2 ? dayStart + int(0, 5) * H : dayStart - int(1, 60) * DAY;
        lastReviewAt[id] = Math.max(firstReviewAt[id], rand() < 0.4 ? now - int(0, 6) * H : firstReviewAt[id] + int(0, 3) * DAY);
      }
      cards.push({ id, note_id: noteId, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  const bumpList = noteIds.filter(() => rand() < 0.45).map(note_id => ({
    note_id,
    // today, earlier today, or carried over from a previous day; sometimes exactly at a review
    created_ms: pick([now - int(0, 5) * H, dayStart + int(0, 3) * H, dayStart - int(1, 3) * DAY]),
  }));
  if (rand() < 0.3) bumpList.push({ note_id: `unknown-${i}`, created_ms: now - H });
  if (bumpList.length && rand() < 0.15) {
    // a review exactly at the bump instant counts as "since the bump"
    const c = cards.find(x => x.note_id === bumpList[0].note_id && x.queue !== 0);
    if (c) lastReviewAt[c.id] = bumpList[0].created_ms;
  }
  const bumpsIn: QueueBumps = {
    bumps: bumpList,
    lastReviewMs: new Map(Object.entries(lastReviewAt)),
    firstReviewMs: new Map(Object.entries(firstReviewAt)),
  };
  const budget = { new_cards_per_day: pick([0, 1, 3]), secondary_cards_per_day: pick([0, 6]) };
  const bonus = pick([0, 0, 10]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const scopes: Array<string | null> = [null, pick(decks).id];
  const queues = scopes.map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId, null, null, bumpsIn);
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      newOrder: q.due.filter(c => c.queue === 0).map(c => c.id),
      bumped: q.bumped.map(c => c.id),
      bumpedNoteIds: q.bumpedNoteIds,
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
    };
  });
  const pocket = bumpPocket(cards, bumpsIn, cutoff);
  bumped.push({
    now, dayStart, cutoff, decks, cards, firstReviewAt, lastReviewAt, bumps: bumpList, budget, bonus,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues,
    pocket: { cards: pocket.cards.map(c => c.id), active: pocket.activeNoteIds, done: pocket.doneNoteIds },
  });
}

// "New characters first across ALL decks": many decks with their own character sets (a bottom
// deck full of never-seen characters under a top deck of familiar ones), caps incl. a one-off
// deck (0 + 0), opted-in / opted-out words, cards introduced today, bonus rounds.
const EXTRA = [...'熊猫虎狗龙鸟鱼马牛羊猴鸡兔蛇鼠猪山水火木金土雨雪风云'];
const globalNovelty: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const dayStart = Date.parse('2026-10-06T23:00:00.000Z');
  const now = dayStart + int(6, 22) * H;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < int(2, 6); d++) {
    const oneOff = rand() < 0.15;
    decks.push({
      id: `g${i}-${d}`,
      priority: pick([0, 1, 2, 3, 5, 9]),
      created_at: `2026-0${int(1, 9)}-${String(int(10, 28))}T10:00:00.000Z`,
      cap_primary: oneOff ? 0 : pick([0, 1, 2, 3, 5, 20]),
      cap_secondary: oneOff ? 0 : pick([0, 2, 6, 10]),
    });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const noteHanzi: Record<string, string> = {};
  const longTerm: Record<string, 0 | 1> = {};
  for (let n = 0; n < int(0, 40); n++) {
    const noteId = `g${i}-n${String(n).padStart(2, '0')}`;
    const deckIndex = int(0, decks.length - 1);
    noteHanzi[noteId] = rand() < 0.5 ? pick(HANZI)
      : Array.from({ length: int(1, 3) }, () => (rand() < 0.4 + 0.1 * deckIndex ? pick(EXTRA) : pick(HANZI).slice(0, 1))).join('');
    const deckId = rand() < 0.04 ? `gone-${i}` : decks[deckIndex].id;
    const reviewed = rand() < 0.35;
    if (rand() < 0.1) longTerm[noteId] = pick([0, 1] as const);
    const types = rand() < 0.1 ? TYPES.slice(1, 3) : TYPES.slice(0, int(1, 3));
    for (const t of types) {
      const id = `g${i}-c${n}-${t[0]}-${int(0, 9)}`;
      const queue = reviewed ? pick([0, 1, 2, 2, 3]) : 0;
      let due: number | null = null;
      if (queue !== 0) {
        due = now + int(-48, 48) * H;
        firstReviewAt[id] = rand() < 0.3 ? dayStart + int(0, 5) * H : dayStart - int(1, 40) * DAY;
      }
      cards.push({ id, note_id: noteId, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  const budget = { new_cards_per_day: pick([0, 1, 3, 5, 10, 20]), secondary_cards_per_day: pick([0, 6]) };
  const bonus = pick([0, 0, 10]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const hanziMap = new Map(Object.entries(noteHanzi));
  const longTermMap = new Map(Object.entries(longTerm));
  const scopes: Array<string | null> = [null, pick(decks).id];
  const queues = scopes.map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId, { hanzi: hanziMap }, longTermMap);
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      newOrder: q.due.filter(c => c.queue === 0).map(c => c.id),
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
    };
  });
  globalNovelty.push({
    now, dayStart, cutoff, decks, cards, firstReviewAt, budget, bonus, noteHanzi, seenNoteIds: null, longTerm,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues,
  });
}

// "Order new cards by": every combination of the four switches (then random ones), with and
// without the shipped frequency list, over decks of words (common and rare, from the list),
// words met inside sentences, sentences with new characters, one-off decks and long-term choices.
let root = OUT;
while (!existsSync(join(root, 'android-lab', 'parity')) && dirname(root) !== root) root = dirname(root);
const shipped = parseFrequencyList(readFileSync(join(root, 'shared/data/frequency/word-freq.txt'), 'utf8'));
const listWords = [...shipped.words.keys()];
const ORDER_POOL = [
  ...HANZI, '银行', '我在银行工作。', '工作', '熊猫', '熊猫很可爱。', '博物馆', '我们去博物馆吧！', '电脑', '手机',
  ...listWords.slice(0, 40), ...listWords.slice(5000, 5020), ...listWords.slice(25000, 25010),
];
const ordered: unknown[] = [];
for (let i = 0; i < 320; i++) {
  const dayStart = Date.parse('2026-10-06T23:00:00.000Z');
  const now = dayStart + int(6, 22) * H;
  const cutoff = Math.max(dayStart + DAY - 1, now + H);
  const decks: QueueDeckInput[] = [];
  for (let d = 0; d < int(1, 5); d++) {
    const oneOff = rand() < 0.12;
    decks.push({
      id: `o${i}-${d}`,
      priority: pick([0, 1, 2, 3, 5]),
      created_at: `2026-0${int(1, 9)}-${String(int(10, 28))}T10:00:00.000Z`,
      cap_primary: oneOff ? 0 : pick([0, 1, 2, 3, 5, 20]),
      cap_secondary: oneOff ? 0 : pick([0, 2, 6]),
    });
  }
  const cards: QueueCardInput[] = [];
  const firstReviewAt: Record<string, number> = {};
  const noteHanzi: Record<string, string> = {};
  const longTerm: Record<string, 0 | 1> = {};
  for (let n = 0; n < int(0, 36); n++) {
    const noteId = `o${i}-n${String(n).padStart(2, '0')}`;
    noteHanzi[noteId] = pick(ORDER_POOL);
    const deckId = rand() < 0.04 ? `gone-${i}` : pick(decks).id;
    const reviewed = rand() < 0.35;
    if (rand() < 0.08) longTerm[noteId] = pick([0, 1] as const);
    const types = rand() < 0.1 ? TYPES.slice(1, 3) : TYPES.slice(0, int(1, 3));
    for (const t of types) {
      const id = `o${i}-c${n}-${t[0]}-${int(0, 9)}`;
      const queue = reviewed ? pick([0, 1, 2, 2, 3]) : 0;
      let due: number | null = null;
      if (queue !== 0) {
        due = now + int(-48, 48) * H;
        firstReviewAt[id] = rand() < 0.3 ? dayStart + int(0, 5) * H : dayStart - int(1, 40) * DAY;
      }
      cards.push({ id, note_id: noteId, deck_id: deckId, card_type: t, queue, due_ms: due });
    }
  }
  const order: NewCardOrder = i < 32
    ? { new_characters_first: !!(i & 1), new_words_first: !!(i & 2), most_common_first: !!(i & 4), sentences_last: !!(i & 8) }
    : { new_characters_first: rand() < 0.7, new_words_first: rand() < 0.7, most_common_first: rand() < 0.7, sentences_last: rand() < 0.7 };
  const useFrequency = i < 32 ? i < 16 : rand() < 0.8;
  const budget = { new_cards_per_day: pick([0, 1, 3, 5, 10, 20]), secondary_cards_per_day: pick([0, 6]) };
  const bonus = pick([0, 0, 10]);
  const intro = introducedToday(cards, new Map(Object.entries(firstReviewAt)), dayStart);
  const hanziMap = new Map(Object.entries(noteHanzi));
  const longTermMap = new Map(Object.entries(longTerm));
  const scopes: Array<string | null> = [null, pick(decks).id];
  const queues = scopes.map(deckId => {
    const q = selectStudyQueue(decks, cards, budget, bonus, intro, cutoff, deckId,
      { hanzi: hanziMap, order, frequency: useFrequency ? shipped : null }, longTermMap);
    return {
      deckId,
      due: q.due.map(c => c.id).sort(),
      newOrder: q.due.filter(c => c.queue === 0).map(c => c.id),
      counts: countQueue(q.due, q.reviewedNoteIds),
      hasMoreNew: q.hasMoreNew,
      allocation: [...q.allocation.entries()].map(([id, a]) => ({ deckId: id, primary: a.primary, secondary: a.secondary })),
    };
  });
  ordered.push({
    now, dayStart, cutoff, decks, cards, firstReviewAt, budget, bonus, noteHanzi, seenNoteIds: null, longTerm, order, useFrequency,
    introduced: [...intro.entries()].map(([deckId, v]) => ({ deckId, ...v })),
    queues,
  });
}

writeFileSync(join(OUT, 'study-queue.json'), JSON.stringify({ cases, novelty, bumped, globalNovelty, ordered }));
console.log(`study-queue: ${cases.length} + ${novelty.length} (new characters first) + ${bumped.length} (bumps) + ${globalNovelty.length} (across decks) + ${ordered.length} (order new cards by) scenarios`);
