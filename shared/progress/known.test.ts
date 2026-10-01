import { describe, it, expect } from 'vitest';
import {
  hanCharacters, noteKind, noteKey, isHanCodePoint, historyPoints, knownProgress, knownCountsFromTiers,
  type KnownEventInput,
} from './known';
import { computeCardTimeline, computeCardState } from '../scheduler/compute-state';

const T0 = Date.parse('2026-01-01T09:00:00.000Z');
const DAY = 86_400_000;
const at = (day: number) => new Date(T0 + day * DAY).toISOString();
let seq = 0;
const ev = (card_id: string, day: number, rating: number): KnownEventInput =>
  ({ id: `e${String(seq++).padStart(4, '0')}`, card_id, rating, reviewed_at: at(day) });
/** Easy on `day`, Easy again 3 days later → stability ≈ 25.7 days: known from day + 3. */
const mature = (card: string, day: number) => [ev(card, day, 3), ev(card, day + 3, 3)];

describe('hanCharacters', () => {
  it('keeps distinct Han characters in order, dropping punctuation, Latin, digits and spaces', () => {
    expect(hanCharacters('我喜欢看书、看电影。')).toEqual(['我', '喜', '欢', '看', '书', '电', '影']);
    expect(hanCharacters('T恤衫 3个 OK！ abc')).toEqual(['恤', '衫', '个']);
    expect(hanCharacters('')).toEqual([]);
    expect(hanCharacters('123 abc ?!')).toEqual([]);
    expect(hanCharacters('“智慧”的“慧”')).toEqual(['智', '慧', '的']);
  });
  it('knows the extension and compatibility blocks, and not kana or hangul', () => {
    expect(hanCharacters('𠮷野家')).toEqual(['𠮷', '野', '家']); // U+20BB7, a surrogate pair
    expect(isHanCodePoint(0x3400)).toBe(true);
    expect(isHanCodePoint(0xf900)).toBe(true);
    expect(hanCharacters('ひらがなカタカナ한국어〇々')).toEqual([]);
  });
});

describe('noteKind', () => {
  it('words are 1–4 Han characters without sentence punctuation', () => {
    expect(noteKind('一')).toBe('word');
    expect(noteKind('黑咖啡')).toBe('word');
    expect(noteKind('高高兴兴')).toBe('word');
    expect(noteKind('T恤衫')).toBe('word');
    expect(noteKind('(一)点(儿)')).toBe('word');
    expect(noteKind('鱼 → 余')).toBe('word');
  });
  it('longer or punctuated notes are sentences', () => {
    expect(noteKind('一两年以后')).toBe('sentence');
    expect(noteKind('你好！')).toBe('sentence');
    expect(noteKind('不是，他')).toBe('sentence');
    expect(noteKind('好吗?')).toBe('sentence');
    expect(noteKind('里斯本离你很近')).toBe('sentence');
  });
  it('notes with no Han characters count for nothing', () => {
    expect(noteKind('OK')).toBe('none');
    expect(noteKind('')).toBe('none');
    expect(noteKind('3。')).toBe('none');
  });
  it('the same word spelled with stray spaces or punctuation is one key', () => {
    expect(noteKey(' 你好 ')).toBe('你好');
    expect(noteKey('T恤衫')).toBe('T恤衫');
    expect(noteKey('你好！')).toBe('你好');
  });
});

describe('computeCardTimeline', () => {
  it('ends on computeCardState', () => {
    const events = [ev('c', 0, 2), ev('c', 0.01, 2), ev('c', 1, 1), ev('c', 4, 2), ev('c', 14, 0), ev('c', 15, 3)]
      .map((e) => ({ ...e, id: e.id!, rating: e.rating as 0 | 1 | 2 | 3 }));
    const timeline = computeCardTimeline(events);
    const end = computeCardState(events);
    expect(timeline).toHaveLength(6);
    expect(timeline[5]).toEqual({ reviewed_at: events[5].reviewed_at, queue: end.queue, stability: end.stability });
    expect(computeCardTimeline([])).toEqual([]);
  });
});

