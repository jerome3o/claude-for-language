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

  it('picks the notes with never-seen characters first across ALL decks, then deck order', () => {
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
    // 2 new characters: 咖啡 (top deck first), then 人们 / 中国 from the low deck (id order);
    // then 你好吗 (吗 still new) — 人 / 好人 bring nothing new any more.
    expect(q.due.filter(c => c.queue === 0).map(c => c.id)).toEqual(['1d', '2x', '2y', '1e']);
    expect([...q.allocation]).toEqual([['top', { primary: 2, secondary: 0 }], ['low', { primary: 2, secondary: 0 }]]);
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

describe('new characters first across all decks', () => {
  const CUTOFF = Date.parse('2026-09-27T22:59:59.999Z');
  const card = (id: string, note: string, deck: string, queue: number, type = 'hanzi_to_meaning'): QueueCardInput => ({
    id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: queue === 0 ? null : CUTOFF - 1,
  });
  const deck = (id: string, priority: number, capPrimary = 3, capSecondary = 6): QueueDeckInput => ({
    id, priority, created_at: '2026-01-01', cap_primary: capPrimary, cap_secondary: capSecondary,
  });
  const newOrder = (q: { due: QueueCardInput[] }) => q.due.filter(c => c.queue === 0).map(c => c.id);

  it('a never-seen-character note in the bottom deck beats a no-new-character note in the top deck', () => {
    const hanzi = new Map([['s', '你好'], ['t', '你'], ['b', '熊']]);
    const cards = [card('s1', 's', 'top', 2), card('t1', 't', 'top', 0), card('b1', 'b', 'bottom', 0)];
    const q = selectStudyQueue([deck('top', 9), deck('bottom', 0)], cards, { new_cards_per_day: 1, secondary_cards_per_day: 0 },
      0, new Map(), CUTOFF, null, { hanzi });
    expect(newOrder(q)).toEqual(['b1']);
    expect(q.allocation.get('bottom')).toEqual({ primary: 1, secondary: 0 });
    expect(q.allocation.get('top')).toEqual({ primary: 0, secondary: 0 });
  });

  it('ties go to the higher deck in the queue, then the shorter word', () => {
    const hanzi = new Map([['a', '熊猫'], ['b', '猴子'], ['c', '虎']]);
    const cards = [card('a1', 'a', 'low', 0), card('b1', 'b', 'high', 0), card('c1', 'c', 'high', 0)];
    const q = selectStudyQueue([deck('low', 0), deck('high', 5)], cards, { new_cards_per_day: 3, secondary_cards_per_day: 0 },
      0, new Map(), CUTOFF, null, { hanzi });
    // all bring 2 new (capped) or 1: 猴子 (2, high) > 熊猫 (2, low) > 虎 (1)
    expect(newOrder(q)).toEqual(['b1', 'a1', 'c1']);
  });

  it('respects deck caps, caps 0 + 0 one-off decks and opted-out words', () => {
    const hanzi = new Map([['a', '熊'], ['b', '猫'], ['c', '虎'], ['d', '狗'], ['e', '龙']]);
    const cards = [
      card('a1', 'a', 'capped', 0), card('b1', 'b', 'capped', 0),
      card('c1', 'c', 'oneoff', 0), card('d1', 'd', 'top', 0), card('e1', 'e', 'top', 0),
    ];
    const decks = [deck('top', 9, 5), deck('capped', 0, 1), deck('oneoff', 5, 0, 0)];
    const q = selectStudyQueue(decks, cards, { new_cards_per_day: 10, secondary_cards_per_day: 0 },
      0, new Map(), CUTOFF, null, { hanzi }, new Map([['e', 0 as const]]));
    // 龙 opted out, 虎 in a one-off deck, the capped deck gives one (id order: 熊).
    expect(newOrder(q)).toEqual(['d1', 'a1']);
    expect(q.allocation.get('capped')).toEqual({ primary: 1, secondary: 0 });
  });

  it('counts a deck cap already spent today', () => {
    const hanzi = new Map([['a', '熊'], ['b', '猫'], ['c', '虎']]);
    const cards = [card('a1', 'a', 'low', 0), card('b1', 'b', 'low', 0), card('c1', 'c', 'top', 0)];
    const q = selectStudyQueue([deck('top', 9), deck('low', 0, 2)], cards, { new_cards_per_day: 5, secondary_cards_per_day: 0 },
      0, new Map([['low', { primary: 1, secondary: 0 }]]), CUTOFF, null, { hanzi });
    expect(newOrder(q)).toEqual(['c1', 'a1']);
  });

  it('falls back to deck order (novelty inside each deck) once no word brings a new character', () => {
    const hanzi = new Map([['s', '人大'], ['n', '熊'], ['t1', '大人'], ['t2', '人'], ['l1', '大']]);
    const cards = [
      card('s1', 's', 'top', 2), card('l1', 'l1', 'low', 0), card('n1', 'n', 'low', 0),
      card('t1', 't1', 'top', 0), card('t2', 't2', 'top', 0),
    ];
    const q = selectStudyQueue([deck('top', 9), deck('low', 0)], cards, { new_cards_per_day: 3, secondary_cards_per_day: 0 },
      0, new Map(), CUTOFF, null, { hanzi });
    // 熊 first (new character, bottom deck), then the top deck: 大人 (unseen word) then 人 (… shorter but seen word)
    expect(newOrder(q)).toEqual(['n1', 't1', 't2']);
  });

  it('bumps stay first and outside the pools', () => {
    const hanzi = new Map([['a', '熊'], ['b', '猫']]);
    const cards = [card('a1', 'a', 'top', 0), card('b1', 'b', 'low', 0)];
    const q = selectStudyQueue([deck('top', 9), deck('low', 0)], cards, { new_cards_per_day: 1, secondary_cards_per_day: 0 },
      0, new Map(), CUTOFF, null, { hanzi }, null,
      { bumps: [{ note_id: 'a', created_ms: CUTOFF - 3_600_000 }], lastReviewMs: new Map(), firstReviewMs: new Map() });
    expect(q.due.map(c => c.id)).toEqual(['a1', 'b1']);
    expect(q.bumped.map(c => c.id)).toEqual(['a1']);
  });

  it('builds the queue for 10k notes quickly', () => {
    const r = (() => { let a = 7; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296); })();
    const chars = [...'的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跑跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济买声'];
    const hanzi = new Map<string, string>();
    const cards: QueueCardInput[] = [];
    const decks = Array.from({ length: 20 }, (_, i) => deck(`d${i}`, i, 20));
    for (let n = 0; n < 10_000; n++) {
      const len = 1 + Math.floor(r() * 3);
      let h = '';
      for (let k = 0; k < len; k++) h += chars[Math.floor(r() * chars.length)];
      hanzi.set(`n${n}`, h);
      const deckId = `d${n % 20}`;
      const reviewed = r() < 0.5;
      for (const t of ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi']) {
        cards.push(card(`c${n}-${t[0]}`, `n${n}`, deckId, reviewed ? 2 : 0, t));
      }
    }
    const budget = { new_cards_per_day: 20, secondary_cards_per_day: 10 };
    const times: number[] = [];
    let q = selectStudyQueue(decks, cards, budget, 10, new Map(), CUTOFF, null, { hanzi });
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      q = selectStudyQueue(decks, cards, budget, 10, new Map(), CUTOFF, null, { hanzi });
      times.push(performance.now() - t0);
    }
    const ms = times.sort((a, b) => a - b)[2];
    console.log(`selectStudyQueue, 10k notes / 30k cards / 20 decks: median ${ms.toFixed(1)} ms`);
    expect(q.due.filter(c => c.queue === 0).length).toBe(30); // 20 + 10 bonus
    // ~25–45 ms on a dev container (half of it the queue without novelty); generous for CI.
    expect(ms).toBeLessThan(120);
  });
});
