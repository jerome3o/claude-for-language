import { describe, it, expect } from 'vitest';
import { computeCardState, withForgetEvents, type ReviewEvent } from '../scheduler/compute-state';
import {
  FORGET_WARNING,
  LEECH_THRESHOLD,
  forgetButton,
  forgetMessage,
  forgetTitle,
  forgetWarning,
  isLeech,
  leechHeadline,
  leechInfo,
  leechPill,
  memoryHookQuestion,
  ratingTag,
} from './leech';

const DAY = 86_400_000;

/** A card learned with Good, then forgotten (Again in Review) `lapses` times, relearned each time. */
function leechHistory(lapses: number, start = Date.parse('2026-01-01T09:00:00.000Z')): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  let t = start;
  let n = 0;
  const push = (rating: 0 | 1 | 2 | 3, gap: number) => {
    t += gap;
    events.push({ id: `e${n++}`, card_id: 'c', rating, reviewed_at: new Date(t).toISOString() });
  };
  push(2, 0); push(2, 15 * 60_000); push(2, 2 * DAY); // learned → Review
  for (let i = 0; i < lapses; i++) {
    push(0, 5 * DAY);           // lapse
    push(2, 10 * 60_000);       // relearned
    push(2, 2 * DAY);           // back in Review
  }
  return events;
}

describe('leechInfo', () => {
  it('counts Again in Review as a lapse — the same number as FSRS lapses', () => {
    for (const n of [0, 1, 3, LEECH_THRESHOLD, 11]) {
      const events = leechHistory(n);
      const info = leechInfo(events);
      expect(info.lapses).toBe(n);
      expect(info.lapses).toBe(computeCardState(events).lapses);
      expect(info.is_leech).toBe(n >= LEECH_THRESHOLD);
      expect(info.lapse_dates).toHaveLength(n);
    }
  });

  it('Again on a new / learning card is not a lapse', () => {
    const events: ReviewEvent[] = [
      { id: 'a', card_id: 'c', rating: 0, reviewed_at: '2026-01-01T09:00:00.000Z' },
      { id: 'b', card_id: 'c', rating: 0, reviewed_at: '2026-01-01T09:01:00.000Z' },
    ];
    expect(leechInfo(events).lapses).toBe(0);
    expect(leechInfo(events).reviews).toBe(2);
  });

  it('a forget starts the count again', () => {
    const events = leechHistory(9);
    const last = events[events.length - 1].reviewed_at;
    const forgotAt = new Date(Date.parse(last) + DAY).toISOString();
    const merged = withForgetEvents(events, [{ id: 'f', card_id: 'c', forgotten_at: forgotAt }]);
    const info = leechInfo(merged);
    expect(info).toMatchObject({ lapses: 0, is_leech: false, reviews: 0, forgotten_at: forgotAt });
    expect(computeCardState(merged).lapses).toBe(0);
  });

  it('lists the newest ratings first, at most 10', () => {
    const info = leechInfo(leechHistory(8));
    expect(info.recent).toHaveLength(10);
    expect(info.recent[0].reviewed_at > info.recent[1].reviewed_at).toBe(true);
    expect(info.recent.some(r => r.lapse)).toBe(true);
  });
});

describe('copy', () => {
  it('pill only from the threshold, icon + words', () => {
    expect(isLeech(7)).toBe(false);
    expect(leechPill(7)).toBeNull();
    expect(leechPill(8)).toEqual({ icon: '⚠️', text: 'Missed 8×' });
    expect(leechPill(undefined)).toBeNull();
  });

  it('forget words', () => {
    expect(FORGET_WARNING).toBe("This card goes back to New: its schedule restarts from scratch and it re-enters your new-card queue. Its review history is kept but no longer counts toward scheduling. Can't be undone except by Undo right now.");
    expect(forgetWarning(1)).toBe(FORGET_WARNING);
    expect(forgetWarning(3)).toMatch(/^These 3 cards go back to New/);
    expect(forgetTitle('card', 1)).toBe('Forget this card?');
    expect(forgetTitle('note', 3)).toBe('Forget all 3 cards of this word?');
    expect(forgetButton(1)).toBe('↺ Forget card');
    expect(forgetButton(3)).toBe('↺ Forget 3 cards');
    expect(forgetMessage(2)).toBe('2 cards reset to New.');
    expect(leechHeadline(8)).toBe("You've missed this card 8 times after learning it.");
    expect(memoryHookQuestion('银行', 'bank', 8)).toContain('银行 — bank');
    expect([0, 1, 2, 3].map(ratingTag)).toEqual(['✗ Again', '~ Hard', '✓ Good', '✓✓ Easy']);
  });
});