describe('knownProgress', () => {
  const notes = [
    { id: 'n1', hanzi: '你好' },
    { id: 'n2', hanzi: '好吃' },
    { id: 'n3', hanzi: '我很好。' },
    { id: 'n4', hanzi: '你好' }, // same word in another deck
    { id: 'n5', hanzi: 'OK' },
  ];
  const cards = notes.flatMap((n) => ['a', 'b', 'c'].map((t) => ({ id: `${n.id}${t}`, note_id: n.id })));

  it('tiers notes by their best card and characters by their best note', () => {
    seq = 0;
    const events = [
      ...mature('n1a', 0), // 你好 known from day 3
      ev('n1b', 1, 2), // a learning card doesn't pull the note down
      ev('n2a', 2, 2), // 好吃 learning
      ev('n3a', 2, 2), // sentence learning
      ev('n5a', 2, 3), // no Han: nothing
      ev('gone', 2, 3), // a card the device doesn't have
    ];
    const p = knownProgress(notes, cards, events);
    expect(p.words).toEqual({ known: 1, learning: 1 });
    expect(p.sentences).toEqual({ known: 0, learning: 1 });
    // 你 好 known (in 你好); 吃 我 很 learning.
    expect(p.characters).toEqual({ known: 2, learning: 3 });
    expect(p.recent_characters.map((r) => r.char)).toEqual(['你', '好']);
    expect(p.recent_characters[0].known_at).toBe(at(3));
  });

  it('counts a word known in either of two notes once', () => {
    seq = 0;
    const p = knownProgress(notes, cards, [...mature('n1a', 0), ...mature('n4b', 10)]);
    expect(p.words).toEqual({ known: 1, learning: 0 });
    expect(p.characters).toEqual({ known: 2, learning: 0 });
  });

  it('a sentence makes its characters known but is not a word', () => {
    seq = 0;
    const p = knownProgress(notes, cards, mature('n3c', 0));
    expect(p.words).toEqual({ known: 0, learning: 0 });
    expect(p.sentences).toEqual({ known: 1, learning: 0 });
    expect(p.characters).toEqual({ known: 3, learning: 0 });
  });

  it('a lapse moves the note back to learning, and the history shows it', () => {
    seq = 0;
    const events = [...mature('n1a', 0), ev('n1a', 60, 0), ...mature('n2a', 1)];
    const points = [at(-1), at(2), at(3), at(4), at(59), at(60), at(61)].map(Date.parse);
    const p = knownProgress(notes, cards, events, points);
    expect(p.history.map((h) => [h.words.known, h.words.learning, h.characters.known, h.characters.learning])).toEqual([
      [0, 0, 0, 0], // before anything
      [0, 2, 0, 3], // both words reviewed, neither mature
      [1, 1, 2, 1], // day 3 exactly: 你好 known (events at a point count)
      [2, 0, 3, 0], // day 4: 好吃 too
      [2, 0, 3, 0],
      [1, 1, 2, 1], // day 60: 你好 lapsed; 好 is still known through 好吃
      [1, 1, 2, 1],
    ]);
    expect(p.words).toEqual({ known: 1, learning: 1 });
    // 你 is no longer known; 吃 (day 4) is newer than 好 (day 3).
    expect(p.recent_characters.map((r) => r.char)).toEqual(['吃', '好']);
  });

  it('sorts each card\'s events itself and ignores unparseable timestamps', () => {
    seq = 0;
    const [a, b] = mature('n1a', 0);
    const p = knownProgress(notes, cards, [b, { ...a }, { card_id: 'n1a', rating: 0, reviewed_at: 'nonsense' }]);
    expect(p.words.known).toBe(1);
  });

  it('is all zeros with no events', () => {
    expect(knownProgress(notes, cards, [], [T0])).toEqual({
      characters: { known: 0, learning: 0 },
      words: { known: 0, learning: 0 },
      sentences: { known: 0, learning: 0 },
      recent_characters: [],
      history: [{ at_ms: T0, characters: { known: 0, learning: 0 }, words: { known: 0, learning: 0 } }],
    });
  });

  it('limits the recent characters, newest first then by character', () => {
    seq = 0;
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, hanzi: String.fromCodePoint(0x4e00 + i) }));
    const p = knownProgress(many, many.map((n) => ({ id: `${n.id}c`, note_id: n.id })),
      many.flatMap((n, i) => mature(`${n.id}c`, i < 10 ? 0 : 5)), [], 12);
    expect(p.recent_characters).toHaveLength(12);
    expect(p.recent_characters[0].char).toBe(String.fromCodePoint(0x4e00 + 10));
    expect(p.recent_characters[10].char).toBe(String.fromCodePoint(0x4e00 + 0));
    expect(p.characters.known).toBe(20);
  });
});

describe('historyPoints', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  it('daily for a short span, starting at or before the first review', () => {
    const pts = historyPoints([{ card_id: 'a', rating: 2, reviewed_at: new Date(now - 3.5 * DAY).toISOString() }], now);
    expect(pts).toEqual([now - 4 * DAY, now - 3 * DAY, now - 2 * DAY, now - DAY, now]);
  });
  it('steps in whole days to stay under the limit', () => {
    const pts = historyPoints([{ card_id: 'a', rating: 2, reviewed_at: new Date(now - 400 * DAY).toISOString() }], now, 60);
    expect(pts.length).toBeLessThanOrEqual(60);
    expect(pts[pts.length - 1]).toBe(now);
    expect(pts[1] - pts[0]).toBe(7 * DAY);
    expect(pts[0]).toBeLessThanOrEqual(now - 400 * DAY);
  });
  it('is empty without events and just now for future ones', () => {
    expect(historyPoints([], now)).toEqual([]);
    expect(historyPoints([{ card_id: 'a', rating: 2, reviewed_at: new Date(now + DAY).toISOString() }], now)).toEqual([now]);
  });
});

describe('knownCountsFromTiers', () => {
  it('groups like knownProgress', () => {
    expect(knownCountsFromTiers([
      { hanzi: '你好', tier: 2 },
      { hanzi: '你好', tier: 1 },
      { hanzi: '好吃', tier: 1 },
      { hanzi: '我很好。', tier: 1 },
      { hanzi: '不要', tier: 0 },
    ])).toEqual({
      characters: { known: 2, learning: 3 },
      words: { known: 1, learning: 1 },
      sentences: { known: 0, learning: 1 },
    });
  });
});
