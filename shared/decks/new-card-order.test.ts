import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_NEW_CARD_ORDER,
  applyNewCardOrderUpdate,
  isNewWord,
  newCardOrderInfo,
  orderWithinDeck,
  parseNewCardOrder,
  pickNewCardOrderUpdate,
  pickNewCardsByOrder,
  studiedFrom,
  wordPieces,
  type NewCardOrder,
} from './new-card-order';
import { frequencyRank, parseFrequencyList, NO_HAN_RANK, UNKNOWN_WORD_BASE, UNRANKED_CHAR } from './frequency';
import { selectStudyQueue, type QueueCardInput, type QueueDeckInput } from './study-queue';

const ALL_OFF: NewCardOrder = { new_characters_first: false, new_words_first: false, most_common_first: false, sentences_last: false };
const only = (k: keyof NewCardOrder, extra: Partial<NewCardOrder> = {}): NewCardOrder => ({ ...ALL_OFF, [k]: true, ...extra });

describe('settings', () => {
  it('defaults to every switch on', () => {
    expect(parseNewCardOrder(null)).toEqual(DEFAULT_NEW_CARD_ORDER);
    expect(newCardOrderInfo(DEFAULT_NEW_CARD_ORDER).is_default).toBe(true);
  });

  it('validates an update: booleans or null, reset, problems for anything else', () => {
    expect(pickNewCardOrderUpdate({ sentences_last: false, most_common_first: null, other: 3 })).toEqual({
      update: { sentences_last: false, most_common_first: null }, problems: [],
    });
    expect(pickNewCardOrderUpdate({ new_words_first: 'yes' }).problems).toEqual(['new_words_first must be true, false or null']);
    expect(pickNewCardOrderUpdate(null).problems.length).toBe(1);
    expect(pickNewCardOrderUpdate({ reset: true }).update).toEqual({
      new_characters_first: null, new_words_first: null, most_common_first: null, sentences_last: null,
    });
  });

  it('applies and parses (garbage → defaults per field)', () => {
    const off = applyNewCardOrderUpdate(DEFAULT_NEW_CARD_ORDER, { sentences_last: false });
    expect(off).toEqual({ ...DEFAULT_NEW_CARD_ORDER, sentences_last: false });
    expect(applyNewCardOrderUpdate(off, { sentences_last: null })).toEqual(DEFAULT_NEW_CARD_ORDER);
    expect(parseNewCardOrder('{"new_words_first":false,"most_common_first":"no"}')).toEqual({ ...DEFAULT_NEW_CARD_ORDER, new_words_first: false });
    expect(parseNewCardOrder('not json')).toEqual(DEFAULT_NEW_CARD_ORDER);
    expect(parseNewCardOrder([true])).toEqual(DEFAULT_NEW_CARD_ORDER);
  });
});

describe('frequency', () => {
  const index = parseFrequencyList('# comment\n#words\n的\n银行\n你好\n的\n#chars\n的银行你好熊\n');

  it('ranks listed words, then unknown words by their rarest character, then no Han text', () => {
    expect(index.words.get('银行')).toBe(2);
    expect(index.words.size).toBe(3); // a repeat keeps its first rank
    expect(frequencyRank('银行', index)).toBe(2);
    expect(frequencyRank(' 你好！', index)).toBe(3); // Han text only
    expect(frequencyRank('熊猫', index)).toBe(UNKNOWN_WORD_BASE + UNRANKED_CHAR); // 猫 not listed
    expect(frequencyRank('银熊', index)).toBe(UNKNOWN_WORD_BASE + 6);
    expect(frequencyRank('OK', index)).toBe(NO_HAN_RANK);
  });

  it('the shipped list is ordered by use', () => {
    const real = parseFrequencyList(readFileSync(join(__dirname, '../data/frequency/word-freq.txt'), 'utf8'));
    expect(real.words.size).toBeGreaterThan(20_000);
    expect(real.chars.size).toBeGreaterThan(5_000);
    expect(real.words.get('的')).toBe(1);
    expect(frequencyRank('银行', real)).toBeLessThan(frequencyRank('熊猫', real));
    expect(frequencyRank('喜欢', real)).toBeLessThan(frequencyRank('博物馆', real));
    // Not a listed token (不 + 客气): after every listed word, by its rarest character.
    expect(frequencyRank('不客气', real)).toBeGreaterThan(UNKNOWN_WORD_BASE);
    expect(frequencyRank('我们明天去北京看长城。', real)).toBeGreaterThan(UNKNOWN_WORD_BASE);
  });
});

