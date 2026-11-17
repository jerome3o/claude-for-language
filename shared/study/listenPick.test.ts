import { describe, expect, it } from 'vitest';
import {
  LISTEN_CONTEXT_SHOWN,
  listenContextRows,
  listenShownProps,
  listenShownRows,
  listenTopUpWant,
  pickListenRows,
  seededShuffle,
  type ListenRow,
} from './listenContext';
import { sentenceStats, type SentencePracticeEvent } from './sentenceHistory';
import { clauseBreaks, hanCount, isSimpleSentence, simpleSentenceProblems } from './sentenceSimplicity';

const NOTE = 'n1';
const HANZI = ['我去银行。', '银行在哪儿？', '银行几点开门？', '他在银行工作。', '这家银行很大。', '银行关门了。', '我在银行等你。', '银行人很多。'];

function rowsOf(n: number, clue = '你去银行吗？'): ListenRow[] {
  return listenContextRows([
    { id: `${NOTE}-card`, hanzi: clue, translation: 'Are you going to the bank?', position: -1, is_card: 1 },
    ...HANZI.slice(0, n).map((hanzi, i) => ({ id: `s${i}`, hanzi, translation: `T${i}`, position: i, focus: 'core' })),
  ]);
}

let evId = 0;
function heard(key: string, at: string): SentencePracticeEvent {
  return { id: `e${evId++}`, note_id: NOTE, sentence_key: key, kind: 'heard', mode: 'listen_context', at };
}

const keys = (rows: ListenRow[]) => rows.map((r) => r.key);

describe('sentenceStats — heard in context', () => {
  it('counts heard events per sentence with the latest time, and they are not takes', () => {
    const stats = sentenceStats([heard('s1', '2026-11-01T00:00:00Z'), heard('s1', '2026-11-03T00:00:00Z'), heard('clue', '2026-11-02T00:00:00Z')], NOTE);
    expect(stats.get('s1')?.heard).toEqual({ count: 2, last_at: '2026-11-03T00:00:00Z' });
    // An older event's `clue` key is the card row's (shared/study/cardSentence.ts).
    expect(stats.get('n1-card')?.heard?.count).toBe(1);
    expect(stats.get('clue')).toBeUndefined();
    expect(stats.get('s1')?.read.attempts).toBe(0);
  });
});

