import { describe, it, expect } from 'vitest';
import { passRetryBar, retryBar, retryBarBadge, retryBarLabel, retryBarNote, passProgress, type PassEvent } from './index';

/** A pass walked answer by answer: each answer is an event a minute after the last. */
function walk(itemIds: string[], answers: Array<[string, 'right' | 'wrong'] | ['undo']>) {
  const events: PassEvent[] = [];
  let t = 0;
  const at = () => `2026-10-22T10:${String(t++).padStart(2, '0')}:00.000Z`;
  const bars = [passRetryBar(itemIds, events)];
  for (const a of answers) {
    if (a.length === 1) {
      const live = events.filter((e) => e.result !== 'undo' && !events.some((u) => u.undoes === e.id));
      const last = live[live.length - 1];
      events.push({ id: `u${events.length}`, item_id: last.item_id, result: 'undo', undoes: last.id, created_at: at() });
    } else {
      events.push({ id: `e${events.length}`, item_id: a[0], result: a[1], created_at: at() });
    }
    bars.push(passRetryBar(itemIds, events));
  }
  return { events, bars };
}

const ids = ['a', 'b', 'c', 'd'];

describe('passRetryBar', () => {
  it('starts empty: every slot fresh', () => {
    const bar = passRetryBar(ids, []);
    expect(bar).toMatchObject({ slots: 4, answered: 0, fresh: 4, retries: 0, doneFraction: 0, retryFraction: 0, onRetries: false, complete: false });
    expect(retryBarLabel(bar)).toBe('0 of 4 words done');
    expect(retryBarBadge(bar)).toBeNull();
    expect(retryBarNote(bar)).toBeNull();
  });

  it('Got it moves the blue one slot', () => {
    const { bars } = walk(ids, [['a', 'right'], ['b', 'right']]);
    expect(bars[1].doneFraction).toBe(1 / 4);
    expect(bars[2].doneFraction).toBe(2 / 4);
    expect(bars[2].retryFraction).toBe(0);
  });

  it('Not yet moves the blue too, adds an orange slot at the right end, never goes backwards', () => {
    const { bars } = walk(ids, [['a', 'wrong'], ['b', 'wrong'], ['c', 'right']]);
    expect(bars[1]).toMatchObject({ slots: 5, answered: 1, fresh: 3, retries: 1, onRetries: false });
    expect(bars[1].doneFraction).toBe(1 / 5);
    expect(bars[1].retryFraction).toBe(1 / 5);
    expect(bars[2]).toMatchObject({ slots: 6, answered: 2, retries: 2 });
    expect(retryBarLabel(bars[2])).toBe('0 of 4 words done · 2 to retry');
    expect(retryBarBadge(bars[2])).toBe('↺ 2');
    expect(retryBarNote(bars[2])).toBe('2 to try again');
    for (let i = 1; i < bars.length; i++) expect(bars[i].doneFraction).toBeGreaterThanOrEqual(bars[i - 1].doneFraction);
  });

  it('the blue meets the orange once every word was shown: on retries', () => {
    const { bars } = walk(ids, [['a', 'wrong'], ['b', 'right'], ['c', 'wrong'], ['d', 'right']]);
    const bar = bars[4];
    expect(bar).toMatchObject({ slots: 6, answered: 4, fresh: 0, retries: 2, onRetries: true, complete: false });
    expect(bar.doneFraction + bar.retryFraction).toBe(1);
    expect(retryBarNote(bar)).toBe('Trying again · 2 left');
  });

  it('a Got it on a retry eats an orange slot; a Not yet on a retry keeps the orange and lengthens the track', () => {
    const { bars } = walk(ids, [['a', 'wrong'], ['b', 'right'], ['c', 'wrong'], ['d', 'right'], ['a', 'wrong'], ['c', 'right']]);
    expect(bars[5]).toMatchObject({ slots: 7, answered: 5, retries: 2, onRetries: true });
    expect(bars[6]).toMatchObject({ slots: 7, answered: 6, retries: 1, onRetries: true });
    expect(bars[6].doneFraction + bars[6].retryFraction).toBe(1);
  });

  it('finished = full blue, whatever it took', () => {
    const { bars } = walk(ids, [['a', 'wrong'], ['b', 'right'], ['c', 'right'], ['d', 'right'], ['a', 'wrong'], ['a', 'right']]);
    const bar = bars[bars.length - 1];
    expect(bar).toMatchObject({ slots: 6, answered: 6, fresh: 0, retries: 0, doneFraction: 1, retryFraction: 0, complete: true, onRetries: false, itemsDone: 4 });
    expect(retryBarLabel(bar)).toBe('All 4 words done');
    expect(retryBarNote(bar)).toBeNull();
  });

  it('↺ undo puts the bar back exactly where it was before the answer', () => {
    const { bars } = walk(ids, [['a', 'wrong'], ['b', 'right'], ['undo'], ['undo'], ['c', 'wrong'], ['c', 'right'], ['undo']]);
    expect(bars[3]).toEqual(bars[1]); // undo of b's Got it
    expect(bars[4]).toEqual(bars[0]); // undo of a's Not yet: the orange slot goes too
    expect(bars[7]).toEqual(bars[5]); // undo of a Got it on a retry: the orange comes back
    expect(bars[7].retries).toBe(1);
  });

  it('agrees with passProgress on what is done and what is owed', () => {
    const { events, bars } = walk(ids, [['a', 'wrong'], ['b', 'right'], ['a', 'wrong'], ['c', 'wrong']]);
    const p = passProgress(ids, events);
    const bar = bars[bars.length - 1];
    expect(bar.itemsDone).toBe(p.done);
    expect(bar.retries).toBe(p.retrying);
    expect(bar.fresh + bar.retries).toBe(p.remaining.length);
    expect(bar.complete).toBe(p.complete);
  });

  it('ignores events of other items, repeated rights and duplicate item ids', () => {
    const events: PassEvent[] = [
      { id: '1', item_id: 'zz', result: 'wrong', created_at: '2026-10-22T10:00:00Z' },
      { id: '2', item_id: 'a', result: 'right', created_at: '2026-10-22T10:01:00Z' },
      { id: '3', item_id: 'a', result: 'right', created_at: '2026-10-22T10:02:00Z' },
    ];
    expect(passRetryBar(['a', 'a', 'b'], events)).toMatchObject({ items: 2, slots: 2, answered: 1, fresh: 1, itemsDone: 1 });
  });
});

describe('retryBar', () => {
  it('nothing at all: an empty bar, not complete', () => {
    expect(retryBar({ answered: 0, fresh: 0, retries: 0, itemsDone: 0, items: 0 })).toMatchObject({ slots: 0, doneFraction: 0, retryFraction: 0, complete: false });
  });

  it('takes other units (a mini lesson\'s exercises) and cleans bad counts', () => {
    const bar = retryBar({ answered: 3.7, fresh: -2, retries: 1, itemsDone: 9, items: 3 });
    expect(bar).toMatchObject({ answered: 3, fresh: 0, retries: 1, itemsDone: 3, slots: 4, onRetries: true });
    expect(retryBarLabel(bar, { one: 'exercise', other: 'exercises' })).toBe('3 of 3 exercises done · 1 to retry');
    expect(retryBarLabel(retryBar({ answered: 1, fresh: 0, retries: 0, itemsDone: 1, items: 1 }))).toBe('All 1 word done');
  });
});