describe('new words', () => {
  it('a word is new unless its text was met in a studied note — sentences included', () => {
    const studied = studiedFrom(['银', '行', '我在银行工作。', '大学生']);
    expect(isNewWord('工作', studied)).toBe(false); // inside a studied sentence
    expect(isNewWord('学生', studied)).toBe(false); // inside 大学生
    expect(isNewWord('银行', studied)).toBe(false);
    const fresh = studiedFrom(['银', '行']);
    expect(isNewWord('银行', fresh)).toBe(true); // both characters known, the word isn't
    expect(isNewWord('行', fresh)).toBe(false);
    expect(isNewWord('我们去吧。', fresh)).toBe(false); // a sentence is never a "new word"
  });

  it('pieces stay inside one run of Han characters', () => {
    expect(wordPieces('你好，我')).toEqual(['你好']);
    expect(wordPieces('一二三四五')).toEqual(['一二', '一二三', '一二三四', '二三', '二三四', '二三四五', '三四', '三四五', '四五']);
  });
});

describe('pickNewCardsByOrder', () => {
  const freq = parseFrequencyList('#words\n的\n是\n银行\n电脑\n熊猫\n工作\n#chars\n的是银行电脑熊猫工作\n');
  type Item = { id: string; hanzi: string; deck: string };
  const it_ = (id: string, hanzi: string, deck = 'a'): Item => ({ id, hanzi, deck });
  const pick = (items: Item[], take: number, order: NewCardOrder, studiedText: string[] = [], room = 99, rank: Record<string, number> = {}) =>
    pickNewCardsByOrder(items, take, i => i.hanzi, i => i.deck, g => rank[g] ?? 0, new Map(items.map(i => [i.deck, room])),
      i => i.id, order, studiedFrom(studiedText), freq).map(i => i.id);

  it('everything off picks nothing (the deck fallback decides)', () => {
    expect(pick([it_('a', '熊猫')], 3, ALL_OFF)).toEqual([]);
    expect(pick([it_('a', '熊猫')], 3, only('most_common_first'))).toEqual([]);
  });

  it('new characters first: greedy, so two words sharing one new character are spread out', () => {
    expect(pick([it_('1', '电脑'), it_('2', '电话'), it_('3', '熊')], 2, only('new_characters_first'), ['话']))
      .toEqual(['1', '3']); // 电脑 brings 2, then 电话 brings none (电 taken) — 熊 does
  });

  it('new words first: met words wait, a sentence teaches its words', () => {
    const items = [it_('w1', '工作'), it_('w2', '银行'), it_('s', '我在银行工作。')];
    // Nothing new in characters; 银行 / 工作 are new words; the sentence isn't a word.
    expect(pick(items, 3, only('new_words_first'), ['我在', '银', '行', '工', '作'])).toEqual(['w1', 'w2']);
  });

  it('most common first inside a tier', () => {
    const items = [it_('a', '熊猫'), it_('b', '电脑'), it_('c', '银行')];
    expect(pick(items, 3, only('new_characters_first', { most_common_first: true }))).toEqual(['c', 'b', 'a']);
    expect(pick(items, 3, only('new_characters_first'))).toEqual(['a', 'b', 'c']); // id order on ties
  });

  it('sentences last: inside the new-character tier, and every word before a sentence after the tiers', () => {
    const items = [it_('s', '熊猫很可爱。', 'top'), it_('w', '银行', 'low'), it_('old', '工作', 'low')];
    // 熊猫很可爱。 and 银行 both bring new characters: the word first.
    expect(pick(items, 3, { ...ALL_OFF, new_characters_first: true, sentences_last: true }, ['工作'], 99, { top: 0, low: 1 }))
      .toEqual(['w', 's', 'old']);
    // Only "sentences last": the words of the lower deck before the top deck's sentence (ties: card id).
    expect(pick(items, 3, only('sentences_last'), ['工作', '银行', '熊猫很可爱'], 99, { top: 0, low: 1 })).toEqual(['old', 'w']);
  });

  it('a deck gives at most its room', () => {
    const items = [it_('1', '熊', 'x'), it_('2', '猫', 'x'), it_('3', '狗', 'y')];
    expect(pick(items, 3, DEFAULT_NEW_CARD_ORDER, [], 1).sort()).toEqual(['1', '3']);
  });
});

describe('orderWithinDeck', () => {
  const freq = parseFrequencyList('#words\n的\n银行\n电脑\n#chars\n的银行电脑\n');
  it('words before sentences, the most common first, otherwise the existing order', () => {
    const items = ['我们去吧。', '熊猫', '电脑', '银行'];
    expect(orderWithinDeck(items, h => h, DEFAULT_NEW_CARD_ORDER, freq)).toEqual(['银行', '电脑', '熊猫', '我们去吧。']);
    expect(orderWithinDeck(items, h => h, only('sentences_last'), freq)).toEqual(['熊猫', '电脑', '银行', '我们去吧。']);
    expect(orderWithinDeck(items, h => h, ALL_OFF, freq)).toEqual(items);
    expect(orderWithinDeck(items, h => h, DEFAULT_NEW_CARD_ORDER, null)).toEqual(['熊猫', '电脑', '银行', '我们去吧。']);
  });
});

