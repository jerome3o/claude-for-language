import { beforeEach, describe, expect, it, vi } from 'vitest';

const glossBoardText = vi.fn();
vi.mock('../../api/calls', () => ({ glossBoardText: (...a: unknown[]) => glossBoardText(...a) }));

import { boardGlossEnabled, cachedBoardGloss, fetchBoardGloss, resetBoardGlossCache, setBoardGlossEnabled } from './boardGloss';

describe('board tab-complete client', () => {
  beforeEach(() => {
    glossBoardText.mockReset();
    resetBoardGlossCache();
    localStorage.clear();
  });

  it('fetches once, then answers a repeat from the LRU', async () => {
    glossBoardText.mockResolvedValueOnce({ text: '你好', pinyin: 'nǐ hǎo', english: 'hello' });
    const signal = new AbortController().signal;
    expect(await fetchBoardGloss('c1', '你好', signal)).toEqual({ pinyin: 'nǐ hǎo', english: 'hello' });
    expect(await fetchBoardGloss('c1', ' 你好', signal)).toEqual({ pinyin: 'nǐ hǎo', english: 'hello' });
    expect(glossBoardText).toHaveBeenCalledTimes(1);
    expect(glossBoardText).toHaveBeenCalledWith('c1', '你好', signal);
    expect(cachedBoardGloss('你好')).not.toBeNull();
  });

  it('flattens a multi-line reply and drops an unusable one', async () => {
    glossBoardText.mockResolvedValueOnce({ pinyin: 'xiè\nxie', english: 'thanks\r\n' });
    expect(await fetchBoardGloss('c1', '谢谢', new AbortController().signal)).toEqual({ pinyin: 'xiè xie', english: 'thanks' });
    glossBoardText.mockResolvedValueOnce({ pinyin: '', english: '' });
    expect(await fetchBoardGloss('c1', '再见', new AbortController().signal)).toBeNull();
  });

  it('is quiet (null, no more requests for a minute) after 503', async () => {
    glossBoardText.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }));
    expect(await fetchBoardGloss('c1', '你好', new AbortController().signal)).toBeNull();
    expect(await fetchBoardGloss('c1', '再见', new AbortController().signal)).toBeNull();
    expect(glossBoardText).toHaveBeenCalledTimes(1);
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
