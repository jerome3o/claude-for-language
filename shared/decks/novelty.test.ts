import { describe, it, expect } from 'vitest';
import { compareNovelty, hanText, noveltyOf, pickByNovelty, seenFrom } from './novelty';
import { selectStudyQueue, type QueueCardInput, type QueueDeckInput } from './study-queue';

describe('noveltyOf', () => {
  it('counts never-seen characters, an unseen word and the Han length', () => {
    const seen = seenFrom(['大学生', '我是老师。', 'OK']);
    expect(noveltyOf('学生', seen)).toEqual({ newChars: 0, unseenWord: false, length: 2 }); // inside 大学生
    expect(noveltyOf('学老', seen)).toEqual({ newChars: 0, unseenWord: true, length: 2 });
    expect(noveltyOf('咖啡咖啡', seen)).toEqual({ newChars: 2, unseenWord: true, length: 4 });
    expect(noveltyOf('卡拉OK', seen)).toEqual({ newChars: 2, unseenWord: true, length: 2 });
    expect(noveltyOf('OK', seen)).toEqual({ newChars: 0, unseenWord: false, length: 0 });
    // '\n' separates seen notes: 生我 spans two notes, so it is not "seen".
    expect(noveltyOf('生我', seen).unseenWord).toBe(true);
    expect(hanText(' 你好，我是。 ')).toBe('你好我是');
  });

  it('ranks: new characters (capped at 2) > unseen word > shorter', () => {
    const n = (newChars: number, unseenWord: boolean, length: number) => ({ newChars, unseenWord, length });
    expect(compareNovelty(n(1, false, 9), n(0, true, 1))).toBeLessThan(0);
    expect(compareNovelty(n(5, true, 12), n(2, true, 2))).toBeGreaterThan(0); // cap: the word wins on length
    expect(compareNovelty(n(0, true, 4), n(0, false, 1))).toBeLessThan(0);
    expect(compareNovelty(n(0, false, 2), n(0, false, 2))).toBe(0);
  });
});

describe('pickByNovelty', () => {
  it('counts earlier picks as seen, so notes sharing a new character are spread out', () => {
    const seen = seenFrom(['你好']);
    const got = pickByNovelty(['咖啡', '喝咖啡', '茶', '你们'], 3, h => h, seen);
    // 咖啡 (2 new) first; then 喝咖啡 has only 1 new (喝) — same as 茶 and 你们, 茶 is shorter.
    expect(got).toEqual(['咖啡', '茶', '你们']);
    expect(seen.chars.has('茶')).toBe(true);
  });

  it('keeps the existing order on ties and stops at `take`', () => {
    expect(pickByNovelty(['一', '二', '三'], 2, h => h, seenFrom([]))).toEqual(['一', '二']);
    expect(pickByNovelty(['一'], 5, h => h, seenFrom([]))).toEqual(['一']);
  });

  it('a long sentence with many new characters does not beat a word with two', () => {
    const got = pickByNovelty(['我们明天去北京看长城。', '熊猫'], 1, h => h, seenFrom([]));
    expect(got).toEqual(['熊猫']);
  });
});

describe('selectStudyQueue with note text (new characters first)', () => {
  const CUTOFF = Date.parse('2026-09-27T22:59:59.999Z');
  const card = (id: string, note: string, deck: string, queue: number, type = 'hanzi_to_meaning'): QueueCardInput => ({
    id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: queue === 0 ? null : CUTOFF - 1,
  });
  const deck = (id: string, priority: number, cap = 3): QueueDeckInput => ({
    id, priority, created_at: '2026-01-01', cap_primary: cap, cap_secondary: 6,
  });
  const hanzi = new Map([
    ['seen', '你好'], ['a', '你'], ['b', '好人'], ['c', '人'], ['d', '咖啡'], ['e', '你好吗？'],
    ['x', '人们'], ['y', '中国'],
  ]);

  it('picks the notes with never-seen characters, deck queue order unchanged', () => {
    const cards = [
      card('0-seen', 'seen', 'top', 2),
      card('1a', 'a', 'top', 0), card('1b', 'b', 'top', 0), card('1c', 'c', 'top', 0),
      card('1d', 'd', 'top', 0), card('1e', 'e', 'top', 0), card('1e-m', 'e', 'top', 0, 'meaning_to_hanzi'),
      card('2x', 'x', 'low', 0), card('2y', 'y', 'low', 0),
    ];
    const decks = [deck('low', 0), deck('top', 5)];
    const budget = { new_cards_per_day: 4, secondary_cards_per_day: 0 };
    const plain = selectStudyQueue(decks, cards, budget, 0, new Map(), CUTOFF);
    expect(plain.due.filter(c => c.queue === 0).map(c => c.id)).toEqual(['1a', '1b', '1c', '2x']);
    const q = selectStudyQueue(decks, cards, budget, 0, new Map(), CUTOFF, null, { hanzi });
    // top deck (3): 咖啡 (2 new); 人 (1 new, shorter than 好人 / 你好吗); then 你好吗 (吗 still
    // new — 好人's 人 is now seen); low deck (1): 中国 (2 new) over 人们 (们 only).
    expect(q.due.filter(c => c.queue === 0).map(c => c.id)).toEqual(['1d', '1c', '1e', '2y']);
    expect(q.allocation).toEqual(plain.allocation);
  });

  it('a one-deck session takes the seen characters from every deck', () => {
    const cards = [card('1a', 'a', 'top', 0), card('1y', 'y', 'top', 0)];
    const q = selectStudyQueue([deck('top', 0, 1)], cards, { new_cards_per_day: 3, secondary_cards_per_day: 0 }, 0, new Map(), CUTOFF, 'top', {
      hanzi: new Map([...hanzi, ['other', '中国']]),
      reviewedNoteIds: ['other'],
    });
    expect(q.due.map(c => c.id)).toEqual(['1a']);
  });
});
