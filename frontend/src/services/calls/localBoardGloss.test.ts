import { describe, expect, it, vi } from 'vitest';

const lookupWord = vi.fn();
const lookupChar = vi.fn();
vi.mock('../wordDict', () => ({ lookupWord: (...a: unknown[]) => lookupWord(...a) }));
vi.mock('../charDict', () => ({ lookupChar: (...a: unknown[]) => lookupChar(...a) }));
vi.mock('../../api/calls', () => ({ glossBoardText: vi.fn() }));

import { localBoardGloss } from './boardGloss';

describe('localBoardGloss (the device gloss)', () => {
  it('a word the dictionary knows: its pinyin and first meaning', async () => {
    lookupWord.mockResolvedValueOnce({ status: 'ok', record: { hanzi: '银行', pinyin: 'yínháng', syllables: ['yín', 'háng'], english: 'bank; CL:家', senses: [], rank: 900 } });
    expect(await localBoardGloss('银行')).toEqual({ pinyin: 'yínháng', english: 'bank' });
    expect(lookupWord).toHaveBeenCalledWith('银行');
  });

  it('a phrase: the segmenter\'s pinyin, words joined, no meaning', async () => {
    const g = await localBoardGloss('我想去银行');
    expect(g).toEqual({ pinyin: 'wǒ xiǎng qù yínháng', english: '' });
  });

  it('one character: the reading the device picked', async () => {
    lookupChar.mockResolvedValueOnce({ status: 'ok', offline: false, record: { char: '好', readings: [{ pinyin: 'hǎo', english: 'good' }, { pinyin: 'hào', english: 'to be fond of' }], meaning: 'good, well' } });
    expect(await localBoardGloss('好')).toEqual({ pinyin: 'hǎo', english: 'good' });
  });

  it('offline and never looked up: still the pinyin; the 一 / 不 tone changes applied', async () => {
    lookupWord.mockResolvedValueOnce({ status: 'offline' });
    expect(await localBoardGloss('不是')).toMatchObject({ pinyin: expect.stringMatching(/^búshì$|^bú shì$/), english: '' });
  });
});
