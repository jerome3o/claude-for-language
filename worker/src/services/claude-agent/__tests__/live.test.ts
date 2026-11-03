/**
 * The live side of a reply (claude-agent/live.ts): pushes throttled to one per PUSH_INTERVAL_MS and
 * writes to one per WRITE_INTERVAL_MS, both coalescing to the LATEST text, in order, nothing after the
 * final `done`; the lease renewed on stream activity at most every LEASE_RENEW_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeTurnEvent } from '@shared/claude/api';
import * as store from '../store';
import { LEASE_RENEW_MS, LiveTurn, PUSH_INTERVAL_MS, WRITE_INTERVAL_MS } from '../live';

describe('LiveTurn', () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function make() {
    const events: ClaudeTurnEvent[] = [];
    const writes: string[] = [];
    vi.spyOn(store, 'writePartial').mockImplementation(async (_db, _id, text) => void writes.push(text));
    const renew = vi.spyOn(store, 'renewLease').mockImplementation(async () => undefined);
    const live = new LiveTurn({ DB: {} as D1Database, CHAT_HUB: undefined as never }, { userId: 'u', threadId: 't', messageId: 'm' }, {
      push: async (e) => void events.push(e),
      now: () => now,
    });
    return { live, events, writes, renew };
  }

  const tick = async (ms: number) => {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('coalesces a burst of text into throttled pushes and writes of the latest text, then one final done', async () => {
    const { live, events, writes } = make();
    live.thinking();
    for (const t of ['这', '这是', '这是一', '这是一个']) {
      live.update(t);
      await tick(20);
    }
    // The first update went at once; the rest wait for the interval and go as ONE push of the latest text.
    await tick(PUSH_INTERVAL_MS);
    const streaming = events.filter((e) => e.status === 'streaming').map((e) => e.text);
    expect(streaming).toEqual(['这', '这是一个']);
    await tick(WRITE_INTERVAL_MS);
    expect(writes).toEqual(['这', '这是一个']);

    live.update('这是一个好问题。');
    await live.done('这是一个好问题。');
    await tick(1000);
    expect(events.at(-1)).toMatchObject({ status: 'done', text: '这是一个好问题。' });
    // Nothing after done; seq always grows.
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events[0]).toEqual({ type: 'claude_turn', thread_id: 't', message_id: 'm', seq: 1, status: 'thinking' });
  });

  it('renews the lease on stream activity at most every LEASE_RENEW_MS', async () => {
    const { live, renew } = make();
    live.activity();
    expect(renew).not.toHaveBeenCalled();
    await tick(LEASE_RENEW_MS);
    live.activity();
    live.activity();
    expect(renew).toHaveBeenCalledTimes(1);
  });
});