describe('selectStudyQueue with "Order new cards by"', () => {
  const CUTOFF = Date.parse('2026-10-07T22:59:59.999Z');
  const card = (id: string, note: string, deck: string, queue: number, type = 'hanzi_to_meaning'): QueueCardInput => ({
    id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: queue === 0 ? null : CUTOFF - 1,
  });
  const deck = (id: string, priority: number, cap = 5, capSecondary = 6): QueueDeckInput => ({
    id, priority, created_at: '2026-01-01', cap_primary: cap, cap_secondary: capSecondary,
  });
  const freq = parseFrequencyList('#words\n的\n是\n你好\n银行\n工作\n电脑\n#chars\n的是你好银行工作电脑\n');
  const hanzi = new Map([
    ['seen', '我在银行工作。'], ['s1', '你好，我是老师。'], ['w1', '工作'], ['w2', '电脑'], ['w3', '老师'],
  ]);
  const cards = [
    card('seen1', 'seen', 'top', 2),
    card('s1c', 's1', 'top', 0), card('w1c', 'w1', 'low', 0), card('w2c', 'w2', 'low', 0), card('w3c', 'w3', 'low', 0),
  ];
  const decks = [deck('top', 9), deck('low', 0)];
  const newIds = (order: NewCardOrder | undefined, take: number, extra: Partial<Parameters<typeof selectStudyQueue>[7] & object> = {}) =>
    selectStudyQueue(decks, cards, { new_cards_per_day: take, secondary_cards_per_day: 0 }, 0, new Map(), CUTOFF, null,
      { hanzi, order, frequency: freq, ...extra }).due.filter(c => c.queue === 0).map(c => c.id);

  it('defaults: new characters (the most common first), new words, words before sentences', () => {
    // 你好，我是老师。 brings 你 好 是 老 师 but is a sentence; 电脑 brings 电 脑 (a word, more common).
    // Then 老师 (new word, its characters taken by nobody yet…) — greedy: after 电脑 the sentence still brings new characters.
    expect(newIds(undefined, 4)).toEqual(['w2c', 'w3c', 's1c', 'w1c']);
  });

  it('every switch off = the plain deck order (top deck first)', () => {
    expect(newIds(ALL_OFF, 2)).toEqual(['s1c', 'w1c']);
  });

  it('sentences last alone moves the top deck sentence after the lower deck words', () => {
    expect(newIds(only('sentences_last'), 4)).toEqual(['w1c', 'w2c', 'w3c', 's1c']);
  });

  it('a one-off deck (caps 0 + 0) and opted-out words still give nothing; bumps stay first', () => {
    const q = selectStudyQueue([deck('top', 9, 0, 0), deck('low', 0)], cards, { new_cards_per_day: 5, secondary_cards_per_day: 0 }, 0,
      new Map(), CUTOFF, null, { hanzi, frequency: freq }, new Map([['w2', 0]]),
      { bumps: [{ note_id: 'w1', created_ms: CUTOFF - 3_600_000 }], lastReviewMs: new Map(), firstReviewMs: new Map() });
    expect(q.due.filter(c => c.queue === 0).map(c => c.id)).toEqual(['w1c', 'w3c']);
    expect(q.bumped.map(c => c.id)).toEqual(['w1c']);
  });

  it('orders 10k notes quickly', () => {
    const real = parseFrequencyList(readFileSync(join(__dirname, '../data/frequency/word-freq.txt'), 'utf8'));
    const pool = [...real.words.keys()].slice(0, 6000);
    const r = (() => { let a = 11; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296); })();
    const noteText = new Map<string, string>();
    const many: QueueCardInput[] = [];
    const manyDecks = Array.from({ length: 20 }, (_, i) => deck(`d${i}`, i, 20, 10));
    for (let n = 0; n < 10_000; n++) {
      const p = r();
      const text = p < 0.25
        ? `${pool[Math.floor(r() * pool.length)]}${pool[Math.floor(r() * pool.length)]}${pool[Math.floor(r() * pool.length)]}。`
        : pool[Math.floor(r() * pool.length)];
      noteText.set(`n${n}`, text);
      const reviewed = r() < 0.5;
      for (const t of ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi']) {
        many.push(card(`c${n}-${t[0]}`, `n${n}`, `d${n % 20}`, reviewed ? 2 : 0, t));
      }
    }
    const run = () => selectStudyQueue(manyDecks, many, { new_cards_per_day: 20, secondary_cards_per_day: 10 }, 10, new Map(), CUTOFF, null,
      { hanzi: noteText, frequency: real });
    let q = run();
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      q = run();
      times.push(performance.now() - t0);
    }
    const ms = times.sort((a, b) => a - b)[2];
    console.log(`selectStudyQueue + "Order new cards by", 10k notes / 30k cards / 20 decks: median ${ms.toFixed(1)} ms`);
    expect(q.due.filter(c => c.queue === 0).length).toBe(30); // 20 + 10 bonus (every started note is fully reviewed)
    expect(ms).toBeLessThan(100); // generous for CI; ~15–20 ms on a dev container (~7 of it the queue itself)
  });
});
