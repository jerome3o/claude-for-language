import { describe, expect, it } from 'vitest';
import type { LessonAudioClip } from '@shared/lesson';
import { createClipPrefetcher, createLessonSpeaker, type SpeakerPlayer } from './lessonAudio';

const clip = (text: string, exercise: number): LessonAudioClip => ({ kind: 'tts', text, exercise });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createClipPrefetcher', () => {
  it('fetches missing clips, current exercise first, each once, at most N at a time', async () => {
    const clips = [clip('一', 0), clip('二', 1), clip('三', 2), clip('一', 3), clip('四', 3)];
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const p = createClipPrefetcher({
      clips,
      current: 2,
      concurrency: 2,
      isCached: async (c) => c.text === '二',
      fetch: async (c) => {
        order.push(c.text);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        inFlight--;
        return c.text !== '四';
      },
    });
    const r = await p.done;
    expect(order).toEqual(['三', '一', '四']);
    expect(maxInFlight).toBe(2);
    expect(r).toEqual({ cached: 1, fetched: 2, failed: 1, cancelled: false });
  });

  it('focus moves the new exercise to the front of what is left', async () => {
    const gates = new Map<string, ReturnType<typeof deferred<boolean>>>();
    const order: string[] = [];
    const clips = ['a', 'b', 'c', 'd', 'e'].map((t, i) => clip(t, i));
    const p = createClipPrefetcher({
      clips,
      concurrency: 1,
      isCached: async () => false,
      fetch: (c) => {
        order.push(c.text);
        const d = deferred<boolean>();
        gates.set(c.text, d);
        return d.promise;
      },
    });
    await tick();
    expect(order).toEqual(['a']);
    p.focus(3);
    gates.get('a')!.resolve(true);
    await tick(); await tick();
    expect(order).toEqual(['a', 'd']);
    gates.get('d')!.resolve(true);
    await tick(); await tick();
    gates.get('e')!.resolve(true);
    await tick(); await tick();
    gates.get('b')!.resolve(true);
    await tick(); await tick();
    gates.get('c')!.resolve(true);
    await p.done;
    expect(order).toEqual(['a', 'd', 'e', 'b', 'c']);
  });

  it('stops when cancelled or offline', async () => {
    let online = true;
    const fetched: string[] = [];
    const p = createClipPrefetcher({
      clips: [clip('a', 0), clip('b', 1), clip('c', 2)],
      concurrency: 1,
      online: () => online,
      isCached: async () => false,
      fetch: async (c) => { fetched.push(c.text); online = false; return true; },
    });
    await p.done;
    expect(fetched).toEqual(['a']);

    const q = createClipPrefetcher({ clips: [clip('a', 0), clip('b', 1)], concurrency: 1, isCached: async () => false, fetch: async () => true });
    q.cancel();
    expect((await q.done).cancelled).toBe(true);
  });
});

function fakePlayer() {
  let id = 0;
  const played: string[] = [];
  const player: SpeakerPlayer = {
    claim: () => ++id,
    isCurrent: (x) => x === id,
    stop: () => { id++; },
    play: (blob) => { played.push((blob as unknown as { text: string }).text); return ++id; },
  };
  return { player, played };
}

const blob = (text: string) => ({ text }) as unknown as Blob;

describe('createLessonSpeaker', () => {
  it('plays a cached clip and counts a hit', async () => {
    const { player, played } = fakePlayer();
    const s = createLessonSpeaker({ player, load: async (t) => blob(t), isCached: async () => true });
    s.speak('你好');
    await tick(); await tick();
    expect(played).toEqual(['你好']);
    expect(s.stats()).toEqual({ hits: 1, misses: 0, stale: 0, max_wait_ms: 0 });
  });

  it('a late clip is dropped once the exercise changed — never plays on the next one', async () => {
    const { player, played } = fakePlayer();
    const gate = deferred<Blob | null>();
    let t = 0;
    const s = createLessonSpeaker({ player, load: () => gate.promise, isCached: async () => false, now: () => t });
    s.speak('即使他很忙，也每天复习中文。');
    s.cancelPending(); // Next exercise.
    t = 2400;
    gate.resolve(blob('即使他很忙，也每天复习中文。'));
    await tick(); await tick();
    expect(played).toEqual([]);
    expect(s.stats()).toEqual({ hits: 0, misses: 1, stale: 1, max_wait_ms: 2400 });
  });

  it('a missing clip plays as soon as it arrives while still on its exercise', async () => {
    const { player, played } = fakePlayer();
    const gate = deferred<Blob | null>();
    const s = createLessonSpeaker({ player, load: () => gate.promise, isCached: async () => false });
    s.speak('好');
    gate.resolve(blob('好'));
    await tick(); await tick();
    expect(played).toEqual(['好']);
    // Nothing pending any more: changing exercise now drops nothing.
    s.cancelPending();
    expect(s.stats().stale).toBe(0);
  });

  it('newest speak wins (a superseded clip is not counted stale)', async () => {
    const { player, played } = fakePlayer();
    const gates = [deferred<Blob | null>(), deferred<Blob | null>()];
    let n = 0;
    const s = createLessonSpeaker({ player, load: () => gates[n++].promise, isCached: async () => true });
    s.speak('一');
    s.speak('二');
    gates[1].resolve(blob('二'));
    gates[0].resolve(blob('一'));
    await tick(); await tick();
    expect(played).toEqual(['二']);
    expect(s.stats().stale).toBe(0);
  });
});
