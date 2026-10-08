/**
 * ChatWordsText without Claude's words (Ask Claude bubbles, a chat message whose words are
 * still being made or failed): the text is split into WORDS on the device by the
 * deterministic segmenter (services/chineseSegmenter) — never one chip per character — with
 * the device's pinyin over each word; Claude's words win when they are there.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatWordsText, type TappedWord } from './ChatWords';
import { loadSegmenter } from '../../services/chineseSegmenter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = '好问题！我们明天去银行。';

describe('ChatWordsText — word chips made on the device', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    expect(await loadSegmenter()).toBeTruthy();
  });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const chips = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-word'));

  it('shows multi-character word chips at once, punctuation plain', async () => {
    await act(async () => root.render(<ChatWordsText text={TEXT} words={null} showPinyin={false} known={new Set(['银行'])} onTapWord={() => {}} />));
    expect(chips().map((c) => c.textContent)).toEqual(['好', '问题', '我们', '明天', '去', '银行']);
    expect(host.querySelector('[data-testid="chat-words"]')?.textContent).toBe(TEXT);
    expect(chips()[5].classList.contains('known')).toBe(true);
  });

  it('puts the device pinyin over each word and hands the word + its sentence to a tap', async () => {
    const onTap = vi.fn<(t: TappedWord) => void>();
    await act(async () => root.render(<ChatWordsText text={TEXT} words={null} showPinyin known={new Set()} onTapWord={onTap} />));
    expect(Array.from(host.querySelectorAll('rt')).map((r) => r.textContent)).toEqual(['hǎo', 'wèntí', 'wǒmen', 'míngtiān', 'qù', 'yínháng']);
    await act(async () => chips()[5].click());
    expect(onTap).toHaveBeenCalledWith({ word: { text: '银行', pinyin: 'yínháng', gloss: '' }, sentence: '我们明天去银行。' });
  });

  it("Claude's words win when they are there", async () => {
    const words = [{ text: '好问题', pinyin: 'hǎo wèntí', gloss: 'good question' }, { text: '！', pinyin: '', gloss: '' }];
    await act(async () => root.render(<ChatWordsText text="好问题！" words={words} showPinyin={false} known={new Set()} onTapWord={() => {}} />));
    expect(chips().map((c) => c.textContent)).toEqual(['好问题']);
  });

  it('English stays plain text', async () => {
    await act(async () => root.render(<ChatWordsText text="Good question!" words={null} showPinyin={false} known={new Set()} onTapWord={() => {}} />));
    expect(chips()).toHaveLength(0);
    expect(host.textContent).toBe('Good question!');
  });
});