describe('pickListenRows', () => {
  it('offers four sentences, never-heard ones first', () => {
    const rows = rowsOf(8);
    const stats = sentenceStats(['clue', 's0', 's1', 's2', 's3'].map((k) => heard(k, '2026-11-01T00:00:00Z')), NOTE);
    const pick = pickListenRows(rows, stats, { seed: 'a' });
    expect(pick.rows).toHaveLength(LISTEN_CONTEXT_SHOWN);
    expect(new Set(keys(pick.rows))).toEqual(new Set(['s4', 's5', 's6', 's7']));
    expect(pick.fresh).toBe(4);
    expect(pick.heardBefore).toBe(0);
    expect(pick.unheardLeft).toBe(0);
    expect(listenShownProps(pick)).toEqual({ shown: 4, fresh: 4, heard_before: 0 });
  });

  it('then the least heard, then the one heard longest ago', () => {
    const rows = rowsOf(5);
    const stats = sentenceStats([
      heard('clue', '2026-11-01T00:00:00Z'), heard('clue', '2026-11-02T00:00:00Z'),
      heard('s0', '2026-11-05T00:00:00Z'),
      heard('s1', '2026-11-01T00:00:00Z'),
      heard('s2', '2026-11-03T00:00:00Z'),
      heard('s3', '2026-11-04T00:00:00Z'), heard('s3', '2026-11-04T01:00:00Z'),
    ], NOTE);
    const pick = pickListenRows(rows, stats, { seed: 'x', count: 3 });
    // s4 never heard; then heard once: s1 (oldest), s2 — not s0 (newest), not clue / s3 (twice).
    expect(new Set(keys(pick.rows))).toEqual(new Set(['s4', 's1', 's2']));
    expect(pick.fresh).toBe(1);
    expect(pick.heardBefore).toBe(2);
  });

  it('prefers simple sentences among equally fresh ones', () => {
    const rows = listenContextRows([
      { id: 'long', hanzi: '虽然今天下雨，但是我们还是去银行办事了，因为很急。', position: 0 },
      { id: 'a', hanzi: '我去银行。', position: 1 },
      { id: 'b', hanzi: '银行在哪儿？', position: 2 },
    ]);
    const pick = pickListenRows(rows, new Map(), { seed: 's', count: 2, word: '银行' });
    expect(new Set(keys(pick.rows))).toEqual(new Set(['a', 'b']));
  });

  it('leaves hidden and contrived sentences out', () => {
    const rows = listenContextRows([
      { id: 'a', hanzi: '我去银行。', position: 0 },
      { id: 'b', hanzi: '银行在哪儿？', position: 1, focus: 'contrast' },
      { id: 'c', hanzi: '银行关门了。', position: 2 },
    ]);
    const stats = sentenceStats([{ id: 'h', note_id: NOTE, sentence_key: 'c', kind: 'hide', reason: 'weird', at: '2026-11-01T00:00:00Z' }], NOTE);
    expect(keys(pickListenRows(rows, stats, { seed: 's' }).rows)).toEqual(['a']);
  });

  it('falls back to contrived sentences when there is nothing else', () => {
    const rows = listenContextRows([{ id: 'b', hanzi: '银行在哪儿？', position: 1, focus: 'contrast' }]);
    expect(keys(pickListenRows(rows, new Map(), { seed: 's' }).rows)).toEqual(['b']);
  });

  it('never offers the same set twice in a row when there are more', () => {
    const rows = rowsOf(5); // clue + 5 = 6 candidates, none heard
    const first = pickListenRows(rows, new Map(), { seed: 'one' });
    for (const seed of ['two', 'three', 'four', 'five', 'one']) {
      const next = pickListenRows(rows, new Map(), { seed, previous: keys(first.rows) });
      expect(new Set(keys(next.rows))).not.toEqual(new Set(keys(first.rows)));
    }
    // With exactly four candidates there is nothing else to offer.
    const four = rowsOf(3);
    const a = pickListenRows(four, new Map(), { seed: 'one' });
    const b = pickListenRows(four, new Map(), { seed: 'two', previous: keys(a.rows) });
    expect(new Set(keys(b.rows))).toEqual(new Set(keys(a.rows)));
  });

  it('shuffles: the card sentence has no fixed first slot, the order changes across showings and is stable within one', () => {
    const rows = rowsOf(3); // clue + 3 → all four shown
    const orders = new Set<string>();
    let clueFirst = 0;
    for (let i = 0; i < 40; i++) {
      const pick = pickListenRows(rows, new Map(), { seed: `showing-${i}` });
      expect(pick.rows).toHaveLength(4);
      orders.add(keys(pick.rows).join(','));
      if (pick.rows[0].fromCard) clueFirst++;
      // The same seed = the same order (the card stays the same while it is up).
      expect(keys(pickListenRows(rows, new Map(), { seed: `showing-${i}` }).rows)).toEqual(keys(pick.rows));
    }
    expect(orders.size).toBeGreaterThan(8);
    expect(clueFirst).toBeGreaterThan(2);
    expect(clueFirst).toBeLessThan(30);
  });

  it('asks for more when a showing leaves fewer than four unheard', () => {
    const many = pickListenRows(rowsOf(8), new Map(), { seed: 's' });
    expect(many.unheardLeft).toBe(5);
    expect(listenTopUpWant(many)).toBeNull();
    const few = pickListenRows(rowsOf(5), new Map(), { seed: 's' });
    expect(few.unheardLeft).toBe(2);
    expect(listenTopUpWant(few)).toEqual({ reason: 'fresh', count: 6 });
    expect(listenTopUpWant({ unheardLeft: 0 })).toEqual({ reason: 'fresh', count: 8 });
    expect(listenTopUpWant({ unheardLeft: 3 })).toEqual({ reason: 'fresh', count: 5 });
  });
});

describe('listenShownRows', () => {
  it('keeps the picked order with fresh data, then rows added during the showing', () => {
    const rows = rowsOf(3);
    const shown = listenShownRows(rows, ['s2', 'n1-card', 'gone', 's0'], ['s1', 's0']);
    expect(keys(shown)).toEqual(['s2', 'n1-card', 's0', 's1']);
  });
});

describe('seededShuffle', () => {
  it('is a permutation, deterministic per seed', () => {
    const xs = [1, 2, 3, 4, 5, 6];
    expect(seededShuffle(xs, 'k').slice().sort()).toEqual(xs);
    expect(seededShuffle(xs, 'k')).toEqual(seededShuffle(xs, 'k'));
    expect(seededShuffle([], 'k')).toEqual([]);
  });
});

describe('simple sentences', () => {
  it('counts Han characters and clause breaks inside the sentence', () => {
    expect(hanCount('我去 bank 银行。')).toBe(4);
    expect(clauseBreaks('我去银行。')).toBe(0);
    expect(clauseBreaks('因为下雨，所以我没去。')).toBe(1);
    expect(clauseBreaks('我去了。你呢？')).toBe(1);
    expect(clauseBreaks('虽然下雨，但是我去了，因为很急。')).toBe(2);
  });

  it('flags long or many-clause sentences; a long word gets room', () => {
    expect(isSimpleSentence('我明天去银行取钱。', '银行')).toBe(true);
    expect(simpleSentenceProblems('虽然今天下雨，但是我们还是去银行办事了，因为很急。', '银行')).toEqual(['too_long', 'too_many_clauses']);
    expect(simpleSentenceProblems('我们公司附近新开的那家银行周末也营业吗？', '银行')).toEqual(['too_long']);
    const long = '一石二鸟的办法我们都喜欢';
    expect(isSimpleSentence(`他想了一个${long}。`, long)).toBe(true);
  });
});
