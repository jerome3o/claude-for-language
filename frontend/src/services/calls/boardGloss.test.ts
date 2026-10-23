import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const glossBoardText = vi.fn();
vi.mock('../../api/calls', () => ({ glossBoardText: (...a: unknown[]) => glossBoardText(...a) }));

import { boardGlossEnabled, cachedBoardGloss, fetchBoardGloss, resetBoardGlossCache, setBoardGlossEnabled } from './boardGloss';

const sig = () => new AbortController().signal;
const httpError = (status: number, retryAfter?: number) => Object.assign(new Error('x'), { status, ...(retryAfter ? { retryAfter } : {}) });

describe('board tab-complete client', () => {
  beforeEach(() => {
    glossBoardText.mockReset();
    resetBoardGlossCache();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches once, then answers a repeat from the LRU', async () => {
    glossBoardText.mockResolvedValueOnce({ text: '你好', pinyin: 'nǐ hǎo', english: 'hello' });
    expect(await fetchBoardGloss('c1', '你好', sig())).toEqual({ gloss: { pinyin: 'nǐ hǎo', english: 'hello' }, outcome: 'server', status: 0 });
    expect(await fetchBoardGloss('c1', ' 你好', sig())).toEqual({ gloss: { pinyin: 'nǐ hǎo', english: 'hello' }, outcome: 'cached', status: 0 });
    expect(glossBoardText).toHaveBeenCalledTimes(1);
    expect(glossBoardText).toHaveBeenCalledWith('c1', '你好', 'zh', expect.any(AbortSignal));
    expect(cachedBoardGloss('你好')).not.toBeNull();
  });

  it('English → Chinese: asks with direction en, cleans and caches it apart from Chinese', async () => {
    glossBoardText.mockResolvedValueOnce({ text: 'apple', direction: 'en', chinese: '苹果。', pinyin: 'píngguǒ' });
    expect((await fetchBoardGloss('c1', 'apple', sig(), 'en')).gloss).toEqual({ chinese: '苹果', pinyin: 'píngguǒ' });
    expect(glossBoardText).toHaveBeenCalledWith('c1', 'apple', 'en', expect.any(AbortSignal));
    expect(cachedBoardGloss('apple', 'en')).toEqual({ chinese: '苹果', pinyin: 'píngguǒ' });
    expect(cachedBoardGloss('apple', 'zh')).toBeNull();
    // A reply without Chinese is no suggestion.
    glossBoardText.mockResolvedValueOnce({ chinese: 'apple', pinyin: 'píngguǒ' });
    expect(await fetchBoardGloss('c1', 'pear', sig(), 'en')).toMatchObject({ gloss: null, outcome: 'failed' });
  });

  it('flattens a multi-line reply and drops an unusable one', async () => {
    glossBoardText.mockResolvedValueOnce({ pinyin: 'xiè\nxie', english: 'thanks\r\n' });
    expect((await fetchBoardGloss('c1', '谢谢', sig())).gloss).toEqual({ pinyin: 'xiè xie', english: 'thanks' });
    glossBoardText.mockResolvedValueOnce({ pinyin: '', english: '' });
    expect((await fetchBoardGloss('c1', '再见', sig())).gloss).toBeNull();
  });

  it('stopping the wait never aborts the request: its answer is cached for the next ask', async () => {
    let answer: (v: unknown) => void = () => {};
    glossBoardText.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const ac = new AbortController();
    const waiting = fetchBoardGloss('c1', '咖啡', ac.signal);
    ac.abort();
    expect(await waiting).toMatchObject({ gloss: null, outcome: 'superseded' });
    // Asked again while it runs: joins it (one request).
    const again = fetchBoardGloss('c1', '咖啡', sig());
    answer({ pinyin: 'kāfēi', english: 'coffee' });
    expect((await again).gloss).toEqual({ pinyin: 'kāfēi', english: 'coffee' });
    expect(glossBoardText).toHaveBeenCalledTimes(1);
    const passed = glossBoardText.mock.calls[0][3] as AbortSignal;
    expect(passed.aborted).toBe(false);
    expect(cachedBoardGloss('咖啡')).not.toBeNull();
  });

  it('after a 503 only new lookups wait — for seconds, not a minute', async () => {
    vi.useFakeTimers();
    glossBoardText.mockRejectedValueOnce(httpError(503));
    expect(await fetchBoardGloss('c1', '你好', sig())).toEqual({ gloss: null, outcome: 'unavailable', status: 503 });
    expect(await fetchBoardGloss('c1', '再见', sig())).toMatchObject({ outcome: 'backoff' });
    expect(glossBoardText).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_100);
    glossBoardText.mockResolvedValueOnce({ pinyin: 'zàijiàn', english: 'goodbye' });
    expect((await fetchBoardGloss('c1', '再见', sig())).outcome).toBe('server');
  });

  it('a 429 waits for its Retry-After', async () => {
    vi.useFakeTimers();
    glossBoardText.mockRejectedValueOnce(httpError(429, 5));
    expect(await fetchBoardGloss('c1', '你好', sig())).toMatchObject({ outcome: 'rate_limited', status: 429 });
    vi.advanceTimersByTime(4_000);
    expect((await fetchBoardGloss('c1', '谢谢', sig())).outcome).toBe('backoff');
    vi.advanceTimersByTime(1_100);
    glossBoardText.mockResolvedValueOnce({ pinyin: 'xièxie', english: 'thanks' });
    expect((await fetchBoardGloss('c1', '谢谢', sig())).outcome).toBe('server');
  });

  it('a network failure is "offline" and a cached gloss still answers during the wait', async () => {
    glossBoardText.mockResolvedValueOnce({ pinyin: 'nǐ hǎo', english: 'hello' });
    await fetchBoardGloss('c1', '你好', sig());
    glossBoardText.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await fetchBoardGloss('c1', '再见', sig())).toEqual({ gloss: null, outcome: 'offline', status: 0 });
    expect((await fetchBoardGloss('c1', '你好', sig())).outcome).toBe('cached');
  });

  it('the setting is on by default and remembered per user', () => {
    expect(boardGlossEnabled('u1')).toBe(true);
    setBoardGlossEnabled('u1', false);
    expect(boardGlossEnabled('u1')).toBe(false);
    expect(boardGlossEnabled('u2')).toBe(true);
    setBoardGlossEnabled('u1', true);
    expect(boardGlossEnabled('u1')).toBe(true);
  });
});
