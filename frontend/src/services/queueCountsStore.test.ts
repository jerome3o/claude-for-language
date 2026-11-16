import { afterEach, describe, expect, it, vi } from 'vitest';

const counted = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../db/database', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/database')>();
  return {
    ...real,
    // A stand-in count that reads the cards table, so writes there re-run it (liveQuery).
    getRawQueueCounts: vi.fn(async () => {
      counted.calls++;
      const n = await real.db.cards.count();
      const raw = new Map([['deck-1', { learning: 0, review: n } as never]]);
      return raw;
    }),
  };
});

import { db } from '../db/database';
import { queueCountsSnapshot, resetQueueCountsForTests, subscribeQueueCounts } from './queueCountsStore';

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise(r => setTimeout(r, 5));
  expect(check()).toBe(true);
};

afterEach(() => resetQueueCountsForTests());

describe('queueCountsStore', () => {
  it('a view mounting later paints the last count at once (Home back from Study)', async () => {
    const off = subscribeQueueCounts(() => {});
    await until(() => queueCountsSnapshot() !== null);
    const first = queueCountsSnapshot()!;
    expect(first.raw.get('deck-1')?.review).toBe(0);
    off();

    // Home mounts again: the last result is there before any recount finishes.
    const off2 = subscribeQueueCounts(() => {});
    expect(queueCountsSnapshot()).toBe(first);
    off2();
  });

  it('a write gives a newer count, stamped later', async () => {
    const seen: number[] = [];
    const off = subscribeQueueCounts(() => seen.push(queueCountsSnapshot()!.raw.get('deck-1')!.review));
    await until(() => seen.length > 0);
    const before = queueCountsSnapshot()!;
    await new Promise(r => setTimeout(r, 2));
    await db.cards.put({ id: 'c1', note_id: 'n1', deck_id: 'deck-1', card_type: 'hanzi_to_meaning', queue: 0 } as never);
    await until(() => queueCountsSnapshot()!.raw.get('deck-1')!.review === 1);
    expect(queueCountsSnapshot()!.at).toBeGreaterThanOrEqual(before.at);
    off();
  });

  it('views mounting in the same tick share one recount', async () => {
    const off = subscribeQueueCounts(() => {});
    await until(() => queueCountsSnapshot() !== null);
    const calls = counted.calls;
    const a = subscribeQueueCounts(() => {});
    const b = subscribeQueueCounts(() => {});
    await until(() => counted.calls > calls);
    await new Promise(r => setTimeout(r, 30));
    expect(counted.calls - calls).toBe(1);
    off(); a(); b();
  });
});
