/**
 * An audio lesson's transcript row: the Chinese as word chips made on the device (the
 * deterministic segmenter, the chat's ChatWordsText); a word opens the language explorer, a tap
 * on the rest of the row seeks the audio — never both.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TranscriptRow } from '@shared/audio-lesson';
import { loadSegmenter } from '../../services/chineseSegmenter';

const open = vi.fn();
vi.mock('../explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open, push: vi.fn(), inside: false }),
}));

import { TranscriptLine } from './TranscriptLine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const story: TranscriptRow = {
  first: 3,
  last: 5,
  start_ms: 12_000,
  lang: 'zh',
  text: '我们明天去银行。',
  pinyin: 'wǒmen míngtiān qù yínháng.',
  english: "We're going to the bank tomorrow.",
  repeat: 3,
};

describe('TranscriptLine — word chips in the audio-lesson transcript', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    expect(await loadSegmenter()).toBeTruthy();
  });

  beforeEach(() => {
    open.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const chips = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.chat-word'));
  const render = async (row: TranscriptRow, onSeek = vi.fn(), opts: { pinyin?: boolean; english?: boolean } = {}) => {
    await act(async () =>
      root.render(
        <ol>
          <TranscriptLine row={row} current={false} showPinyin={opts.pinyin ?? true} showEnglish={opts.english ?? true} known={new Set(['银行'])} onSeek={onSeek} />
        </ol>,
      ),
    );
    return onSeek;
  };

  it('shows the Chinese as word chips with the row pinyin, English and ×N unchanged', async () => {
    await render(story);
    expect(chips().map((c) => c.textContent)).toEqual(['我们', '明天', '去', '银行']);
    expect(chips()[3].classList.contains('known')).toBe(true);
    expect(host.querySelector('[data-testid="chat-words"]')?.textContent).toBe(story.text);
    expect(host.querySelector('.al-line-pinyin')?.textContent).toBe(story.pinyin);
    expect(host.querySelector('.al-line-en')?.textContent).toBe(story.english);
    expect(host.querySelector('.al-line-repeat')?.textContent).toBe('×3');
    // No pinyin over each word: the row's own pinyin line follows 拼.
    expect(host.querySelectorAll('rt')).toHaveLength(0);
  });

  it('a word tap opens the explorer Word view and does not seek', async () => {
    const onSeek = await render(story);
    await act(async () => chips()[3].click());
    expect(open).toHaveBeenCalledWith(
      { kind: 'word', hanzi: '银行', pinyin: 'yínháng', sentence: '我们明天去银行。' },
      { source: 'audio_lesson' },
    );
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('a tap on the rest of the row seeks to it', async () => {
    const onSeek = await render(story);
    await act(async () => (host.querySelector('.al-line-en') as HTMLElement).click());
    expect(onSeek).toHaveBeenCalledWith(12_000);
    await act(async () => (host.querySelector('.chat-word-punct') as HTMLElement).click());
    expect(onSeek).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('an English narration row keeps its English plain and chips only the Chinese inside', async () => {
    await render({ first: 0, last: 1, start_ms: 0, lang: 'en', text: 'The word was 银行: bank.' });
    expect(chips().map((c) => c.textContent)).toEqual(['银行']);
    expect(host.querySelector('.al-line-text')?.textContent).toBe('The word was 银行: bank.');
  });

  it('a row with no Chinese is plain text', async () => {
    const onSeek = await render({ first: 0, last: 0, start_ms: 500, lang: 'en', text: 'Listen and repeat.' });
    expect(host.querySelector('[data-testid="chat-words"]')).toBeNull();
    await act(async () => (host.querySelector('.al-line-text') as HTMLElement).click());
    expect(onSeek).toHaveBeenCalledWith(500);
  });

  it('hides pinyin and English with the toggles off', async () => {
    await render(story, vi.fn(), { pinyin: false, english: false });
    expect(host.querySelector('.al-line-pinyin')).toBeNull();
    expect(host.querySelector('.al-line-en')).toBeNull();
    expect(chips()).toHaveLength(4);
  });
});
