import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeCardState, type ReviewEvent } from '@shared/scheduler';
import { db, createLocalReviewEvent, type LocalCard } from '../db/database';
import { CardQueue, type Rating } from '../types';
import {
  recomputeCardFromEvents,
  recomputeCardsWithEvents,
  repairCardStatesFromEvents,
  repairCardStatesIfDue,
  syncReviewEvents,
} from './review-events';

// The 27 Sep debug report (Lab vs web): 49 cards with review events sat at NEW
// on the web, and ~765 review cards had a due date whole days later than the
// replay of their events. Every card row must equal computeCardState(events).

function newCard(id: string, extra: Partial<LocalCard> = {}): LocalCard {
  return {
    id, note_id: `note-${id}`, deck_id: 'd1', card_type: 'hanzi_to_meaning', queue: CardQueue.NEW,
    stability: 0, difficulty: 0, lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0,
    next_review_at: null, due_timestamp: null, created_at: '2026-01-01', updated_at: '2026-01-01', _synced_at: null,
    ...extra,
  };
}

async function events(cardId: string, list: Array<[Rating, string]>): Promise<ReviewEvent[]> {
  const out: ReviewEvent[] = [];
  for (const [i, [rating, at]] of list.entries()) {
    const e = { id: `${cardId}-e${i}`, card_id: cardId, rating, reviewed_at: at };
    await createLocalReviewEvent({ ...e, time_spent_ms: null, user_answer: null, _synced: 1 });
    out.push(e);
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('card rows are the replay of their events', () => {
  it('repairs a card left NEW although it has events, and a review card with a drifted due date', async () => {
    // 睡午觉: one Easy on 25 Sep → due 27 Sep 20:45 by replay; the web row said NEW.
    await db.cards.put(newCard('stuck'));
    const stuck = await events('stuck', [[3, '2026-09-25T20:45:46.291Z']]);
    // 查看购物篮: replay says 26 Sep, the web row said 28 Sep.
    const drifted = await events('drift', [
      [1, '2026-09-15T22:05:48.207Z'], [1, '2026-09-15T22:14:24.293Z'], [2, '2026-09-15T22:20:59.806Z'],
      [2, '2026-09-16T07:49:33.274Z'], [2, '2026-09-19T16:20:56.769Z'],
    ]);
    await db.cards.put(newCard('drift', { queue: CardQueue.REVIEW, next_review_at: '2026-09-28T16:20:56.768Z', repetitions: 5 }));
    await db.cards.put(newCard('fresh')); // no events and already NEW: nothing to write

    const result = await repairCardStatesFromEvents();
    expect(result).toEqual({ checked: 3, fixed: 2 });

    const s = await db.cards.get('stuck');
    expect(s!.queue).toBe(CardQueue.REVIEW);
    expect(s!.next_review_at).toBe(computeCardState(stuck).next_review_at);
    expect(s!.next_review_at).toBe('2026-09-27T20:45:46.291Z');
    const d = await db.cards.get('drift');
    expect(d!.next_review_at).toBe(computeCardState(drifted).next_review_at);
    expect(d!.next_review_at).toBe('2026-09-26T16:20:56.769Z');
    expect((await db.cards.get('fresh'))!.queue).toBe(CardQueue.NEW);

    // Idempotent
    expect((await repairCardStatesFromEvents()).fixed).toBe(0);
  });

  it('resets cards with no events to NEW: legacy server state and rows with no queue (30 Sep: 390 due on the web, 119 in the Lab)', async () => {
    // "Anki Export": the server row says review, due 3 Mar, 4 reps — but there is not one review event.
    await db.cards.put(newCard('anki', { queue: CardQueue.REVIEW, next_review_at: '2026-03-03T11:02:32.528Z', due_timestamp: null, repetitions: 4, interval: 25, stability: 25, difficulty: 5 }));
    // "Mengfei Conversations": a row an older build wrote without a queue — counted as learning.
    const { queue: _q, ...noQueue } = newCard('noqueue');
    await db.cards.put(noQueue as LocalCard);
    await db.cards.put(newCard('fresh'));
    const reviewed = await events('reviewed', [[2, '2026-09-20T10:00:00.000Z']]);
    await db.cards.put(newCard('reviewed', { ...computeCardState(reviewed), queue: computeCardState(reviewed).queue }));

    const result = await repairCardStatesFromEvents();
    expect(result.fixed).toBeGreaterThanOrEqual(2);
    for (const id of ['anki', 'noqueue']) {
      const c = await db.cards.get(id);
      expect(c!.queue).toBe(CardQueue.NEW);
      expect(c!.next_review_at).toBeNull();
      expect(c!.repetitions).toBe(0);
    }
    expect((await db.cards.get('reviewed'))!.queue).toBe(computeCardState(reviewed).queue);
    expect((await repairCardStatesFromEvents()).fixed).toBe(0);
  });

  it('runs once per repair version and local day', async () => {
    await db.cards.put(newCard('c'));
    await events('c', [[2, '2026-09-20T10:00:00.000Z']]);
    const day1 = new Date(2026, 8, 27, 12);
    expect(await repairCardStatesIfDue(day1)).toEqual({ checked: 1, fixed: 1 });
    expect(await repairCardStatesIfDue(day1)).toBeNull();
    expect(await repairCardStatesIfDue(new Date(2026, 8, 28, 8))).toEqual({ checked: 1, fixed: 0 });
  });

  it('recomputes cards a sync (re)inserted as NEW when their events are already here', async () => {
    await db.cards.put(newCard('back'));
    await db.cards.put(newCard('brand-new'));
    const ev = await events('back', [[2, '2026-09-24T10:54:34.818Z'], [3, '2026-09-24T11:05:21.147Z']]);
    expect(await recomputeCardsWithEvents(['back', 'brand-new'])).toBe(1);
    expect((await db.cards.get('back'))!.next_review_at).toBe(computeCardState(ev).next_review_at);
    expect((await db.cards.get('brand-new'))!.queue).toBe(CardQueue.NEW);
    expect(await recomputeCardFromEvents('brand-new')).toBeNull();
  });
});

describe('uploading events the server refuses', () => {
  it('marks refused (orphan) events rejected, not synced', async () => {
    for (const id of ['ok', 'orphan']) {
      await createLocalReviewEvent({ id, card_id: `card-${id}`, rating: 2, time_spent_ms: null, user_answer: null, reviewed_at: '2026-09-27T10:00:00.000Z', _synced: 0 });
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ created: 1, skipped: 0, skipped_orphans: 1, orphan_event_ids: ['orphan'] }), { status: 200 })));
    const r = await syncReviewEvents('token');
    expect(r.failed).toBe(0);
    expect((await db.reviewEvents.get('ok'))!._synced).toBe(1);
    expect((await db.reviewEvents.get('orphan'))!._synced).toBe(-1);
    // Not picked up again
    expect(await db.reviewEvents.where('_synced').equals(0).count()).toBe(0);
  });
});
